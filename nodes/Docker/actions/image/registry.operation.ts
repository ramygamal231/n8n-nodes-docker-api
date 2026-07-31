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
export function followProgress(
  docker: Docker,
  stream: Readable,
): Promise<{ events: ProgressEvent[] }> {
  return new Promise((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err: Error | null, output: ProgressEvent[]) => {
        if (err) return reject(err);
        const failure = (output ?? []).find((e) => e.error);
        if (failure) {
          return reject(
            new Error(failure.errorDetail?.message ?? failure.error ?? 'Unknown registry error'),
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
