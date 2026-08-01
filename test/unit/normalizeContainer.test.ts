import { normalizeContainerInfo } from '../../nodes/Docker/helpers/normalizeContainer';

describe('normalizeContainerInfo', () => {
  it('strips leading slash from container name', () => {
    const raw = {
      Names: ['/my-container'],
      Id: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc123de',
      Image: 'nginx:latest',
      State: 'running',
      Created: 1705312200,
      Ports: [],
      Labels: {},
    } as any;

    const normalized = normalizeContainerInfo(raw);
    expect(normalized.name).toBe('my-container');
  });

  it('handles empty names gracefully', () => {
    const raw = {
      Names: [],
      Id: 'abc123def456',
      Image: 'nginx:latest',
      State: 'running',
      Created: 1705312200,
      Ports: [],
      Labels: {},
    } as any;

    const normalized = normalizeContainerInfo(raw);
    expect(normalized.name).toBe('unknown');
  });

  it('maps running state correctly', () => {
    const raw = {
      Names: ['/test'],
      Id: 'abc123def456',
      Image: 'nginx:latest',
      State: 'running',
      Created: 1705312200,
      Ports: [],
      Labels: {},
    } as any;

    const normalized = normalizeContainerInfo(raw);
    expect(normalized.status).toBe('running');
  });

  it('maps exited state correctly', () => {
    const raw = {
      Names: ['/test'],
      Id: 'abc123def456',
      Image: 'nginx:latest',
      State: 'exited',
      Created: 1705312200,
      Ports: [],
      Labels: {},
    } as any;

    const normalized = normalizeContainerInfo(raw);
    expect(normalized.status).toBe('exited');
  });

  it('maps unknown state for unrecognized states', () => {
    const raw = {
      Names: ['/test'],
      Id: 'abc123def456',
      Image: 'nginx:latest',
      State: 'oomkilled',
      Created: 1705312200,
      Ports: [],
      Labels: {},
    } as any;

    const normalized = normalizeContainerInfo(raw);
    expect(normalized.status).toBe('unknown');
  });

  it('normalizes ports correctly', () => {
    const raw = {
      Names: ['/test'],
      Id: 'abc123def456',
      Image: 'nginx:latest',
      State: 'running',
      Created: 1705312200,
      Ports: [
        { PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
        { PrivatePort: 443, PublicPort: 8443, Type: 'tcp' },
      ],
      Labels: {},
    } as any;

    const normalized = normalizeContainerInfo(raw);
    expect(normalized.ports).toEqual([
      { containerPort: 80, hostPort: 8080, protocol: 'tcp' },
      { containerPort: 443, hostPort: 8443, protocol: 'tcp' },
    ]);
  });

  it('deduplicates ports', () => {
    const raw = {
      Names: ['/test'],
      Id: 'abc123def456',
      Image: 'nginx:latest',
      State: 'running',
      Created: 1705312200,
      Ports: [
        { PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
        { PrivatePort: 80, PublicPort: 8080, Type: 'tcp' }, // duplicate
        { PrivatePort: 443, PublicPort: 8443, Type: 'tcp' },
      ],
      Labels: {},
    } as any;

    const normalized = normalizeContainerInfo(raw);
    expect(normalized.ports).toEqual([
      { containerPort: 80, hostPort: 8080, protocol: 'tcp' },
      { containerPort: 443, hostPort: 8443, protocol: 'tcp' },
    ]);
  });

  it('handles missing ports gracefully', () => {
    const raw = {
      Names: ['/test'],
      Id: 'abc123def456',
      Image: 'nginx:latest',
      State: 'running',
      Created: 1705312200,
      Ports: null,
      Labels: {},
    } as any;

    const normalized = normalizeContainerInfo(raw);
    expect(normalized.ports).toEqual([]);
  });

  it('normalizes labels correctly when includeLabels is true', () => {
    const raw = {
      Names: ['/test'],
      Id: 'abc123def456',
      Image: 'nginx:latest',
      State: 'running',
      Created: 1705312200,
      Ports: [],
      Labels: { 'com.example.service': 'web', 'com.example.env': 'prod' },
    } as any;

    const normalized = normalizeContainerInfo(raw, true);
    expect(normalized.labels).toEqual({ 'com.example.service': 'web', 'com.example.env': 'prod' });
  });

  it('empties labels when includeLabels is false, but keeps the key present', () => {
    const raw = {
      Names: ['/test'],
      Id: 'abc123def456',
      Image: 'nginx:latest',
      State: 'running',
      Created: 1705312200,
      Ports: [],
      Labels: { 'com.example.service': 'web', 'com.example.env': 'prod' },
    } as any;

    const normalized = normalizeContainerInfo(raw, false);
    // BREAKING CHANGE from v0.1.1, which omitted the key entirely.
    // A field that sometimes disappears breaks downstream IF/Switch nodes, which
    // is precisely the inconsistency this normaliser exists to prevent. The key
    // is always present; suppressing labels empties it.
    expect(normalized).toHaveProperty('labels');
    expect(normalized.labels).toEqual({});
  });

  it('handles missing labels gracefully', () => {
    const raw = {
      Names: ['/test'],
      Id: 'abc123def456',
      Image: 'nginx:latest',
      State: 'running',
      Created: 1705312200,
      Ports: [],
      Labels: null,
    } as any;

    const normalized = normalizeContainerInfo(raw);
    expect(normalized.labels).toEqual({});
  });

  it('converts created timestamp to ISO string', () => {
    const raw = {
      Names: ['/test'],
      Id: 'abc123def456',
      Image: 'nginx:latest',
      State: 'running',
      Created: 1705312200,
      Ports: [],
      Labels: {},
    } as any;

    const normalized = normalizeContainerInfo(raw);
    expect(normalized.createdAt).toBe('2024-01-15T09:50:00.000Z');
  });

  it('extracts shortId as first 12 characters', () => {
    const raw = {
      Names: ['/test'],
      Id: 'abc123def456789',
      Image: 'nginx:latest',
      State: 'running',
      Created: 1705312200,
      Ports: [],
      Labels: {},
    } as any;

    const normalized = normalizeContainerInfo(raw);
    expect(normalized.shortId).toBe('abc123def456');
  });

  it('does not include state field (removed as redundant)', () => {
    const raw = {
      Names: ['/test'],
      Id: 'abc123def456',
      Image: 'nginx:latest',
      State: 'running',
      Created: 1705312200,
      Ports: [],
      Labels: {},
    } as any;

    const normalized = normalizeContainerInfo(raw);
    expect((normalized as any).state).toBeUndefined();
  });
});

describe('normalizeContainerInfo — health', () => {
  it('reports health from an inspect response', () => {
    const info = {
      Id: 'a'.repeat(64),
      Name: '/svc',
      Created: '2026-01-01T00:00:00Z',
      Config: { Image: 'nginx', Labels: {} },
      State: { Status: 'running', Health: { Status: 'healthy' } },
      NetworkSettings: { Ports: {} },
    };
    expect(normalizeContainerInfo(info as never).health).toBe('healthy');
  });

  it('digs health out of the list response, where it hides inside the status text', () => {
    // /containers/json has no health field at all. It buries the status in the
    // human-readable string, as "Up 2 minutes (healthy)".
    const list = {
      Id: 'b'.repeat(64),
      Names: ['/svc'],
      Image: 'nginx',
      State: 'running',
      Status: 'Up 2 minutes (unhealthy)',
      Created: 1767225600,
      Ports: [],
      Labels: {},
    };
    expect(normalizeContainerInfo(list as never).health).toBe('unhealthy');
  });

  it('distinguishes "no health check" from "unhealthy"', () => {
    // The whole point of the field. null means nobody is checking; "unhealthy"
    // means something checked and it failed. Collapsing them would make a
    // container with no check look broken, or a broken one look fine.
    const noCheck = {
      Id: 'c'.repeat(64),
      Name: '/svc',
      Created: '2026-01-01T00:00:00Z',
      Config: { Image: 'nginx', Labels: {} },
      State: { Status: 'running' },
      NetworkSettings: { Ports: {} },
    };
    expect(normalizeContainerInfo(noCheck as never).health).toBeNull();
  });

  it('always emits the key, so a downstream IF node can rely on it', () => {
    const list = {
      Id: 'd'.repeat(64),
      Names: ['/svc'],
      Image: 'nginx',
      State: 'exited',
      Status: 'Exited (0) 3 minutes ago',
      Created: 1767225600,
      Ports: [],
      Labels: {},
    };
    expect(Object.keys(normalizeContainerInfo(list as never))).toContain('health');
  });
});
