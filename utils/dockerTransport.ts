import http from 'http';
import https from 'https';
import { Readable } from 'stream';
import { URLSearchParams } from 'url';

/**
 * The HTTP layer for talking to the Docker Engine.
 *
 * This exists because verified n8n community nodes may not ship runtime
 * dependencies, so dockerode cannot be one. It is less of a loss than it sounds:
 * the Docker Engine API is ordinary HTTP that happens to travel over a Unix
 * socket or named pipe, and Node's own http module speaks that natively via
 * `socketPath`.
 *
 * `dial` is deliberately the single primitive everything else is built on. The
 * connection-retry wrapper and the Custom API Call operation both already sit on
 * top of it, so keeping its shape means neither has to know the transport
 * changed underneath them.
 */

export interface TransportOptions {
  /** Unix socket or Windows named pipe. Mutually exclusive with host/port. */
  socketPath?: string;
  host?: string;
  port?: number;
  protocol?: 'http' | 'https';
  ca?: string;
  cert?: string;
  key?: string;
  checkServerIdentity?: unknown;
  agent?: http.Agent | https.Agent;
  /**
   * Prepended to every path. Portainer mounts the Docker API beneath
   * /api/endpoints/{id}/docker, and dockerode expressed that by abusing its
   * `version` option; naming it for what it is avoids the same confusion.
   */
  pathPrefix?: string;
  /** Sent on every request — Portainer's X-API-Key lives here. */
  headers?: Record<string, string>;
}

export interface DialOptions {
  path: string;
  method: string;
  /** Query parameters. Objects and arrays are JSON-encoded, as Docker expects. */
  options?: object;
  /** Request body: an object is sent as JSON, a Buffer or stream as-is. */
  data?: unknown;
  /** Status codes treated as success. Anything else becomes an error. */
  statusCodes?: Record<number, string | boolean>;
  /** Return the raw response stream instead of buffering and parsing it. */
  isStream?: boolean;
  /** Buffer the body but return it raw, without JSON parsing. */
  isRaw?: boolean;
  headers?: Record<string, string>;
  /** Upgrade the connection and hand back the raw socket, as exec requires. */
  hijack?: boolean;
  /** Expose response headers to the caller; only stat endpoints need them. */
  wantHeaders?: boolean;
}

export type DialCallback = (err: Error | null, data?: unknown) => void;

/** Carries the HTTP status so failures can be classified without parsing text. */
export class DockerResponseError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'DockerResponseError';
  }
}

const DEFAULT_SUCCESS: Record<number, boolean> = { 200: true, 201: true, 204: true, 304: true };

/**
 * Docker wants nested query values JSON-encoded — filters especially, which are
 * a map of arrays. Sending them any other way silently returns unfiltered
 * results rather than an error, which is the worst possible failure mode.
 */
export function buildQuery(options: object | undefined): string {
  if (!options) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') params.append(key, JSON.stringify(value));
    else if (typeof value === 'boolean') params.append(key, value ? 'true' : 'false');
    else params.append(key, String(value));
  }
  const qs = params.toString();
  return qs === '' ? '' : `?${qs}`;
}

export class DockerTransport {
  constructor(private readonly opts: TransportOptions) {}

  /** Everything the client does goes through here. */
  dial(options: DialOptions, callback: DialCallback): void {
    let body: Buffer | Readable | undefined;
    const headers: Record<string, string> = { ...(this.opts.headers ?? {}), ...(options.headers ?? {}) };

    const data = options.data;
    if (data !== undefined && data !== null) {
      if (Buffer.isBuffer(data)) {
        body = data;
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/octet-stream';
        headers['Content-Length'] = String(data.length);
      } else if (data instanceof Readable) {
        body = data;
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/octet-stream';
      } else if (typeof data === 'string') {
        body = Buffer.from(data, 'utf8');
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
        headers['Content-Length'] = String(body.length);
      } else {
        body = Buffer.from(JSON.stringify(data), 'utf8');
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(body.length);
      }
    } else if (options.method === 'POST' || options.method === 'PUT') {
      // Docker rejects a POST with no Content-Length on some endpoints.
      headers['Content-Length'] = '0';
    }

    // dockerode signalled "there is a query object" by leaving a trailing '?' on
    // the path. Custom API Call still does that, so it is honoured here.
    const cleanPath = options.path.endsWith('?') ? options.path.slice(0, -1) : options.path;
    const prefix = this.opts.pathPrefix ? `/${this.opts.pathPrefix.replace(/^\/+|\/+$/g, '')}` : '';
    const path = `${prefix}${cleanPath}${buildQuery(options.options)}`;

    if (options.hijack) {
      headers.Connection = 'Upgrade';
      headers.Upgrade = 'tcp';
    }

    const isTls = this.opts.protocol === 'https';
    const transport = isTls ? https : http;
    const requestOptions: http.RequestOptions & Record<string, unknown> = {
      path,
      method: options.method,
      headers,
      ...(this.opts.socketPath
        ? { socketPath: this.opts.socketPath }
        : { host: this.opts.host, port: this.opts.port }),
    };
    if (isTls) {
      if (this.opts.ca) requestOptions.ca = this.opts.ca;
      if (this.opts.cert) requestOptions.cert = this.opts.cert;
      if (this.opts.key) requestOptions.key = this.opts.key;
      if (this.opts.checkServerIdentity) {
        requestOptions.checkServerIdentity = this.opts.checkServerIdentity;
      }
    }
    if (this.opts.agent) requestOptions.agent = this.opts.agent;

    const req = transport.request(requestOptions);
    let settled = false;
    const done = (err: Error | null, value?: unknown): void => {
      if (settled) return;
      settled = true;
      callback(err, value);
    };

    // Exec needs the raw socket: Docker answers 101 and then speaks its own
    // framing over the upgraded connection, so there is no response body to read.
    if (options.hijack) {
      req.on('upgrade', (_res, socket) => done(null, socket));
      // Some daemons answer 200 and stream over the same connection instead of
      // upgrading. Both are valid; treating only 101 as success hangs the node.
      req.on('response', (res) => {
        if (res.statusCode === 200) return done(null, res);
        this.collectError(res, done);
      });
      req.on('error', (err) => done(err));
      if (body instanceof Readable) body.pipe(req);
      else req.end(body);
      return;
    }

    req.on('error', (err) => done(err));

    req.on('response', (res) => {
      const status = res.statusCode ?? 0;
      const ok = options.statusCodes ?? DEFAULT_SUCCESS;
      if (!ok[status]) return this.collectError(res, done);

      if (options.isStream) return done(null, res);

      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', (err) => done(err));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (options.wantHeaders) return done(null, { headers: res.headers, body: buffer });
        if (options.isRaw) return done(null, buffer);
        if (buffer.length === 0) return done(null, undefined);
        const text = buffer.toString('utf8');
        const type = String(res.headers['content-type'] ?? '');
        if (!type.includes('json')) return done(null, text);
        try {
          done(null, JSON.parse(text));
        } catch {
          // A malformed body from a 2xx is still a successful call; returning
          // the text is more useful than inventing a parse failure.
          done(null, text);
        }
      });
    });

    if (body instanceof Readable) body.pipe(req);
    else req.end(body);
  }

  /** Reads an error response body so the message says what Docker actually said. */
  private collectError(res: http.IncomingMessage, done: DialCallback): void {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { message?: string };
        if (parsed?.message) detail = parsed.message;
      } catch {
        /* not JSON; the raw text is the best available */
      }
      const status = res.statusCode ?? 0;
      done(
        new DockerResponseError(
          `(HTTP code ${status}) ${detail || 'no additional detail'}`.trim(),
          status,
          text,
        ),
      );
    });
    res.on('error', (err) => done(err));
    res.resume();
  }

  /** Promise form, which is what every operation actually wants. */
  request<T = unknown>(options: DialOptions): Promise<T> {
    return new Promise((resolve, reject) => {
      this.dial(options, (err, data) => (err ? reject(err) : resolve(data as T)));
    });
  }
}
