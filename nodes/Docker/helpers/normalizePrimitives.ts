/**
 * Primitives shared by every normaliser.
 *
 * Docker encodes the same concept differently depending on the endpoint: list
 * responses use unix seconds while inspect responses use RFC3339 with
 * nanoseconds, sizes are raw bytes, "unset" is sometimes an empty string and
 * sometimes a zero timestamp. Centralising the conversions is what keeps the
 * container and image shapes consistent with each other rather than each
 * re-deriving its own conventions.
 */

/** Accepts unix seconds, RFC3339, or RFC3339 with nanoseconds; always emits ISO with ms. */
export function toIsoTimestamp(raw: string | number | undefined | null): string {
  if (raw === undefined || raw === null || raw === '') return new Date(0).toISOString();
  if (typeof raw === 'number') return new Date(raw * 1000).toISOString();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return new Date(0).toISOString();
  // Date() truncates sub-millisecond precision, normalising
  // "2026-07-31T13:42:39.344492418Z" to "2026-07-31T13:42:39.344Z".
  return parsed.toISOString();
}

/** Docker writes "0001-01-01T00:00:00Z" for timestamps that never happened. */
export function toNullableTimestamp(raw: string | undefined | null): string | null {
  if (!raw || raw.startsWith('0001-01-01')) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export const emptyToNull = (v: string | undefined | null): string | null =>
  v === undefined || v === null || v === '' ? null : v;

export const toArray = (v: string[] | string | undefined | null): string[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];

/** Bytes to MB, two decimals. Returns null for 0/absent, which Docker uses for "unlimited". */
export function bytesToMb(bytes: number | undefined | null): number | null {
  if (!bytes || bytes <= 0) return null;
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

/** Bytes to MB where zero is a genuine value rather than "unlimited". */
export function sizeToMb(bytes: number | undefined | null): number {
  if (!bytes || bytes <= 0) return 0;
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

/** Docker returns env as ["KEY=value"]; an object is far easier to use downstream. */
export function parseEnv(env: string[] | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of env ?? []) {
    const idx = entry.indexOf('=');
    if (idx === -1) {
      out[entry] = '';
      continue;
    }
    out[entry.slice(0, idx)] = entry.slice(idx + 1);
  }
  return out;
}

/** Strips the algorithm prefix so "sha256:abc123..." shortens to "abc123456789". */
export function shortenDigest(id: string | undefined | null, length = 12): string {
  if (!id) return '';
  const withoutAlgo = id.includes(':') ? id.split(':').slice(1).join(':') : id;
  return withoutAlgo.substring(0, length);
}
