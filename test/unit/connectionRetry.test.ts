import {
  backoffMs,
  classifyFailure,
  describeUnretried,
  resolveRetryOptions,
  shouldRetry,
} from '../../utils/connectionRetry';

const err = (code: string) => Object.assign(new Error(code), { code });
const httpErr = (statusCode: number) =>
  Object.assign(new Error(`(HTTP code ${statusCode})`), { statusCode });

describe('classifyFailure', () => {
  it('treats failures to establish a connection as connect-phase', () => {
    for (const code of ['ECONNREFUSED', 'ENOENT', 'EACCES', 'EHOSTUNREACH', 'ENETUNREACH']) {
      expect(classifyFailure(err(code))).toBe('connect');
    }
  });

  it('treats a break after the request was sent as in-flight', () => {
    for (const code of ['ECONNRESET', 'EPIPE', 'ETIMEDOUT']) {
      expect(classifyFailure(err(code))).toBe('in-flight');
    }
    // Node reports a mid-request disconnect this way, with no useful code.
    expect(classifyFailure(new Error('socket hang up'))).toBe('in-flight');
  });

  it('treats anything Docker answered as permanent', () => {
    // The daemon was reachable and gave a considered reply. Retrying only buries
    // a real problem under a delay.
    for (const status of [400, 404, 409, 500]) {
      expect(classifyFailure(httpErr(status))).toBe('permanent');
    }
  });

  it('treats a proxy 502/503/504 as connect-phase, not as a Docker answer', () => {
    // Portainer or a TLS terminator answering these means it could not reach its
    // upstream, so the request never arrived at the daemon.
    for (const status of [502, 503, 504]) {
      expect(classifyFailure(httpErr(status))).toBe('connect');
    }
  });

  it('reads a code nested under cause', () => {
    expect(classifyFailure({ cause: { code: 'ECONNREFUSED' } })).toBe('connect');
  });

  it('defaults to permanent when it cannot tell', () => {
    // Retrying an unrecognised failure risks repeating a write for no reason.
    expect(classifyFailure(new Error('something unfamiliar'))).toBe('permanent');
  });
});

describe('shouldRetry', () => {
  it('retries a connect-phase failure for any method, including writes', () => {
    // The request never reached the daemon, so nothing can be repeated.
    for (const method of ['GET', 'POST', 'DELETE', 'PUT']) {
      expect(shouldRetry(err('ECONNREFUSED'), method)).toBe(true);
    }
  });

  it('retries an in-flight failure only for reads', () => {
    expect(shouldRetry(err('ECONNRESET'), 'GET')).toBe(true);
    expect(shouldRetry(err('ECONNRESET'), 'HEAD')).toBe(true);
    // The daemon may already have created the container. Retrying could make two.
    expect(shouldRetry(err('ECONNRESET'), 'POST')).toBe(false);
    expect(shouldRetry(err('ECONNRESET'), 'DELETE')).toBe(false);
  });

  it('never retries what Docker answered', () => {
    expect(shouldRetry(httpErr(404), 'GET')).toBe(false);
    expect(shouldRetry(httpErr(409), 'POST')).toBe(false);
  });

  it('is case-insensitive about the method', () => {
    expect(shouldRetry(err('ECONNRESET'), 'get')).toBe(true);
    expect(shouldRetry(err('ECONNRESET'), 'post')).toBe(false);
  });
});

describe('describeUnretried', () => {
  it('explains a write that broke mid-flight', () => {
    const msg = describeUnretried(err('ECONNRESET'), 'POST');
    expect(msg).toContain('not known');
    expect(msg).toContain('apply the same change twice');
  });

  it('says nothing when the failure was retried or is permanent', () => {
    expect(describeUnretried(err('ECONNRESET'), 'GET')).toBeNull();
    expect(describeUnretried(err('ECONNREFUSED'), 'POST')).toBeNull();
    expect(describeUnretried(httpErr(404), 'POST')).toBeNull();
  });
});

describe('backoffMs', () => {
  it('doubles each attempt', () => {
    expect(backoffMs(1, 500)).toBe(500);
    expect(backoffMs(2, 500)).toBe(1000);
    expect(backoffMs(3, 500)).toBe(2000);
  });

  it('caps so a retry never stalls a workflow', () => {
    expect(backoffMs(20, 500)).toBe(8000);
  });
});

describe('resolveRetryOptions', () => {
  it('defaults to enabled when nothing is configured', () => {
    expect(resolveRetryOptions({})).toEqual({
      enabled: true,
      maxAttempts: 3,
      initialDelayMs: 500,
    });
    expect(resolveRetryOptions(undefined).enabled).toBe(true);
  });

  it('honours an explicit disable', () => {
    expect(resolveRetryOptions({ enabled: false }).enabled).toBe(false);
  });

  it('clamps nonsense rather than trusting it', () => {
    expect(resolveRetryOptions({ maxAttempts: 0 }).maxAttempts).toBe(1);
    expect(resolveRetryOptions({ maxAttempts: 999 }).maxAttempts).toBe(10);
    expect(resolveRetryOptions({ initialDelayMs: -5 }).initialDelayMs).toBe(0);
    expect(resolveRetryOptions({ initialDelayMs: 1e9 }).initialDelayMs).toBe(30_000);
  });
});

describe('classifyFailure — a response cut off partway', () => {
  it('treats Node\'s bare "aborted" as in-flight, not permanent', () => {
    // Measured against a real endpoint killed mid-request: this is what surfaces.
    // Classified as permanent it reached the user as the single word "aborted",
    // with nothing said about whether the daemon had already acted.
    expect(classifyFailure(new Error('aborted'))).toBe('in-flight');
  });

  it('so a write broken this way is not repeated, and says why', () => {
    expect(shouldRetry(new Error('aborted'), 'POST')).toBe(false);
    expect(describeUnretried(new Error('aborted'), 'POST')).toContain('not known');
  });

  it('but a read broken this way is retried', () => {
    expect(shouldRetry(new Error('aborted'), 'GET')).toBe(true);
  });
});
