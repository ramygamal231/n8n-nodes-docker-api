/**
 * Retrying transient connection failures, at the level of a single Docker API
 * request.
 *
 * The problem this solves is real: a daemon restart, a socket briefly losing its
 * permissions, or a proxy hiccup fails a workflow step that would have succeeded
 * a second later.
 *
 * n8n's built-in Retry On Fail does not solve it. It retries the whole NODE, so
 * every item that already succeeded runs again — measured, not assumed: a node
 * with two succeeding items and one failing item executed the succeeding two
 * three times each. For reads that is waste; for writes it means creating a
 * container twice or running a command twice. Filtering which errors trigger the
 * retry does not help, because the flaw is the granularity, not the trigger.
 *
 * So retry lives here instead, wrapped around one HTTP request, where two things
 * can be known precisely that are unknowable higher up:
 *
 *  1. WHICH request failed — never re-running work that already succeeded.
 *  2. WHETHER the daemon could have acted on it. That distinction is the whole
 *     safety argument, and it is why this is not simply "retry on network error".
 */

/**
 * Errors raised while establishing the connection. The request was never
 * delivered, so the daemon cannot have acted on it and a retry cannot repeat
 * anything — true regardless of HTTP method.
 */
const CONNECT_PHASE_CODES = new Set([
  'ECONNREFUSED', // nothing listening
  'ENOENT', // unix socket / named pipe absent
  'EACCES', // socket permissions — the case that "bit us in prod"
  'EPERM',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EAI_AGAIN', // transient DNS failure
  'ECONNABORTED',
]);

/**
 * Errors raised after the request was already on the wire. The daemon may have
 * received and acted on it before the connection broke, so repeating a write
 * could apply it twice.
 */
const IN_FLIGHT_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ESOCKETTIMEDOUT']);

/** HTTP methods safe to repeat after a possible partial delivery. */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type RetryPhase = 'connect' | 'in-flight' | 'permanent';

export interface RetryOptions {
  enabled: boolean;
  maxAttempts: number;
  initialDelayMs: number;
}

export const DEFAULT_RETRY: RetryOptions = {
  enabled: true,
  maxAttempts: 3,
  initialDelayMs: 500,
};

function errorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } };
  const direct = typeof e?.code === 'string' ? e.code : undefined;
  const nested = typeof e?.cause?.code === 'string' ? (e.cause.code as string) : undefined;
  return direct ?? nested;
}

/**
 * Which kind of failure this is.
 *
 * Anything Docker answered — a 404, a 409, a refused registry login — is
 * permanent by definition: the daemon was reachable and gave a considered reply.
 * Retrying it would only bury a configuration problem under a delay, which is
 * precisely the failure mode worth avoiding.
 */
export function classifyFailure(error: unknown): RetryPhase {
  // A response carrying a status code means the daemon replied. The exception is
  // the 5xx range a PROXY emits when it cannot reach its upstream: Portainer or a
  // TLS terminator answering 502/503/504 means the request never arrived.
  const status = (error as { statusCode?: number })?.statusCode;
  if (typeof status === 'number') {
    return status === 502 || status === 503 || status === 504 ? 'connect' : 'permanent';
  }

  const code = errorCode(error);
  if (code && CONNECT_PHASE_CODES.has(code)) return 'connect';
  if (code && IN_FLIGHT_CODES.has(code)) return 'in-flight';

  // Node reports a mid-request disconnect with these messages and no useful code.
  // "aborted" in particular is what surfaces when the response is cut off partway
  // — measured against a real endpoint killed mid-request. Left unclassified it
  // fell through to permanent, which reached the user as the bare word "aborted"
  // and said nothing about whether the daemon had acted.
  const message = String((error as Error)?.message ?? '').toLowerCase();
  if (message.includes('socket hang up')) return 'in-flight';
  if (message.includes('aborted')) return 'in-flight';
  if (message.includes('timeout') || message.includes('timed out')) return 'in-flight';

  return 'permanent';
}

/**
 * Should this failure be retried for a request using this method?
 *
 * A connect-phase failure is always safe. An in-flight failure is safe only for
 * a read, because a write may already have been applied — and a container
 * created twice is a worse outcome than a workflow that fails honestly.
 */
export function shouldRetry(error: unknown, method: string): boolean {
  const phase = classifyFailure(error);
  if (phase === 'permanent') return false;
  if (phase === 'connect') return true;
  return IDEMPOTENT_METHODS.has(method.toUpperCase());
}

/** Exponential backoff: 500ms, 1s, 2s, … capped so a retry never stalls a workflow. */
export function backoffMs(attempt: number, initialDelayMs: number): number {
  return Math.min(initialDelayMs * 2 ** (attempt - 1), 8000);
}

/**
 * Explains a failure that was NOT retried but looked like it might have been, so
 * "we gave up" is never confused with "we did not try".
 */
export function describeUnretried(error: unknown, method: string): string | null {
  if (classifyFailure(error) !== 'in-flight') return null;
  if (IDEMPOTENT_METHODS.has(method.toUpperCase())) return null;
  return (
    'The connection to Docker broke after the request had been sent, so it is not known ' +
    'whether the daemon carried it out. It was deliberately not retried, because repeating ' +
    'it could apply the same change twice. Check the current state before running this again.'
  );
}

export function resolveRetryOptions(raw: unknown): RetryOptions {
  const o = (raw ?? {}) as Partial<{
    enabled: boolean;
    maxAttempts: number;
    initialDelayMs: number;
  }>;
  const enabled = o.enabled !== false;
  const maxAttempts = Number.isFinite(o.maxAttempts) ? Number(o.maxAttempts) : DEFAULT_RETRY.maxAttempts;
  const initialDelayMs = Number.isFinite(o.initialDelayMs)
    ? Number(o.initialDelayMs)
    : DEFAULT_RETRY.initialDelayMs;
  return {
    enabled,
    // One attempt means no retry at all; anything below that is meaningless.
    maxAttempts: Math.max(1, Math.min(10, Math.floor(maxAttempts))),
    initialDelayMs: Math.max(0, Math.min(30_000, Math.floor(initialDelayMs))),
  };
}
