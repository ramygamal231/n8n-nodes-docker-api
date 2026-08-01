import Docker from 'dockerode';
import { Readable } from 'stream';
import { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { translateDockerError } from '../../helpers/errorHandler';
import { normalizeImageInfo } from '../../helpers/normalizeImage';

interface ProgressEvent {
  status?: string;
  id?: string;
  error?: string;
  errorDetail?: { message?: string };
  progressDetail?: { current?: number; total?: number };
  aux?: { Digest?: string; Tag?: string; Size?: number };
}

export interface ProgressSummary {
  events: number;
  layers: string[];
  digest: string | null;
  finalStatus: string | null;
}

/**
 * Consumes one of Docker's newline-delimited JSON progress streams to completion.
 *
 * Two things make this non-trivial:
 *
 *  1. The stream never ends on its own until the operation finishes, so it must
 *     be drained rather than read once. An operation that returns the raw stream
 *     hangs the workflow.
 *  2. Docker reports failures *inside* a successful HTTP response. Pulling a
 *     nonexistent image yields a 200 and a stream containing
 *     {"error":"manifest unknown"} — followProgress does not always surface that
 *     as a callback error, so the events themselves must be inspected. Missing
 *     this reports a failed pull as a success.
 */
/**
 * A stream failure that still carries everything received before it failed.
 *
 * A build reports the intermediate container it is running each step in, and
 * that container is the only handle on what a failed build left behind. Throwing
 * a plain Error discards it along with the rest of the log, so the caller cannot
 * clean up after itself.
 */
export class ProgressStreamError extends Error {
  constructor(
    message: string,
    readonly events: ProgressEvent[],
  ) {
    super(message);
    this.name = 'ProgressStreamError';
  }
}

export function followProgress(
  docker: Docker,
  stream: Readable,
): Promise<{ events: ProgressEvent[] }> {
  return new Promise((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err: Error | null, output: ProgressEvent[]) => {
        if (err) return reject(new ProgressStreamError(err.message, output ?? []));
        const failure = (output ?? []).find((e) => e.error);
        if (failure) {
          return reject(
            new ProgressStreamError(
              failure.errorDetail?.message ?? failure.error ?? 'Unknown registry error',
              output ?? [],
            ),
          );
        }
        resolve({ events: output ?? [] });
      },
      () => {
        /* per-event progress is collected by followProgress itself */
      },
    );
  });
}

export function summarizeProgress(events: ProgressEvent[]): ProgressSummary {
  const layers = new Set<string>();
  let digest: string | null = null;
  let finalStatus: string | null = null;

  for (const e of events) {
    if (e.id && e.status && /complete|pushed|exists/i.test(e.status)) layers.add(e.id);

    // The digest arrives in three different shapes depending on the operation:
    //   push  -> aux: { Digest: "sha256:..." }
    //   pull  -> status: "Digest: sha256:..."
    //   push  -> status: "v1: digest: sha256:... size: 1022"
    // Only handling the first two left push reporting digest: null while the
    // digest sat in plain sight in the status line.
    if (e.aux?.Digest) digest = e.aux.Digest;
    else if (e.status) {
      const match = e.status.match(/digest:\s*(sha256:[a-f0-9]+)/i);
      if (match) digest = match[1];
    }

    if (e.status && !e.id) finalStatus = e.status;
  }

  return { events: events.length, layers: [...layers], digest, finalStatus };
}

interface RegistryAuth {
  username?: string;
  password?: string;
  serveraddress?: string;
}

function authFrom(extra: RegistryAuth): Docker.AuthConfig | undefined {
  if (!extra.username && !extra.password) return undefined;
  return {
    username: extra.username ?? '',
    password: extra.password ?? '',
    serveraddress: extra.serveraddress ?? 'https://index.docker.io/v1/',
  } as Docker.AuthConfig;
}

export async function pullImage(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const reference = (this.getNodeParameter('imageReference', itemIndex) as string).trim();
    const extra = this.getNodeParameter('additionalFields', itemIndex, {}) as RegistryAuth;

    const startedAt = Date.now();
    const stream = (await docker.pull(reference, {
      authconfig: authFrom(extra),
    })) as unknown as Readable;

    const { events } = await followProgress(docker, stream);
    const summary = summarizeProgress(events);

    // Pull is only truly done once the image is resolvable locally.
    const info = await docker.getImage(reference).inspect();

    return {
      ...normalizeImageInfo(info),
      pulled: true,
      reference,
      layersProcessed: summary.layers.length,
      digest: summary.digest,
      status: summary.finalStatus,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function pushImage(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const reference = (this.getNodeParameter('imageReference', itemIndex) as string).trim();
    const tag = (this.getNodeParameter('pushTag', itemIndex, '') as string).trim();
    const extra = this.getNodeParameter('additionalFields', itemIndex, {}) as RegistryAuth;

    const startedAt = Date.now();
    const image = docker.getImage(reference);
    const stream = (await image.push({
      tag: tag || undefined,
      authconfig: authFrom(extra),
    })) as unknown as Readable;

    const { events } = await followProgress(docker, stream);
    const summary = summarizeProgress(events);

    return {
      pushed: true,
      reference,
      tag: tag || null,
      layersProcessed: summary.layers.length,
      digest: summary.digest,
      status: summary.finalStatus,
      durationMs: Date.now() - startedAt,
      pushedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

/**
 * Reads an image's manifest from the registry without pulling it.
 *
 * This is the cheap half of a pull: it resolves the tag to a digest and lists the
 * platforms the tag is published for, transferring a few kilobytes instead of the
 * whole image. That makes it the right primitive for "has a new version been
 * published?" — compare the returned digest against the digest of the image
 * currently running, and only pull when they differ. Doing the same with a pull
 * would download every layer just to find out nothing had changed.
 *
 * It also answers "does this tag exist for my architecture?" before a deploy
 * commits to it, which otherwise fails at container start on the wrong platform.
 */
export async function distributionInspect(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const reference = (this.getNodeParameter('imageReference', itemIndex) as string).trim();
    if (reference === '') throw new Error('Image Reference is required and cannot be empty.');
    const extra = this.getNodeParameter('additionalFields', itemIndex, {}) as RegistryAuth;

    const auth = authFrom(extra);
    const info = await docker
      .getImage(reference)
      .distribution(auth ? { authconfig: auth } : {});

    const platforms = (info.Platforms ?? []).map((p) => ({
      os: p.os ?? null,
      architecture: p.architecture ?? null,
      // Present only for architectures with revisions, e.g. arm/v7 — null rather
      // than an empty string, so an IF node can test it.
      variant: p.variant || null,
      osVersion: p['os.version'] || null,
      // Docker returns "linux/amd64" style strings nowhere in this response, but
      // it is what every user actually wants to match against.
      platform: [p.os, p.architecture, p.variant].filter(Boolean).join('/'),
    }));

    return {
      reference,
      digest: info.Descriptor?.digest ?? null,
      mediaType: info.Descriptor?.mediaType ?? null,
      // The size of the manifest itself, not of the image. Naming it plainly
      // avoids it being mistaken for the download size.
      manifestSizeBytes: info.Descriptor?.size ?? null,
      platforms,
      platformCount: platforms.length,
      isMultiPlatform: platforms.length > 1,
      pulled: false,
      inspectedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}
