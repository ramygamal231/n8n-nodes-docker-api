import { toIsoTimestamp } from './normalizePrimitives';

export interface NormalizedEvent {
  type: string | null;
  action: string | null;
  actorId: string | null;
  shortId: string | null;
  name: string | null;
  image: string | null;
  scope: string | null;
  time: string;
  timeNano: string;
  attributes: Record<string, string>;
}

export interface RawEvent {
  Type?: string;
  Action?: string;
  scope?: string;
  time?: number;
  timeNano?: number;
  Actor?: { ID?: string; Attributes?: Record<string, string> };
}

/**
 * Splits Docker's event stream into whole JSON objects.
 *
 * The stream is newline-delimited JSON, but chunk boundaries fall wherever TCP
 * decides — routinely mid-object. Parsing each chunk on its own drops every
 * event that happened to be split, silently and unpredictably under load. The
 * parser therefore keeps a remainder between chunks and only parses complete
 * lines.
 */
export function createEventLineParser() {
  let remainder = '';

  return {
    /** Feed a chunk; returns whatever complete events it completed. */
    push(chunk: Buffer | string): RawEvent[] {
      remainder += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const lines = remainder.split('\n');
      // The final element is either an empty string (chunk ended on a newline)
      // or a partial line to carry forward.
      remainder = lines.pop() ?? '';

      const out: RawEvent[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        try {
          out.push(JSON.parse(trimmed) as RawEvent);
        } catch {
          // A malformed line is skipped rather than killing the listener.
        }
      }
      return out;
    },
    /** Anything still buffered when the stream ends. */
    flush(): RawEvent[] {
      const trimmed = remainder.trim();
      remainder = '';
      if (trimmed === '') return [];
      try {
        return [JSON.parse(trimmed) as RawEvent];
      } catch {
        return [];
      }
    },
  };
}

export function normalizeEvent(raw: RawEvent): NormalizedEvent {
  const actor = raw.Actor;
  const id = actor?.ID ?? null;
  return {
    type: raw.Type ?? null,
    action: raw.Action ?? null,
    actorId: id,
    shortId: id ? id.substring(0, 12) : null,
    name: actor?.Attributes?.name ?? null,
    image: actor?.Attributes?.image ?? null,
    scope: raw.scope ?? null,
    time: toIsoTimestamp(raw.time),
    // Kept as a string: nanosecond timestamps exceed Number.MAX_SAFE_INTEGER
    // and would lose precision, which matters because this is the dedupe key.
    timeNano: raw.timeNano !== undefined ? String(raw.timeNano) : '0',
    attributes: actor?.Attributes ?? {},
  };
}

/**
 * Decides whether an event has already been delivered.
 *
 * Docker's `since` is INCLUSIVE, so reconnecting with the last-seen timestamp
 * redelivers that event. Without this check every reconnect would fire the
 * workflow again for an event it already handled. Nanosecond values are compared
 * as BigInt because they overflow a JS number.
 */
export function isNewEvent(timeNano: string, lastSeenNano: string | undefined): boolean {
  if (!lastSeenNano || lastSeenNano === '0') return true;
  try {
    return BigInt(timeNano) > BigInt(lastSeenNano);
  } catch {
    return true;
  }
}

/** Exponential backoff, capped, so a daemon restart does not become a hot loop. */
export function nextBackoffMs(current: number, max = 30_000): number {
  return Math.min(current * 2, max);
}

/** Builds Docker's `filters` query object from the node's fields. */
export function buildEventFilters(spec: {
  eventTypes?: string[];
  actions?: string[];
  container?: string;
  image?: string;
  label?: string;
}): Record<string, string[]> {
  const filters: Record<string, string[]> = {};
  if (spec.eventTypes?.length) filters.type = spec.eventTypes;
  if (spec.actions?.length) filters.event = spec.actions;
  if (spec.container) filters.container = [spec.container];
  if (spec.image) filters.image = [spec.image];
  if (spec.label) filters.label = [spec.label];
  return filters;
}
