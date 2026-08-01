import { Readable } from 'stream';

import type Dockerode from 'dockerode';

import { DialCallback, DialOptions, DockerTransport, TransportOptions } from './dockerTransport';

/**
 * A Docker Engine client shaped like the one it replaces.
 *
 * Deliberately mirrors dockerode's method names and return shapes rather than
 * being designed afresh. The point is that the fifty-odd operation files, and
 * the 389 end-to-end specs that exercise them, do not change at all — so those
 * specs test THIS, instead of testing a rewrite of everything at once. A prettier
 * API would have meant rewriting the node and the transport in one step and
 * having nothing trustworthy left to check the result against.
 */

const json = (v: unknown): Record<string, unknown> => (v ?? {}) as Record<string, unknown>;

/** Docker's newline-delimited JSON progress format, used by pull/push/build/load. */
export interface ProgressEvent {
  status?: string;
  id?: string;
  error?: string;
  errorDetail?: { message?: string };
  stream?: string;
  aux?: { Digest?: string; Tag?: string; Size?: number; ID?: string };
}

export class Exec {
  constructor(
    private readonly t: DockerTransport,
    readonly id: string,
  ) {}

  /**
   * Starts the exec and returns the raw stream.
   *
   * Docker hijacks the connection here: after the handshake the socket carries
   * Docker's own stream framing rather than HTTP, which is why this cannot be an
   * ordinary request.
   */
  async start(opts: { hijack?: boolean; stdin?: boolean; Tty?: boolean } = {}): Promise<Readable> {
    return this.t.request<Readable>({
      method: 'POST',
      path: `/exec/${this.id}/start`,
      data: { Detach: false, Tty: opts.Tty ?? false },
      headers: { 'Content-Type': 'application/json' },
      hijack: true,
      statusCodes: { 200: true, 101: true },
    });
  }

  async inspect(): Promise<Record<string, unknown>> {
    return json(await this.t.request({ method: 'GET', path: `/exec/${this.id}/json` }));
  }

  async resize(opts: { h: number; w: number }): Promise<void> {
    await this.t.request({ method: 'POST', path: `/exec/${this.id}/resize`, options: opts });
  }
}

export class Container {
  constructor(
    private readonly t: DockerTransport,
    readonly id: string,
  ) {}

  private p(suffix = ''): string {
    return `/containers/${encodeURIComponent(this.id)}${suffix}`;
  }

  async inspect(opts?: Record<string, unknown>): Promise<Dockerode.ContainerInspectInfo> {
    return (await this.t.request({
      method: 'GET',
      path: this.p('/json'),
      options: opts,
    })) as Dockerode.ContainerInspectInfo;
  }

  async start(opts?: Record<string, unknown>): Promise<void> {
    await this.t.request({ method: 'POST', path: this.p('/start'), options: opts });
  }

  async stop(opts?: { t?: number }): Promise<void> {
    await this.t.request({ method: 'POST', path: this.p('/stop'), options: opts });
  }

  async restart(opts?: { t?: number }): Promise<void> {
    await this.t.request({ method: 'POST', path: this.p('/restart'), options: opts });
  }

  async kill(opts?: { signal?: string }): Promise<void> {
    await this.t.request({ method: 'POST', path: this.p('/kill'), options: opts });
  }

  async pause(): Promise<void> {
    await this.t.request({ method: 'POST', path: this.p('/pause') });
  }

  async unpause(): Promise<void> {
    await this.t.request({ method: 'POST', path: this.p('/unpause') });
  }

  async rename(opts: { name: string }): Promise<void> {
    await this.t.request({ method: 'POST', path: this.p('/rename'), options: opts });
  }

  async remove(opts?: { force?: boolean; v?: boolean }): Promise<void> {
    await this.t.request({ method: 'DELETE', path: this.p(), options: opts });
  }

  async update(opts: Record<string, unknown>): Promise<Record<string, unknown>> {
    return json(await this.t.request({ method: 'POST', path: this.p('/update'), data: opts }));
  }

  async top(opts?: { ps_args?: string }): Promise<Record<string, unknown>> {
    return json(await this.t.request({ method: 'GET', path: this.p('/top'), options: opts }));
  }

  /**
   * Returns the raw JSON body rather than a parsed array.
   *
   * Docker answers `null` — not `[]` — for a container with no changes, and the
   * caller already knows to expect that: it parses this itself precisely because
   * that null once became a five-byte Buffer in the output.
   */
  async changes(): Promise<unknown> {
    return this.t.request({ method: 'GET', path: this.p('/changes'), isRaw: true });
  }

  async stats(opts?: { stream?: boolean }): Promise<Record<string, unknown>> {
    return json(
      await this.t.request({
        method: 'GET',
        path: this.p('/stats'),
        options: { stream: opts?.stream ?? false, 'one-shot': opts?.stream === false },
      }),
    );
  }

  async wait(opts?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return json(await this.t.request({ method: 'POST', path: this.p('/wait'), options: opts }));
  }

  /** Logs are returned whole, in Docker's framed format, for the caller to demux. */
  async logs(opts: Record<string, unknown> = {}): Promise<Buffer> {
    return this.t.request<Buffer>({
      method: 'GET',
      path: this.p('/logs'),
      options: opts,
      isRaw: true,
    });
  }

  async exec(opts: Record<string, unknown>): Promise<Exec> {
    const created = json(await this.t.request({ method: 'POST', path: this.p('/exec'), data: opts }));
    return new Exec(this.t, String(created.Id));
  }

  async commit(opts: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { Comment, Author, Changes, repo, tag, pause, ...config } = opts as Record<string, unknown>;
    return json(
      await this.t.request({
        method: 'POST',
        path: '/commit',
        options: {
          container: this.id,
          repo,
          tag,
          comment: Comment,
          author: Author,
          changes: Changes,
          pause,
        },
        data: config,
      }),
    );
  }

  async getArchive(opts: { path: string }): Promise<Readable> {
    return this.t.request<Readable>({
      method: 'GET',
      path: this.p('/archive'),
      options: opts,
      isStream: true,
    });
  }

  async putArchive(data: Readable | Buffer, opts: { path: string }): Promise<void> {
    await this.t.request({
      method: 'PUT',
      path: this.p('/archive'),
      options: opts,
      data,
      headers: { 'Content-Type': 'application/x-tar' },
    });
  }

  /**
   * Stats a path without copying it. Docker answers a HEAD with the metadata in
   * a base64 header and no body, so the headers are what matter here.
   */
  async infoArchive(opts: { path: string }): Promise<Record<string, unknown>> {
    const res = (await this.t.request({
      method: 'HEAD',
      path: this.p('/archive'),
      options: opts,
      wantHeaders: true,
    })) as { headers: Record<string, string | string[] | undefined> };
    const encoded = res.headers['x-docker-container-path-stat'];
    if (typeof encoded !== 'string' || encoded === '') return {};
    try {
      return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    } catch {
      return {};
    }
  }

  async export(): Promise<Readable> {
    return this.t.request<Readable>({ method: 'GET', path: this.p('/export'), isStream: true });
  }
}

export class Image {
  constructor(
    private readonly t: DockerTransport,
    readonly name: string,
  ) {}

  private p(suffix = ''): string {
    // The reference may contain a registry host and a tag; it must not be split
    // on its slashes, so it is encoded whole.
    return `/images/${encodeURIComponent(this.name)}${suffix}`;
  }

  async inspect(): Promise<Dockerode.ImageInspectInfo> {
    return (await this.t.request({
      method: 'GET',
      path: this.p('/json'),
    })) as Dockerode.ImageInspectInfo;
  }

  async history(): Promise<unknown[]> {
    return (await this.t.request({ method: 'GET', path: this.p('/history') })) as unknown[];
  }

  async tag(opts: { repo?: string; tag?: string }): Promise<void> {
    await this.t.request({ method: 'POST', path: this.p('/tag'), options: opts });
  }

  async remove(opts?: { force?: boolean; noprune?: boolean }): Promise<unknown[]> {
    return (await this.t.request({ method: 'DELETE', path: this.p(), options: opts })) as unknown[];
  }

  async push(opts: { tag?: string; authconfig?: unknown } = {}): Promise<Readable> {
    return this.t.request<Readable>({
      method: 'POST',
      path: this.p('/push'),
      options: { tag: opts.tag },
      isStream: true,
      headers: registryAuthHeader(opts.authconfig),
    });
  }

  async get(): Promise<Readable> {
    return this.t.request<Readable>({ method: 'GET', path: this.p('/get'), isStream: true });
  }

  async distribution(
    opts: { authconfig?: unknown } = {},
  ): Promise<Dockerode.ImageDistributionInfo> {
    return (await this.t.request({
        method: 'GET',
      path: `/distribution/${encodeURIComponent(this.name)}/json`,
      headers: registryAuthHeader(opts.authconfig),
    })) as Dockerode.ImageDistributionInfo;
  }
}

export class Network {
  constructor(
    private readonly t: DockerTransport,
    readonly id: string,
  ) {}

  async inspect(): Promise<Record<string, unknown>> {
    return json(await this.t.request({ method: 'GET', path: `/networks/${encodeURIComponent(this.id)}` }));
  }

  async connect(opts: Record<string, unknown>): Promise<void> {
    await this.t.request({
      method: 'POST',
      path: `/networks/${encodeURIComponent(this.id)}/connect`,
      data: opts,
    });
  }

  async disconnect(opts: Record<string, unknown>): Promise<void> {
    await this.t.request({
      method: 'POST',
      path: `/networks/${encodeURIComponent(this.id)}/disconnect`,
      data: opts,
    });
  }

  async remove(): Promise<void> {
    await this.t.request({ method: 'DELETE', path: `/networks/${encodeURIComponent(this.id)}` });
  }
}

export class Volume {
  constructor(
    private readonly t: DockerTransport,
    readonly name: string,
  ) {}

  async inspect(): Promise<Record<string, unknown>> {
    return json(await this.t.request({ method: 'GET', path: `/volumes/${encodeURIComponent(this.name)}` }));
  }

  async remove(opts?: { force?: boolean }): Promise<void> {
    await this.t.request({
      method: 'DELETE',
      path: `/volumes/${encodeURIComponent(this.name)}`,
      options: opts,
    });
  }
}

/** Registry credentials travel base64url-encoded in a header, not the body. */
function registryAuthHeader(authconfig: unknown): Record<string, string> {
  if (!authconfig) return {};
  const encoded = Buffer.from(JSON.stringify(authconfig))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return { 'X-Registry-Auth': encoded };
}

export class DockerApi {
  readonly modem: {
    dial: (options: DialOptions, callback: DialCallback) => void;
    followProgress: (
      stream: Readable,
      onFinished: (err: Error | null, output: ProgressEvent[]) => void,
      onProgress?: (event: ProgressEvent) => void,
    ) => void;
  };

  private readonly t: DockerTransport;

  /**
   * The resolved transport configuration.
   *
   * Exposed so the connection settings can be asserted directly. The transport is
   * chosen once and every operation inherits it, so a mistake here is invisible in
   * the operation code and surfaces only as a connection that is less secure, or
   * less usable, than the credential claims.
   */
  readonly options: TransportOptions;

  constructor(options: TransportOptions) {
    this.options = options;
    this.t = new DockerTransport(options);
    this.modem = {
      dial: (o, cb) => this.t.dial(o, cb),
      followProgress: (stream, onFinished, onProgress) =>
        followProgressStream(stream, onFinished, onProgress),
    };
  }

  getContainer(id: string): Container {
    return new Container(this.t, id);
  }
  getImage(name: string): Image {
    return new Image(this.t, name);
  }
  getNetwork(id: string): Network {
    return new Network(this.t, id);
  }
  getVolume(name: string): Volume {
    return new Volume(this.t, name);
  }

  async ping(): Promise<string> {
    return String((await this.t.request({ method: 'GET', path: '/_ping' })) ?? 'OK');
  }

  async version(): Promise<Record<string, unknown>> {
    return json(await this.t.request({ method: 'GET', path: '/version' }));
  }

  async info(): Promise<Record<string, unknown>> {
    return json(await this.t.request({ method: 'GET', path: '/info' }));
  }

  async df(): Promise<Record<string, unknown>> {
    return json(await this.t.request({ method: 'GET', path: '/system/df' }));
  }

  async checkAuth(authconfig: Record<string, unknown>): Promise<Record<string, unknown>> {
    return json(await this.t.request({ method: 'POST', path: '/auth', data: authconfig }));
  }

  async listContainers(opts?: Dockerode.ContainerListOptions): Promise<Dockerode.ContainerInfo[]> {
    return ((await this.t.request({ method: 'GET', path: '/containers/json', options: opts })) ??
      []) as Dockerode.ContainerInfo[];
  }

  async listImages(opts?: Dockerode.ListImagesOptions): Promise<Dockerode.ImageInfo[]> {
    return ((await this.t.request({ method: 'GET', path: '/images/json', options: opts })) ??
      []) as Dockerode.ImageInfo[];
  }

  async listNetworks(opts?: Record<string, unknown>): Promise<unknown[]> {
    return ((await this.t.request({ method: 'GET', path: '/networks', options: opts })) ??
      []) as unknown[];
  }

  async listVolumes(opts?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return json(await this.t.request({ method: 'GET', path: '/volumes', options: opts }));
  }

  async searchImages(opts: Record<string, unknown>): Promise<unknown[]> {
    return ((await this.t.request({ method: 'GET', path: '/images/search', options: opts })) ??
      []) as unknown[];
  }

  async createContainer(opts: Dockerode.ContainerCreateOptions): Promise<Container> {
    const { name, ...body } = opts as Record<string, unknown> & { name?: string };
    const created = json(
      await this.t.request({
        method: 'POST',
        path: '/containers/create',
        options: name ? { name } : undefined,
        data: body,
        statusCodes: { 201: true },
      }),
    );
    return new Container(this.t, String(created.Id));
  }

  async createNetwork(opts: Dockerode.NetworkCreateOptions): Promise<Network> {
    const created = json(
      await this.t.request({
        method: 'POST',
        path: '/networks/create',
        data: opts,
        statusCodes: { 200: true, 201: true },
      }),
    );
    return new Network(this.t, String(created.Id));
  }

  async createVolume(opts: Record<string, unknown>): Promise<Record<string, unknown>> {
    return json(
      await this.t.request({
        method: 'POST',
        path: '/volumes/create',
        data: opts,
        statusCodes: { 200: true, 201: true },
      }),
    );
  }

  async pull(reference: string, opts: { authconfig?: unknown } = {}): Promise<Readable> {
    // Docker splits the reference itself; a tag sent inside fromImage is ignored.
    const at = reference.lastIndexOf(':');
    const slash = reference.lastIndexOf('/');
    const hasTag = at > slash;
    return this.t.request<Readable>({
      method: 'POST',
      path: '/images/create',
      options: {
        fromImage: hasTag ? reference.slice(0, at) : reference,
        tag: hasTag ? reference.slice(at + 1) : 'latest',
      },
      isStream: true,
      headers: registryAuthHeader(opts.authconfig),
    });
  }

  async buildImage(context: Readable | Buffer, opts: Record<string, unknown>): Promise<Readable> {
    return this.t.request<Readable>({
      method: 'POST',
      path: '/build',
      options: opts,
      data: context,
      isStream: true,
      headers: { 'Content-Type': 'application/x-tar' },
    });
  }

  async loadImage(data: Readable | Buffer): Promise<Readable> {
    return this.t.request<Readable>({
      method: 'POST',
      path: '/images/load',
      data,
      isStream: true,
      headers: { 'Content-Type': 'application/x-tar' },
    });
  }

  async getEvents(opts?: Record<string, unknown>): Promise<Readable> {
    return this.t.request<Readable>({
      method: 'GET',
      path: '/events',
      options: opts,
      isStream: true,
    });
  }

  async pruneContainers(opts?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return json(await this.t.request({ method: 'POST', path: '/containers/prune', options: opts }));
  }

  async pruneImages(opts?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return json(await this.t.request({ method: 'POST', path: '/images/prune', options: opts }));
  }

  async pruneNetworks(opts?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return json(await this.t.request({ method: 'POST', path: '/networks/prune', options: opts }));
  }

  async pruneVolumes(opts?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return json(await this.t.request({ method: 'POST', path: '/volumes/prune', options: opts }));
  }

  async pruneBuilder(): Promise<Record<string, unknown>> {
    return json(await this.t.request({ method: 'POST', path: '/build/prune' }));
  }
}

/**
 * Consumes one of Docker's newline-delimited JSON progress streams.
 *
 * Chunk boundaries fall wherever TCP decides, so a line can arrive in pieces;
 * anything left over is carried to the next chunk rather than discarded.
 */
export function followProgressStream(
  stream: Readable,
  onFinished: (err: Error | null, output: ProgressEvent[]) => void,
  onProgress?: (event: ProgressEvent) => void,
): void {
  const output: ProgressEvent[] = [];
  let buffer = '';
  let finished = false;

  const finish = (err: Error | null): void => {
    if (finished) return;
    finished = true;
    onFinished(err, output);
  };

  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line !== '') {
        try {
          const event = JSON.parse(line) as ProgressEvent;
          output.push(event);
          onProgress?.(event);
        } catch {
          /* a partial or non-JSON line is not worth failing the whole operation */
        }
      }
      index = buffer.indexOf('\n');
    }
  });

  stream.on('error', (err) => finish(err));
  stream.on('end', () => {
    const rest = buffer.trim();
    if (rest !== '') {
      try {
        const event = JSON.parse(rest) as ProgressEvent;
        output.push(event);
        onProgress?.(event);
      } catch {
        /* ignore a trailing fragment */
      }
    }
    finish(null);
  });
}
