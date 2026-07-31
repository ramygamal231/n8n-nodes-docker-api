import { sizeToMb, toIsoTimestamp } from './normalizePrimitives';

export interface NormalizedVolume {
  name: string;
  driver: string;
  scope: string;
  mountpoint: string;
  createdAt: string;
  /** Null when Docker did not compute usage; see usageKnown. */
  sizeMB: number | null;
  /** How many containers reference this volume, or null when not computed. */
  refCount: number | null;
  /**
   * Docker only calculates volume size and reference count when explicitly
   * asked, and signals "not calculated" with -1 rather than omitting the field.
   * Passing -1 through as a size would be nonsense, and reporting 0 would be a
   * lie, so both become null and this flag distinguishes the two cases.
   */
  usageKnown: boolean;
  inUse: boolean | null;
  labels: Record<string, string>;
  options: Record<string, string>;
}

interface RawVolume {
  Name?: string;
  Driver?: string;
  Scope?: string;
  Mountpoint?: string;
  CreatedAt?: string;
  Labels?: Record<string, string> | null;
  Options?: Record<string, string> | null;
  UsageData?: { Size?: number; RefCount?: number } | null;
}

export function normalizeVolume(
  raw: RawVolume,
  options: { includeLabels?: boolean } = {},
): NormalizedVolume {
  const includeLabels = options.includeLabels !== false;

  const rawSize = raw.UsageData?.Size;
  const rawRefs = raw.UsageData?.RefCount;
  const sizeKnown = typeof rawSize === 'number' && rawSize >= 0;
  const refsKnown = typeof rawRefs === 'number' && rawRefs >= 0;

  return {
    name: raw.Name ?? 'unknown',
    driver: raw.Driver ?? 'local',
    scope: raw.Scope ?? 'local',
    mountpoint: raw.Mountpoint ?? '',
    createdAt: toIsoTimestamp(raw.CreatedAt),
    sizeMB: sizeKnown ? sizeToMb(rawSize) : null,
    refCount: refsKnown ? (rawRefs as number) : null,
    usageKnown: sizeKnown || refsKnown,
    inUse: refsKnown ? (rawRefs as number) > 0 : null,
    labels: includeLabels ? (raw.Labels ?? {}) : {},
    options: raw.Options ?? {},
  };
}
