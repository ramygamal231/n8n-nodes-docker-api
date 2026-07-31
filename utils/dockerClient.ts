import Docker from 'dockerode';
import { ICredentialDataDecryptedObject } from 'n8n-workflow';

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
export function createDockerClient(credentials: ICredentialDataDecryptedObject): Docker {
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
      (options as Docker.DockerOptions & { checkServerIdentity?: unknown }).checkServerIdentity =
        () => undefined;
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
