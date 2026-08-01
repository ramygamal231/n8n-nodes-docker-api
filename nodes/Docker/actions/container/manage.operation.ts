import { DockerApi as Docker } from '../../../../utils/dockerApi';
import { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { translateDockerError } from '../../helpers/errorHandler';
import { normalizeContainerInfo } from '../../helpers/normalizeContainer';
import { dryRunResult, resolveTarget } from '../../helpers/containerTarget';

/** Remove a container, optionally forcing it and taking its anonymous volumes with it. */
export async function removeContainer(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;
    const force = this.getNodeParameter('force', itemIndex, false) as boolean;
    const removeVolumes = this.getNodeParameter('removeVolumes', itemIndex, false) as boolean;
    const dryRun = this.getNodeParameter('dryRun', itemIndex, false) as boolean;

    const target = await resolveTarget(docker, containerId);

    if (dryRun) {
      const extras = [
        force ? 'force-stopping it first' : null,
        removeVolumes ? 'and removing its anonymous volumes' : null,
      ]
        .filter(Boolean)
        .join(' ');
      return dryRunResult(
        'remove',
        target,
        `container '${target.name}' (${target.shortId}) would have been removed` +
          (extras ? `, ${extras}.` : '.'),
      );
    }

    // Capture identity before removal - afterwards there is nothing left to inspect.
    const snapshot = { id: target.id, shortId: target.shortId, name: target.name };
    await target.container.remove({ force, v: removeVolumes });

    return {
      ...snapshot,
      removed: true,
      forced: force,
      volumesRemoved: removeVolumes,
      removedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function renameContainer(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;
    const newName = (this.getNodeParameter('newName', itemIndex) as string).trim();
    if (newName === '') {
      throw new Error('New Name is required and cannot be empty.');
    }

    const target = await resolveTarget(docker, containerId);
    const previousName = target.name;
    await target.container.rename({ name: newName });

    const info = await target.container.inspect();
    return { ...normalizeContainerInfo(info), previousName };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

/** Running processes inside a container, as a list of objects rather than parallel arrays. */
export async function topContainer(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;
    const psArgs = (this.getNodeParameter('psArgs', itemIndex, '') as string).trim();

    const target = await resolveTarget(docker, containerId);
    const raw = (await target.container.top(
      psArgs ? ({ ps_args: psArgs } as never) : undefined,
    )) as unknown as { Titles?: string[]; Processes?: string[][] };

    // Docker returns column titles and rows separately; zip them into objects so
    // downstream nodes can reference process.pid rather than process[1].
    const titles = raw.Titles ?? [];
    const processes = (raw.Processes ?? []).map((row) => {
      const obj: Record<string, string> = {};
      titles.forEach((title, i) => {
        obj[title.toLowerCase().replace(/[^a-z0-9]+/g, '')] = row[i] ?? '';
      });
      return obj;
    });

    return {
      containerId: target.id,
      shortId: target.shortId,
      containerName: target.name,
      titles,
      processes,
      processCount: processes.length,
      retrievedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

/** Docker's Kind enum for a changed path. */
const CHANGE_KINDS = ['modified', 'added', 'deleted'] as const;

/**
 * Normalises whatever /containers/{id}/changes hands back.
 *
 * Two traps here, both hit in real testing:
 *
 *  1. dockerode returns this endpoint's body as a raw **Buffer** of JSON text,
 *     not parsed JSON. Calling .map() on a Buffer silently returns another
 *     Buffer with every element coerced to a number, which produced
 *     `{"type":"Buffer","data":[0,0,0,0,0]}` instead of a list of changes.
 *  2. Docker sends literal `null` - not `[]` - when the filesystem is unchanged,
 *     which is five bytes ("null\n") and crashes anything assuming an array.
 */
export function parseChanges(raw: unknown): Array<{ path: string; kind: string }> {
  let value: unknown = raw;

  if (Buffer.isBuffer(value) || typeof value === 'string') {
    const text = (Buffer.isBuffer(value) ? value.toString('utf8') : value).trim();
    if (text === '' || text === 'null') return [];
    try {
      value = JSON.parse(text);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(value)) return [];

  return value
    .filter((c): c is { Path: string; Kind: number } => !!c && typeof c === 'object')
    .map((c) => ({
      path: String(c.Path ?? ''),
      kind: CHANGE_KINDS[c.Kind] ?? 'unknown',
    }));
}

/** Filesystem changes relative to the image. Docker returns null when there are none. */
export async function containerChanges(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;
    const target = await resolveTarget(docker, containerId);

    const changes = parseChanges(await target.container.changes());

    return {
      containerId: target.id,
      shortId: target.shortId,
      containerName: target.name,
      changes,
      changeCount: changes.length,
      retrievedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}
