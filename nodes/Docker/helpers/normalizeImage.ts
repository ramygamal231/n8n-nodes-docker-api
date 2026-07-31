import { ImageInfo, ImageInspectInfo } from 'dockerode';

import { shortenDigest, sizeToMb, toIsoTimestamp } from './normalizePrimitives';

export interface NormalizedImage {
  id: string;
  shortId: string;
  tags: string[];
  /** First tag, or the short ID when the image is untagged (a "dangling" layer). */
  primaryTag: string;
  digests: string[];
  createdAt: string;
  sizeMB: number;
  labels: Record<string, string>;
  dangling: boolean;
}

/**
 * Images have the same two-shapes problem as containers: /images/json returns
 * ImageInfo with unix-second timestamps, /images/{name}/json returns
 * ImageInspectInfo with RFC3339. Both are reduced to one intermediate form
 * first so the output cannot diverge between list and inspect — the same
 * structural guarantee the container normaliser makes.
 */
interface CommonImageFields {
  id: string;
  tags: string[];
  digests: string[];
  createdAt: string;
  sizeBytes: number;
  labels: Record<string, string>;
}

const isInspectInfo = (raw: ImageInfo | ImageInspectInfo): raw is ImageInspectInfo =>
  'Config' in raw || 'Architecture' in raw;

function toCommonFields(raw: ImageInfo | ImageInspectInfo): CommonImageFields {
  if (isInspectInfo(raw)) {
    return {
      id: raw.Id,
      // Docker uses the literal "<none>:<none>" for untagged images; that is
      // noise in a workflow, so it is dropped rather than surfaced.
      tags: (raw.RepoTags ?? []).filter((t) => t && !t.startsWith('<none>')),
      digests: (raw.RepoDigests ?? []).filter(Boolean),
      createdAt: toIsoTimestamp(raw.Created),
      sizeBytes: raw.Size ?? 0,
      labels: raw.Config?.Labels ?? {},
    };
  }
  const list = raw as ImageInfo;
  return {
    id: list.Id,
    tags: (list.RepoTags ?? []).filter((t) => t && !t.startsWith('<none>')),
    digests: (list.RepoDigests ?? []).filter(Boolean),
    createdAt: toIsoTimestamp(list.Created),
    sizeBytes: list.Size ?? 0,
    labels: list.Labels ?? {},
  };
}

export interface NormalizeImageOptions {
  /** When false, `labels` is emitted empty rather than omitted — the key always exists. */
  includeLabels?: boolean;
}

export function normalizeImageInfo(
  raw: ImageInfo | ImageInspectInfo,
  options: NormalizeImageOptions = {},
): NormalizedImage {
  const includeLabels = options.includeLabels !== false;
  const common = toCommonFields(raw);
  const shortId = shortenDigest(common.id);

  return {
    id: common.id,
    shortId,
    tags: common.tags,
    primaryTag: common.tags[0] ?? shortId,
    digests: common.digests,
    createdAt: common.createdAt,
    sizeMB: sizeToMb(common.sizeBytes),
    labels: includeLabels ? common.labels : {},
    dangling: common.tags.length === 0,
  };
}
