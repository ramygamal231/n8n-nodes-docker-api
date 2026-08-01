import { translateDockerError } from '../../nodes/Docker/helpers/errorHandler';

describe('translateDockerError', () => {
  it('handles ECONNREFUSED error', () => {
    const error = new Error('connect ECONNREFUSED /var/run/docker.sock');
    const result = translateDockerError(error);
    expect(result).toContain('Cannot connect to Docker daemon');
  });

  it('handles ENOENT docker.sock error', () => {
    const error = new Error('ENOENT: no such file or directory, unix connect /var/run/docker.sock');
    const result = translateDockerError(error);
    expect(result).toContain('Docker socket not found');
  });

  it('handles permission denied error', () => {
    const error = new Error('permission denied while trying to connect to the Docker daemon socket');
    const result = translateDockerError(error);
    expect(result).toContain('Permission denied accessing Docker socket');
  });

  it('handles No such container error', () => {
    const error = new Error('No such container: abc123def456');
    const result = translateDockerError(error);
    expect(result).toContain('Container not found');
  });

  it('handles is not running error', () => {
    const error = new Error('Container abc123def456 is not running');
    const result = translateDockerError(error);
    expect(result).toContain('Container is not running');
  });

  it('handles already started error', () => {
    const error = new Error('Container abc123def456 is already started');
    const result = translateDockerError(error);
    expect(result).toContain('Container is already running');
  });

  it('handles 404 error', () => {
    const error = new Error('Error response from daemon: 404 Not Found');
    const result = translateDockerError(error);
    expect(result).toContain('Resource not found');
  });

  it('handles 409 error', () => {
    const error = new Error('Error response from daemon: 409 Conflict');
    const result = translateDockerError(error);
    expect(result).toContain('Conflict');
  });

  it('handles timeout error', () => {
    const error = new Error('Connection timeout');
    const result = translateDockerError(error);
    expect(result).toContain('Connection timed out');
  });

  it('handles ETIMEDOUT error', () => {
    const error = new Error('connect ETIMEDOUT 192.168.1.100:2375');
    const result = translateDockerError(error);
    expect(result).toContain('Connection timed out');
  });

  it('returns fallback message for unknown errors', () => {
    const error = new Error('Some unknown error occurred');
    const result = translateDockerError(error);
    expect(result).toBe('Some unknown error occurred');
  });

  it('handles non-Error objects', () => {
    const error = 'String error message';
    const result = translateDockerError(error);
    expect(result).toBe('String error message');
  });

  it('handles undefined error gracefully', () => {
    const error = undefined;
    const result = translateDockerError(error);
    expect(result).toBe('undefined');
  });
});

describe('translateDockerError — endpoint vs container (v1.0.0)', () => {
  it('REGRESSION: an unknown API endpoint is not reported as a missing container', () => {
    // Docker answers an unrecognised path with "page not found". A broad
    // 'not found' match turned that into "Container not found", which is
    // actively misleading when no container is involved. Surfaced by the
    // Custom API Call operation hitting a bogus path.
    const result = translateDockerError(new Error('(HTTP code 404) unexpected - page not found'));
    expect(result).toContain('does not recognise that API endpoint');
    expect(result).not.toContain('Container not found');
  });

  it('still reports a genuinely missing container correctly', () => {
    expect(translateDockerError(new Error('No such container: abc123'))).toContain(
      'Container not found',
    );
    expect(translateDockerError(new Error('Error: container xyz not found'))).toContain(
      'Container not found',
    );
  });
});

describe('translateDockerError — proxied-connection auth (v1.0.0)', () => {
  it('REGRESSION: a rejected Portainer token is translated, not leaked raw', () => {
    // Portainer phrases this "Invalid JWT token", matching none of the usual
    // wordings, so it previously surfaced as the raw
    // "(HTTP code 401) unexpected - Invalid JWT token".
    const result = translateDockerError(
      new Error('(HTTP code 401) unexpected - Invalid JWT token '),
    );
    expect(result).toContain('Authentication failed');
    expect(result).toContain('expired');
    expect(result).not.toContain('HTTP code 401');
  });

  it('covers other 401 phrasings', () => {
    expect(translateDockerError(new Error('jwt token is invalid'))).toContain(
      'Authentication failed',
    );
    expect(translateDockerError(new Error('request failed (401)'))).toContain(
      'Authentication failed',
    );
  });

  it('still routes registry auth failures to the registry message', () => {
    // Registries return "unauthorized" both for a private repository and for one
    // that does not exist, so the message must name both causes. Blaming
    // credentials alone sends someone hunting for a token problem when they have
    // actually mistyped the repository name — the far more common case on a read.
    const msg = translateDockerError(new Error('unauthorized: authentication required'));
    expect(msg).toContain('does not exist');
    expect(msg).toContain('private');
    expect(msg).toContain('Additional Fields');
  });

  it("translates Node's malformed-path error into an image reference problem", () => {
    // Node's HTTP client rejects the path before the request is sent. Its wording
    // describes its own internals and never mentions the image name that caused
    // it, which is the only thing the user can act on.
    for (const raw of [
      'Request path contains unescaped characters',
      'TypeError [ERR_INVALID_URL]: Invalid URL',
    ]) {
      const msg = translateDockerError(new Error(raw));
      expect(msg).toContain('not valid');
      expect(msg).toContain('name:tag');
      expect(msg).not.toContain('unescaped');
    }
  });
});

describe('translateDockerError — container startup (v1.0.0)', () => {
  it('names the port when a host port is already bound', () => {
    // Docker buries this in networking-driver wording behind a 500, which is
    // unhelpful for what is one of the most common real failures.
    const raw =
      '(HTTP code 500) server error - failed to set up container networking: driver failed ' +
      'programming external connectivity on endpoint x (abc): Bind for 0.0.0.0:18099 failed: ' +
      'port is already allocated ';
    const result = translateDockerError(new Error(raw));
    expect(result).toContain('18099');
    expect(result).toContain('already in use');
    expect(result).not.toContain('HTTP code 500');
  });

  it('handles the port-forwarding failure without a parseable port', () => {
    expect(
      translateDockerError(new Error('driver failed programming external connectivity')),
    ).toContain('port forwarding');
  });

  it('explains an invalid image reference', () => {
    expect(translateDockerError(new Error('invalid reference format'))).toContain('not valid');
  });
});

describe('translateDockerError — connection retry annotations', () => {
  it('reports how many attempts were made, after the message is rewritten', () => {
    // translateDockerError replaces the raw text wholesale, so the attempt count
    // has to travel as a property and be reattached, or it is lost before the
    // user ever sees it. "Tried three times over four seconds and it never came
    // back" is a different problem from "failed once", and only the first
    // justifies looking at the daemon rather than at the workflow.
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:2399'), {
      retryAttempts: 3,
    });
    const msg = translateDockerError(err);
    expect(msg).toContain('Cannot connect to Docker daemon');
    expect(msg).toContain('after 3 attempts');
  });

  it('does not mention attempts when there was only one', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:2399'), {
      retryAttempts: 1,
    });
    expect(translateDockerError(err)).not.toContain('attempts');
  });

  it('explains a write that was deliberately not retried', () => {
    const err = Object.assign(new Error('socket hang up'), {
      retryNote: 'The connection to Docker broke after the request had been sent.',
    });
    expect(translateDockerError(err)).toContain('after the request had been sent');
  });

  it('leaves an ordinary error untouched', () => {
    expect(translateDockerError(new Error('No such container'))).toBe(
      'Container not found. Verify the container ID or name is correct and the container exists.',
    );
  });
});
