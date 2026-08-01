import https from 'https';

import Docker from 'dockerode';
import { ICredentialDataDecryptedObject } from 'n8n-workflow';

import {
  backoffMs,
  DEFAULT_RETRY,
  describeUnretried,
  RetryOptions,
  shouldRetry,
} from './connectionRetry';

export type DockerAuthMode = 'socket' | 'tcp' | 'tls' | 'portainer';

/** Thrown for credential problems we can detect before touching the network. */
export class DockerCredentialError extends Error {}

function requireString(
  credentials: ICredentialDataDecryptedObject,
  field: string,
  label: string,
): string {
  const value = credentials[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DockerCredentialError(
      `${label} is required for this connection mode but was empty. Update your Docker API credential.`,
    );
  }
  return value.trim();
}

function requireNumber(
  credentials: ICredentialDataDecryptedObject,
  field: string,
  label: string,
): number {
  const raw = credentials[field];
  const value = typeof raw === 'string' ? Number(raw) : (raw as number);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DockerCredentialError(
      `${label} is required for this connection mode but was not a valid number. Update your Docker API credential.`,
    );
  }
  return value;
}

/**
 * Builds the dockerode client for a credential.
 *
 * All four connection modes are served by a single dockerode instance, so every
 * operation written against this client works on all of them without special
 * casing.
 *
 * Portainer is the non-obvious one. Portainer proxies the real Docker Engine API
 * at `/api/endpoints/{id}/docker/...`, so it needs a path prefix on every request
 * plus an auth header. docker-modem's `version` option is prepended verbatim to
 * each path, which is exactly what we need.
 *
 * Do NOT reach for docker-modem's `pathPrefix` here: request assembly calls
 * `url.resolve(base, '/containers/json')`, and an absolute path discards the base
 * pathname, silently dropping the prefix.
 */
type DialOptions = { method?: string; path?: string };
type DialCallback = (err: Error | null, data?: unknown) => void;
type Dial = (options: DialOptions, callback: DialCallback) => void;

/**
 * Retries transient connection failures around a SINGLE Docker API request.
 *
 * This is the right seam for it. Retrying an operation instead would re-run
 * whatever it had already done — Run Container is create, start, wait, remove,
 * and repeating that after the wait failed would leave a second container
 * behind. One request is the largest unit that can be repeated while still
 * knowing exactly what is being repeated.
 */
function withConnectionRetry(docker: Docker, retry: RetryOptions): Docker {
  if (!retry.enabled || retry.maxAttempts <= 1) return docker;

  const modem = docker.modem as unknown as { dial: Dial };
  const original = modem.dial.bind(modem);

  modem.dial = (options: DialOptions, callback: DialCallback) => {
    const method = (options?.method ?? 'GET').toUpperCase();
    let attempt = 0;

    const run = () => {
      attempt++;
      original(options, (err, data) => {
        if (!err) return callback(null, data);

        const canRetry = shouldRetry(err, method) && attempt < retry.maxAttempts;
        if (!canRetry) {
          // Carry these as properties rather than baking them into the message.
          // translateDockerError replaces the raw text wholesale — that is the
          // point of it — so anything appended here would be discarded before
          // the user ever saw it.
          const annotated = err as Error & { retryAttempts?: number; retryNote?: string };
          if (attempt > 1) annotated.retryAttempts = attempt;
          // Say why a network failure was left alone, so "not retried" is never
          // mistaken for "retried and still broken".
          const note = describeUnretried(err, method);
          if (note) annotated.retryNote = note;
          return callback(annotated, data);
        }

        setTimeout(run, backoffMs(attempt, retry.initialDelayMs));
      });
    };

    run();
  };

  return docker;
}

export function createDockerClient(
  credentials: ICredentialDataDecryptedObject,
  retry: RetryOptions = DEFAULT_RETRY,
): Docker {
  return withConnectionRetry(buildClient(credentials), retry);
}

function buildClient(credentials: ICredentialDataDecryptedObject): Docker {
  const authMode = (credentials.authMode ?? 'socket') as DockerAuthMode;

  if (authMode === 'socket') {
    return new Docker({ socketPath: requireString(credentials, 'socketPath', 'Socket Path') });
  }

  if (authMode === 'tcp') {
    return new Docker({
      host: requireString(credentials, 'host', 'Host'),
      port: requireNumber(credentials, 'port', 'Port'),
      protocol: 'http',
    });
  }

  if (authMode === 'tls') {
    const ca = typeof credentials.ca === 'string' ? credentials.ca.trim() : '';
    const options: Docker.DockerOptions = {
      host: requireString(credentials, 'host', 'Host'),
      port: requireNumber(credentials, 'tlsPort', 'TLS Port'),
      protocol: 'https',
      cert: requireString(credentials, 'cert', 'Client Certificate'),
      key: requireString(credentials, 'clientKey', 'Client Key'),
    };
    // Omitting `ca` entirely falls back to the system trust store, which is what
    // you want for a publicly signed daemon certificate.
    if (ca !== '') options.ca = ca;
    if (credentials.skipTlsVerify === true) {
      // Two separate checks have to be turned off, and only one of them was.
      // `checkServerIdentity` governs whether the certificate's name matches the
      // host; `rejectUnauthorized` governs whether it chains to a trusted CA at
      // all. Overriding the first alone left the second running, so a self-signed
      // daemon certificate — the entire reason this option exists — still failed
      // with "unable to verify the first certificate" however the box was set.
      //
      // It has to go through an agent: docker-modem forwards only key, cert, ca,
      // checkServerIdentity and agent to the request, so `rejectUnauthorized` set
      // directly on the client is silently dropped. The agent carries the same
      // certificate material because an https.Agent's own options win over the
      // per-request ones when a socket is created.
      const agentOptions: https.AgentOptions = {
        rejectUnauthorized: false,
        cert: options.cert,
        key: options.key,
      };
      if (ca !== '') agentOptions.ca = ca;
      Object.assign(
        options as Docker.DockerOptions & {
          checkServerIdentity?: unknown;
          agent?: https.Agent;
        },
        { checkServerIdentity: () => undefined, agent: new https.Agent(agentOptions) },
      );
    }
    return new Docker(options);
  }

  if (authMode === 'portainer') {
    const rawUrl = requireString(credentials, 'portainerUrl', 'Portainer URL');
    const token = requireString(credentials, 'portainerAccessToken', 'Access Token');
    const endpointId = requireNumber(credentials, 'portainerEndpointId', 'Environment ID');

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new DockerCredentialError(
        `Portainer URL '${rawUrl}' is not a valid URL. It should look like https://portainer.example.com.`,
      );
    }
    const protocol = parsed.protocol.replace(':', '') as 'http' | 'https';
    const port = parsed.port !== '' ? Number(parsed.port) : protocol === 'https' ? 443 : 80;

    // Portainer mounts the Docker API under this prefix; `version` is prepended
    // to every request path by docker-modem.
    const basePath = parsed.pathname.replace(/\/+$/, '');
    const prefix = `${basePath}/api/endpoints/${endpointId}/docker`.replace(/^\//, '');

    return new Docker({
      protocol,
      host: parsed.hostname,
      port,
      version: prefix,
      headers: { 'X-API-Key': token },
    });
  }

  throw new DockerCredentialError(
    `Unknown connection mode '${String(authMode)}'. Expected socket, tcp, tls or portainer.`,
  );
}
