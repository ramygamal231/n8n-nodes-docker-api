import { DockerApi as Docker } from '../../../../utils/dockerApi';
import { Readable } from 'stream';
import { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { translateDockerError } from '../../helpers/errorHandler';
import { normalizeImageInfo } from '../../helpers/normalizeImage';
import { sizeToMb } from '../../helpers/normalizePrimitives';
import { packTar } from '../../helpers/tarUtils';
import { followProgress, ProgressStreamError, summarizeProgress } from './registry.operation';
import { resolveTarget } from '../../helpers/containerTarget';

interface KeyValueEntry {
  entry?: Array<{ name: string; value: string }>;
}

const pairs = (raw: KeyValueEntry | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const { name, value } of raw?.entry ?? []) if (name) out[name] = value ?? '';
  return out;
};

/**
 * Builds an image.
 *
 * Docker builds from a *context* — a tar archive whose contents become the build
 * directory. That is awkward to produce inside a workflow, so two routes are
 * offered:
 *
 *   Dockerfile text  — the common case. The text is packed into a one-file tar
 *                      here, which covers any build that does not COPY local
 *                      files (FROM, RUN, ENV, CMD, and so on).
 *   Binary context   — a tar supplied on the incoming item, for builds that do
 *                      need local files.
 *
 * Offering only the second would make the simple case unreasonably hard; offering
 * only the first would make COPY impossible.
 */
export async function buildImage(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const source = this.getNodeParameter('contextSource', itemIndex, 'dockerfile') as
      | 'dockerfile'
      | 'binary';
    const tag = (this.getNodeParameter('imageTag', itemIndex) as string).trim();
    const extra = this.getNodeParameter('additionalFields', itemIndex, {}) as {
      buildArgs?: KeyValueEntry;
      labels?: KeyValueEntry;
      noCache?: boolean;
      pullBaseImage?: boolean;
      target?: string;
      dockerfileName?: string;
    };

    if (tag === '') throw new Error('Image Tag is required and cannot be empty.');

    let context: Readable;
    let dockerfileName = extra.dockerfileName || 'Dockerfile';

    if (source === 'binary') {
      const property = (this.getNodeParameter('binaryPropertyName', itemIndex, 'data') as string).trim();
      this.helpers.assertBinaryData(itemIndex, property);
      const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, property);
      context = Readable.from(buffer);
    } else {
      const dockerfile = (this.getNodeParameter('dockerfile', itemIndex, '') as string).trim();
      if (dockerfile === '') {
        throw new Error('Dockerfile is required when building from Dockerfile text.');
      }
      dockerfileName = 'Dockerfile';
      context = Readable.from(await packTar(dockerfileName, Buffer.from(dockerfile, 'utf8')));
    }

    const startedAt = Date.now();
    const buildArgs = pairs(extra.buildArgs);
    const labels = pairs(extra.labels);

    const stream = (await docker.buildImage(context as never, {
      t: tag,
      dockerfile: dockerfileName,
      nocache: extra.noCache === true,
      pull: extra.pullBaseImage === true ? 'true' : undefined,
      target: extra.target || undefined,
      // Docker expects these as JSON-encoded query parameters, not objects.
      buildargs: Object.keys(buildArgs).length ? JSON.stringify(buildArgs) : undefined,
      labels: Object.keys(labels).length ? JSON.stringify(labels) : undefined,
    } as never)) as unknown as Readable;

    // A build reports failures inside a 200 response, exactly like pull and push:
    // a broken Dockerfile yields {"errorDetail":...} mid-stream, not an HTTP error.
    const { events } = await followProgress(docker, stream);
    const summary = summarizeProgress(events);

    // Collect the build log so a failed or noisy build is diagnosable.
    const log = events
      .map((e) => (e as { stream?: string }).stream)
      .filter((s): s is string => typeof s === 'string')
      .join('')
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l !== '');

    const info = await docker.getImage(tag).inspect();

    return {
      ...normalizeImageInfo(info),
      built: true,
      tag,
      contextSource: source,
      steps: log.filter((l) => /^Step \d+\/\d+/.test(l)).length,
      log,
      status: summary.finalStatus,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const removed = await cleanUpFailedBuild(docker, error);
    const base = translateDockerError(error);
    throw new Error(removed ? `${base} ${removed}` : base);
  }
}

/** The `---> Running in <id>` line Docker emits before each build step. */
const RUNNING_IN = /--->\s*Running in ([0-9a-f]{8,64})/g;

/**
 * Removes the container a failed build left behind.
 *
 * Docker's classic builder runs each step in a throwaway container and deletes it
 * once the step succeeds. When a step fails it keeps that container instead, so
 * you can attach to it and work out why — which is a sensible default at a
 * terminal, and the wrong one here. Nobody is watching a scheduled workflow, and
 * a build that fails every night quietly accumulates a container per run until
 * the disk fills. Each one is invisible in the node's output, since the build
 * reported an error and returned nothing.
 *
 * The container is created by this build and referenced by nothing else, so
 * removing it is safe. Failure to remove it is reported rather than swallowed —
 * a leak the user is told about can be cleaned up; a silent one cannot.
 */
async function cleanUpFailedBuild(docker: Docker, error: unknown): Promise<string | null> {
  const events = error instanceof ProgressStreamError ? error.events : [];
  if (!events.length) return null;

  const log = events
    .map((e) => (e as { stream?: string }).stream)
    .filter((s): s is string => typeof s === 'string')
    .join('');

  // The last one is the step that failed; earlier steps removed their own.
  const ids = [...log.matchAll(RUNNING_IN)].map((m) => m[1]);
  const id = ids[ids.length - 1];
  if (!id) return null;

  try {
    await docker.getContainer(id).remove({ force: true });
    return `The container from the failed build step was removed (${id.slice(0, 12)}).`;
  } catch (removeError) {
    // A 404 means Docker already cleaned it up — nothing was leaked, so there is
    // nothing worth telling the user about.
    if ((removeError as { statusCode?: number })?.statusCode === 404) return null;
    return (
      `The build also left a container behind (${id.slice(0, 12)}) which could not be ` +
      `removed automatically — remove it manually to reclaim the space.`
    );
  }
}

/** Creates an image from a container's current state. */
export async function commitContainer(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const containerId = (this.getNodeParameter('sourceContainer', itemIndex) as string).trim();
    const repo = (this.getNodeParameter('targetRepository', itemIndex) as string).trim();
    const tag = (this.getNodeParameter('targetTag', itemIndex, 'latest') as string).trim() || 'latest';
    const extra = this.getNodeParameter('additionalFields', itemIndex, {}) as {
      comment?: string;
      author?: string;
      pauseContainer?: boolean;
    };

    if (repo === '') throw new Error('Target Repository is required and cannot be empty.');

    const target = await resolveTarget(docker, containerId);
    const result = (await target.container.commit({
      repo,
      tag,
      comment: extra.comment || undefined,
      author: extra.author || undefined,
      // Docker pauses the container during commit by default, so the filesystem
      // is not changing underneath the snapshot. Left on unless asked otherwise.
      pause: extra.pauseContainer !== false,
    })) as unknown as { Id?: string };

    const info = await docker.getImage(`${repo}:${tag}`).inspect();
    return {
      ...normalizeImageInfo(info),
      committed: true,
      sourceContainer: target.name,
      sourceContainerId: target.id,
      newTag: `${repo}:${tag}`,
      rawId: result?.Id ?? null,
      committedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

/** Exports an image as a tar archive, for backup or transfer to an offline host. */
export async function saveImage(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<INodeExecutionData> {
  try {
    const reference = (this.getNodeParameter('imageReference', itemIndex) as string).trim();
    const property = (this.getNodeParameter('binaryPropertyName', itemIndex, 'data') as string).trim();

    // Resolve first so a bad reference fails clearly rather than producing an
    // empty archive.
    const info = await docker.getImage(reference).inspect();
    const stream = (await docker.getImage(reference).get()) as unknown as Readable;
    const fileName = `${reference.replace(/[^a-zA-Z0-9._-]/g, '_')}.tar`;

    return {
      json: {
        image: reference,
        id: info.Id,
        fileName,
        format: 'tar',
        sizeMB: sizeToMb(info.Size),
        savedAt: new Date().toISOString(),
      },
      binary: {
        [property]: await this.helpers.prepareBinaryData(stream, fileName, 'application/x-tar'),
      },
      pairedItem: itemIndex,
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

/** Imports images from a tar archive produced by Save Image. */
export async function loadImage(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const property = (this.getNodeParameter('binaryPropertyName', itemIndex, 'data') as string).trim();
    this.helpers.assertBinaryData(itemIndex, property);
    const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, property);

    const startedAt = Date.now();
    const stream = (await docker.loadImage(Readable.from(buffer))) as unknown as Readable;
    const { events } = await followProgress(docker, stream);

    // Docker reports what it loaded as free text, e.g.
    // "Loaded image: alpine:latest" — the only machine-readable signal available.
    const loaded: string[] = [];
    for (const e of events) {
      const text = (e as { stream?: string }).stream ?? '';
      const match = text.match(/Loaded image(?: ID)?:\s*(\S+)/);
      if (match) loaded.push(match[1]);
    }

    return {
      loaded: true,
      images: loaded,
      imageCount: loaded.length,
      sizeBytes: buffer.length,
      durationMs: Date.now() - startedAt,
      loadedAt: new Date().toISOString(),
      message: loaded.length
        ? `Loaded ${loaded.length} image(s): ${loaded.join(', ')}`
        : 'The archive was accepted but Docker reported no image names.',
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

/**
 * Reclaims the builder cache.
 *
 * Usually the single largest recoverable space on a machine that builds images —
 * it is invisible to image pruning and often dwarfs the images themselves.
 */
export async function pruneBuildCache(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const dryRun = this.getNodeParameter('dryRun', itemIndex, false) as boolean;

    if (dryRun) {
      // There is no endpoint that lists build cache entries, so the reclaimable
      // figure comes from disk usage rather than a per-entry list. Saying that
      // beats presenting an invented breakdown.
      const df = (await docker.df()) as unknown as {
        BuildCache?: Array<{ Size?: number; InUse?: boolean }> | null;
      };
      const cache = df.BuildCache ?? [];
      const reclaimable = cache.filter((c) => !c.InUse);
      const totalMB = sizeToMb(reclaimable.reduce((s, c) => s + (c.Size ?? 0), 0));

      return {
        dryRun: true,
        action: 'pruneBuildCache',
        executed: false,
        cacheEntries: cache.length,
        reclaimableEntries: reclaimable.length,
        estimatedReclaimMB: totalMB,
        exactList: false,
        message:
          `Dry run: ${reclaimable.length} of ${cache.length} build cache entr(ies) are unused, ` +
          `about ${totalMB} MB. Docker provides no per-entry listing for the build cache, so ` +
          `this is a total rather than an itemised preview.`,
      };
    }

    const result = (await docker.pruneBuilder()) as unknown as {
      CachesDeleted?: string[] | null;
      SpaceReclaimed?: number;
    };
    return {
      pruned: true,
      entriesDeleted: (result.CachesDeleted ?? []).length,
      reclaimedMB: sizeToMb(result.SpaceReclaimed),
      prunedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}
