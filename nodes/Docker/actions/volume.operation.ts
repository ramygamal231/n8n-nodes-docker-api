import Docker from 'dockerode';
import { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { translateDockerError } from '../helpers/errorHandler';
import { normalizeVolume } from '../helpers/normalizeVolume';
import { sizeToMb } from '../helpers/normalizePrimitives';

interface KeyValueEntry {
  entry?: Array<{ name: string; value: string }>;
}

const pairsToObject = (raw: KeyValueEntry | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const { name, value } of raw?.entry ?? []) {
    if (name) out[name] = value ?? '';
  }
  return out;
};

export async function listVolumes(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject[]> {
  try {
    const includeLabels = this.getNodeParameter('includeLabels', itemIndex, true) as boolean;
    const filters = this.getNodeParameter('volumeFilters', itemIndex, {}) as {
      name?: string;
      danglingOnly?: boolean;
    };

    const dockerFilters: Record<string, string[]> = {};
    if (filters.danglingOnly === true) dockerFilters.dangling = ['true'];

    const result = (await docker.listVolumes(
      Object.keys(dockerFilters).length ? ({ filters: dockerFilters } as never) : undefined,
    )) as unknown as { Volumes?: Array<Record<string, unknown>> | null; Warnings?: string[] };

    let normalized = (result.Volumes ?? []).map((v) => normalizeVolume(v, { includeLabels }));

    if (filters.name) {
      const needle = filters.name.toLowerCase();
      normalized = normalized.filter((v) => v.name.toLowerCase().includes(needle));
    }

    return normalized as unknown as IDataObject[];
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function inspectVolume(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const name = (this.getNodeParameter('volumeName', itemIndex) as string).trim();
    const raw = (await docker.getVolume(name).inspect()) as unknown as Record<string, unknown>;
    return normalizeVolume(raw) as unknown as IDataObject;
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function createVolume(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const name = (this.getNodeParameter('volumeName', itemIndex) as string).trim();
    if (name === '') throw new Error('Volume Name is required and cannot be empty.');

    const labelPairs = this.getNodeParameter('labels', itemIndex, {}) as KeyValueEntry;
    const extra = this.getNodeParameter('additionalFields', itemIndex, {}) as {
      driver?: string;
    };

    const labels = pairsToObject(labelPairs);
    const created = (await docker.createVolume({
      Name: name,
      Driver: extra.driver || 'local',
      Labels: Object.keys(labels).length ? labels : undefined,
    })) as unknown as Record<string, unknown>;

    return { ...(normalizeVolume(created) as unknown as IDataObject), created: true };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function removeVolume(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const name = (this.getNodeParameter('volumeName', itemIndex) as string).trim();
    const force = this.getNodeParameter('force', itemIndex, false) as boolean;
    const dryRun = this.getNodeParameter('dryRun', itemIndex, false) as boolean;

    const raw = (await docker.getVolume(name).inspect()) as unknown as Record<string, unknown>;
    const vol = normalizeVolume(raw);

    if (dryRun) {
      return {
        dryRun: true,
        action: 'removeVolume',
        target: { name: vol.name, driver: vol.driver, mountpoint: vol.mountpoint },
        executed: false,
        // A volume's data is gone for good once removed, so say what is known
        // about whether anything is still using it.
        inUse: vol.inUse,
        usageKnown: vol.usageKnown,
        message:
          `Dry run: volume '${vol.name}' would have been removed.` +
          (vol.inUse === true
            ? ' It is currently in use and removal would fail without Force.'
            : vol.usageKnown
              ? ' It is not currently in use.'
              : ' Docker did not report usage, so whether it is in use is unknown.'),
      };
    }

    await docker.getVolume(vol.name).remove({ force });
    return {
      removed: true,
      name: vol.name,
      driver: vol.driver,
      mountpoint: vol.mountpoint,
      forced: force,
      removedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function pruneVolumes(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const dryRun = this.getNodeParameter('dryRun', itemIndex, false) as boolean;

    if (dryRun) {
      // Docker prunes volumes with no container references. Asking for dangling
      // volumes gives exactly that set.
      const result = (await docker.listVolumes({
        filters: { dangling: ['true'] },
      } as never)) as unknown as { Volumes?: Array<Record<string, unknown>> | null };
      const candidates = (result.Volumes ?? []).map((v) => normalizeVolume(v));
      const known = candidates.filter((c) => c.sizeMB !== null);
      const totalMB = Math.round(known.reduce((s, c) => s + (c.sizeMB ?? 0), 0) * 100) / 100;

      return {
        dryRun: true,
        action: 'pruneVolumes',
        executed: false,
        candidateCount: candidates.length,
        candidates: candidates.map((c) => ({
          name: c.name,
          driver: c.driver,
          sizeMB: c.sizeMB,
        })) as unknown as IDataObject[],
        estimatedReclaimMB: totalMB,
        // Docker only computes volume sizes on request, so the estimate can be
        // based on a subset. Saying so beats quoting a confidently wrong number.
        sizeKnownFor: known.length,
        exactList: true,
        message:
          `Dry run: ${candidates.length} unused volume(s) would be removed.` +
          (known.length === candidates.length
            ? ` About ${totalMB} MB would be reclaimed.`
            : ` Size is known for ${known.length} of them; at least ${totalMB} MB would be reclaimed.`),
      };
    }

    const result = (await docker.pruneVolumes()) as unknown as {
      VolumesDeleted?: string[] | null;
      SpaceReclaimed?: number;
    };
    const deleted = result.VolumesDeleted ?? [];
    return {
      pruned: true,
      volumesDeleted: deleted.length,
      names: deleted,
      reclaimedMB: sizeToMb(result.SpaceReclaimed),
      prunedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}
