import { DockerApi as Docker } from '../../../../utils/dockerApi';
import { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { translateDockerError } from '../../helpers/errorHandler';
import { normalizeImageInfo } from '../../helpers/normalizeImage';
import { shortenDigest, sizeToMb } from '../../helpers/normalizePrimitives';

export async function tagImage(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const reference = (this.getNodeParameter('imageReference', itemIndex) as string).trim();
    const repo = (this.getNodeParameter('targetRepository', itemIndex) as string).trim();
    const tag = (this.getNodeParameter('targetTag', itemIndex, 'latest') as string).trim();

    if (repo === '') throw new Error('Target Repository is required and cannot be empty.');

    await docker.getImage(reference).tag({ repo, tag: tag || 'latest' });
    const info = await docker.getImage(`${repo}:${tag || 'latest'}`).inspect();

    return {
      ...normalizeImageInfo(info),
      tagged: true,
      sourceReference: reference,
      newTag: `${repo}:${tag || 'latest'}`,
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function removeImage(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const reference = (this.getNodeParameter('imageReference', itemIndex) as string).trim();
    const force = this.getNodeParameter('force', itemIndex, false) as boolean;
    const noPrune = this.getNodeParameter('noPrune', itemIndex, false) as boolean;
    const dryRun = this.getNodeParameter('dryRun', itemIndex, false) as boolean;

    // Resolve first so a dry run reports the real target and a missing image
    // fails identically whether or not dry run is on.
    const info = await docker.getImage(reference).inspect();
    const normalized = normalizeImageInfo(info);

    if (dryRun) {
      return {
        dryRun: true,
        action: 'removeImage',
        target: {
          id: normalized.id,
          shortId: normalized.shortId,
          tags: normalized.tags,
          sizeMB: normalized.sizeMB,
        },
        executed: false,
        message:
          `Dry run: image '${normalized.primaryTag}' (${normalized.shortId}, ` +
          `${normalized.sizeMB} MB) would have been removed.`,
      };
    }

    const deleted = (await docker.getImage(reference).remove({
      force,
      noprune: noPrune,
    })) as unknown as Array<{ Untagged?: string; Deleted?: string }>;

    const untagged = (deleted ?? []).map((d) => d.Untagged).filter(Boolean) as string[];
    const removedLayers = (deleted ?? []).map((d) => d.Deleted).filter(Boolean) as string[];

    return {
      removed: true,
      reference,
      id: normalized.id,
      shortId: normalized.shortId,
      untagged,
      layersDeleted: removedLayers.length,
      reclaimedMB: normalized.sizeMB,
      removedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

/**
 * Prune unused images.
 *
 * Unlike the other destructive operations, prune has no single target, so a dry
 * run cannot simply name what it would delete. Instead it lists the candidates
 * by asking Docker for the same set prune would act on, and reports the space
 * that would be reclaimed. Deleting images is not reversible, so seeing the list
 * first matters more here than anywhere else.
 */
export async function pruneImages(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const danglingOnly = this.getNodeParameter('danglingOnly', itemIndex, true) as boolean;
    const dryRun = this.getNodeParameter('dryRun', itemIndex, false) as boolean;

    // Docker's prune filter is inverted and easy to get wrong:
    //   dangling=true  -> only untagged images
    //   dangling=false -> ALL unused images, including tagged ones
    const filters = { dangling: [danglingOnly ? 'true' : 'false'] };

    if (dryRun) {
      const candidates = (
        await docker.listImages({
          filters: danglingOnly ? ({ dangling: ['true'] } as never) : undefined,
        })
      ).map((i) => normalizeImageInfo(i));

      // With danglingOnly off, Docker would remove every image not referenced by
      // a container, which listImages alone cannot determine - so say so rather
      // than present a possibly-short list as complete.
      const exact = danglingOnly;
      const totalMB = Math.round(candidates.reduce((s, c) => s + c.sizeMB, 0) * 100) / 100;

      return {
        dryRun: true,
        action: 'pruneImages',
        executed: false,
        danglingOnly,
        candidateCount: candidates.length,
        estimatedReclaimMB: totalMB,
        candidates: candidates.map((c) => ({
          shortId: c.shortId,
          primaryTag: c.primaryTag,
          sizeMB: c.sizeMB,
        })),
        exactList: exact,
        message: exact
          ? `Dry run: ${candidates.length} dangling image(s) would be removed, reclaiming about ${totalMB} MB.`
          : `Dry run: with "Dangling Only" disabled, Docker removes every image not used by a container. ` +
            `${candidates.length} image(s) exist locally; the actual set depends on which are in use at run time.`,
      };
    }

    const result = (await docker.pruneImages({ filters } as never)) as unknown as {
      ImagesDeleted?: Array<{ Untagged?: string; Deleted?: string }> | null;
      SpaceReclaimed?: number;
    };

    const deleted = result.ImagesDeleted ?? [];
    return {
      pruned: true,
      danglingOnly,
      imagesDeleted: deleted.length,
      untagged: deleted.map((d) => d.Untagged).filter(Boolean),
      layersDeleted: deleted.filter((d) => d.Deleted).length,
      reclaimedMB: sizeToMb(result.SpaceReclaimed),
      prunedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

/** Exported for tests: Docker's delete response is a mixed Untagged/Deleted list. */
export const summarizeDeletion = (
  deleted: Array<{ Untagged?: string; Deleted?: string }> | null | undefined,
) => ({
  untagged: (deleted ?? []).map((d) => d.Untagged).filter(Boolean) as string[],
  layers: (deleted ?? []).map((d) => d.Deleted).filter(Boolean) as string[],
  shortLayers: (deleted ?? [])
    .map((d) => (d.Deleted ? shortenDigest(d.Deleted) : null))
    .filter(Boolean) as string[],
});
