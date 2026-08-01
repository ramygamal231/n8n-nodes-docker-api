import type Dockerode from 'dockerode';
import { DockerApi as Docker } from '../../../../utils/dockerApi';
import { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { translateDockerError } from '../../helpers/errorHandler';
import { normalizeImageInfo } from '../../helpers/normalizeImage';
import {
  emptyToNull,
  parseEnv,
  shortenDigest,
  sizeToMb,
  toArray,
  toIsoTimestamp,
} from '../../helpers/normalizePrimitives';

export async function listImages(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject[]> {
  try {
    const showAll = this.getNodeParameter('showAllImages', itemIndex, false) as boolean;
    const includeLabels = this.getNodeParameter('includeLabels', itemIndex, true) as boolean;
    const filters = this.getNodeParameter('imageFilters', itemIndex, {}) as {
      reference?: string;
      dangling?: boolean;
    };

    const listOptions: Dockerode.ListImagesOptions = { all: showAll };
    const dockerFilters: Record<string, string[]> = {};
    if (filters.dangling === true) dockerFilters.dangling = ['true'];
    if (Object.keys(dockerFilters).length) {
      (listOptions as unknown as { filters: unknown }).filters = dockerFilters;
    }

    const images = await docker.listImages(listOptions);
    let normalized = images.map((i) => normalizeImageInfo(i, { includeLabels }));

    // Reference filtering is done client-side so partial matches work the way
    // users expect ("alpine" matching "alpine:3.20"), which Docker's own
    // reference filter does not do.
    if (filters.reference) {
      const needle = filters.reference.toLowerCase();
      normalized = normalized.filter((img) =>
        img.tags.some((t) => t.toLowerCase().includes(needle)),
      );
    }

    return normalized as unknown as IDataObject[];
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function inspectImage(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const reference = (this.getNodeParameter('imageReference', itemIndex) as string).trim();
    const info = await docker.getImage(reference).inspect();
    const base = normalizeImageInfo(info);

    return {
      ...base,
      architecture: emptyToNull(info.Architecture),
      os: emptyToNull(info.Os),
      author: emptyToNull(info.Author),
      dockerVersion: emptyToNull(info.DockerVersion),
      parentId: emptyToNull(info.Parent),
      config: {
        entrypoint: toArray(info.Config?.Entrypoint),
        command: toArray(info.Config?.Cmd),
        workingDir: emptyToNull(info.Config?.WorkingDir),
        user: emptyToNull(info.Config?.User),
        env: parseEnv(info.Config?.Env),
        exposedPorts: Object.keys(info.Config?.ExposedPorts ?? {}),
        volumes: Object.keys(info.Config?.Volumes ?? {}),
      },
      layers: (info.RootFS?.Layers ?? []).length,
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function imageHistory(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const reference = (this.getNodeParameter('imageReference', itemIndex) as string).trim();
    const raw = (await docker.getImage(reference).history()) as unknown as Array<{
      Id: string;
      Created: number;
      CreatedBy: string;
      Size: number;
      Comment: string;
      Tags: string[] | null;
    }>;

    const layers = (raw ?? []).map((layer) => ({
      id: layer.Id === '<missing>' ? null : layer.Id,
      shortId: layer.Id === '<missing>' ? null : shortenDigest(layer.Id),
      createdAt: toIsoTimestamp(layer.Created),
      createdBy: layer.CreatedBy ?? '',
      sizeMB: sizeToMb(layer.Size),
      comment: emptyToNull(layer.Comment),
      tags: layer.Tags ?? [],
    }));

    return {
      image: reference,
      layers,
      layerCount: layers.length,
      totalSizeMB: Math.round(layers.reduce((sum, l) => sum + l.sizeMB, 0) * 100) / 100,
      retrievedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

/** Searches Docker Hub. Requires outbound internet access from the daemon. */
export async function searchImages(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject[]> {
  try {
    const term = (this.getNodeParameter('searchTerm', itemIndex) as string).trim();
    const limit = this.getNodeParameter('searchLimit', itemIndex, 25) as number;

    // Every other text input here rejects an empty value; search did not, and
    // instead sent the empty term to the registry and returned whatever came
    // back. A blank field is nearly always an expression that resolved to
    // nothing, and silently returning an arbitrary result set hides that.
    if (term === '') {
      throw new Error('Search Term is required and cannot be empty.');
    }

    const results = (await docker.searchImages({ term, limit })) as unknown as Array<{
      name: string;
      description: string;
      star_count: number;
      is_official: boolean;
      is_automated: boolean;
    }>;

    return (results ?? []).map((r) => ({
      name: r.name,
      description: r.description ?? '',
      stars: r.star_count ?? 0,
      official: r.is_official ?? false,
      automated: r.is_automated ?? false,
    })) as unknown as IDataObject[];
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}
