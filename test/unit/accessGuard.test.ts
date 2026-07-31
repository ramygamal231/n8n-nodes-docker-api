import { enforceAccessMode } from '../../nodes/Docker/helpers/accessGuard';

describe('enforceAccessMode', () => {
  it('allows list operation with readonly access', () => {
    const credentials = { accessMode: 'readonly' };
    expect(() => enforceAccessMode(credentials, 'list')).not.toThrow();
  });

  it('allows getLogs operation with readonly access', () => {
    const credentials = { accessMode: 'readonly' };
    expect(() => enforceAccessMode(credentials, 'getLogs')).not.toThrow();
  });

  it('blocks start operation with readonly access', () => {
    const credentials = { accessMode: 'readonly' };
    expect(() => enforceAccessMode(credentials, 'start')).toThrow('requires Full Control access');
  });

  it('blocks stop operation with readonly access', () => {
    const credentials = { accessMode: 'readonly' };
    expect(() => enforceAccessMode(credentials, 'stop')).toThrow('requires Full Control access');
  });

  it('blocks remove operation with readonly access', () => {
    const credentials = { accessMode: 'readonly' };
    expect(() => enforceAccessMode(credentials, 'remove')).toThrow('requires Full Control access');
  });

  it('allows start operation with full access', () => {
    const credentials = { accessMode: 'full' };
    expect(() => enforceAccessMode(credentials, 'start')).not.toThrow();
  });

  it('allows stop operation with full access', () => {
    const credentials = { accessMode: 'full' };
    expect(() => enforceAccessMode(credentials, 'stop')).not.toThrow();
  });

  it('allows all write operations with full access', () => {
    const credentials = { accessMode: 'full' };
    const writeOps = ['start', 'stop', 'remove', 'restart', 'run', 'pull', 'build', 'prune'];
    
    writeOps.forEach((op) => {
      expect(() => enforceAccessMode(credentials, op)).not.toThrow();
    });
  });

  it('includes operation name in error message', () => {
    const credentials = { accessMode: 'readonly' };
    try {
      enforceAccessMode(credentials, 'stop');
    } catch (error) {
      expect((error as Error).message).toContain('"stop"');
    }
  });

  it('includes guidance in error message', () => {
    const credentials = { accessMode: 'readonly' };
    try {
      enforceAccessMode(credentials, 'start');
    } catch (error) {
      expect((error as Error).message).toContain('Update your Docker API credential');
    }
  });
});

describe('enforceAccessMode — fail-closed allowlist (v1.0.0)', () => {
  const readonly = { accessMode: 'readonly' };
  const full = { accessMode: 'full' };

  it('blocks an operation nobody has classified yet', () => {
    // The critical property: a future operation added without touching this guard
    // must be DENIED to read-only credentials, not silently permitted.
    expect(() => enforceAccessMode(readonly, 'someFutureWriteOperation')).toThrow(
      'requires Full Control access',
    );
  });

  it('blocks every v1.0.0 write operation under readonly', () => {
    const writeOps = [
      'create', 'run', 'start', 'stop', 'restart', 'kill', 'pause', 'unpause',
      'remove', 'rename', 'executeCommand', 'copyTo', 'prune',
      'pullImage', 'buildImage', 'pushImage', 'tagImage', 'removeImage', 'loadImage',
      'createNetwork', 'removeNetwork', 'connectNetwork', 'disconnectNetwork',
      'createVolume', 'removeVolume',
    ];
    for (const op of writeOps) {
      expect(() => enforceAccessMode(readonly, op)).toThrow('requires Full Control access');
      expect(() => enforceAccessMode(full, op)).not.toThrow();
    }
  });

  it('permits every classified read operation under readonly', () => {
    const readOps = [
      'list', 'inspect', 'getLogs', 'stats', 'top', 'changes', 'waitForState',
      'copyFrom', 'export', 'listImages', 'inspectImage', 'history', 'search',
      'saveImage', 'listNetworks', 'inspectNetwork', 'listVolumes', 'inspectVolume',
      'info', 'version', 'ping', 'diskUsage', 'events',
    ];
    for (const op of readOps) {
      expect(() => enforceAccessMode(readonly, op)).not.toThrow();
    }
  });

  describe('Custom API Call is classified by HTTP method', () => {
    it.each(['GET', 'HEAD', 'OPTIONS', 'get'])('allows %s under readonly', (m) => {
      expect(() => enforceAccessMode(readonly, 'customApiCall', { httpMethod: m })).not.toThrow();
    });

    it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('blocks %s under readonly', (m) => {
      expect(() => enforceAccessMode(readonly, 'customApiCall', { httpMethod: m })).toThrow(
        'requires Full Control access',
      );
    });

    it('defaults to GET when no method is given', () => {
      expect(() => enforceAccessMode(readonly, 'customApiCall')).not.toThrow();
    });

    it('allows any method under full control', () => {
      expect(() => enforceAccessMode(full, 'customApiCall', { httpMethod: 'DELETE' })).not.toThrow();
    });
  });
});
