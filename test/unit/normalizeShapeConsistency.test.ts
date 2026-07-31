import { normalizeContainerInfo } from '../../nodes/Docker/helpers/normalizeContainer';

/**
 * The core guarantee of v1.0.0: the SAME container must normalise to the SAME
 * shape and the SAME values, whether it arrived from /containers/json (list) or
 * /containers/{id}/json (inspect).
 *
 * In v0.1.1 it did not. Ports were always empty on the inspect path and
 * createdAt leaked Docker's raw nanosecond string, so `list` and `start`/`stop`
 * disagreed about the same container. These fixtures are the two real payloads
 * Docker returns for one container published with -p 18081:80 and -p 18082:81/udp.
 */

const LIST_SHAPE = {
  Id: 'e324df4bd041772cc01172d392a4c2faa87d63614b8c0d0ab859919cb9a84432',
  Names: ['/n8ntest-ports'],
  Image: 'alpine',
  State: 'running',
  Created: 1785505548, // unix seconds
  Ports: [
    { PrivatePort: 80, PublicPort: 18081, Type: 'tcp', IP: '0.0.0.0' },
    { PrivatePort: 80, PublicPort: 18081, Type: 'tcp', IP: '::' },
    { PrivatePort: 81, PublicPort: 18082, Type: 'udp', IP: '0.0.0.0' },
    { PrivatePort: 81, PublicPort: 18082, Type: 'udp', IP: '::' },
  ],
  Labels: { n8ntest: 'true' },
} as any;

const INSPECT_SHAPE = {
  Id: 'e324df4bd041772cc01172d392a4c2faa87d63614b8c0d0ab859919cb9a84432',
  Name: '/n8ntest-ports',
  Created: '2026-07-31T13:45:48.010054533Z', // RFC3339 with nanoseconds
  State: { Status: 'running', Running: true },
  Config: { Image: 'alpine', Labels: { n8ntest: 'true' } },
  NetworkSettings: {
    Ports: {
      '80/tcp': [
        { HostIp: '0.0.0.0', HostPort: '18081' },
        { HostIp: '::', HostPort: '18081' },
      ],
      '81/udp': [
        { HostIp: '0.0.0.0', HostPort: '18082' },
        { HostIp: '::', HostPort: '18082' },
      ],
    },
  },
} as any;

describe('shape consistency between the list and inspect paths', () => {
  const fromList = normalizeContainerInfo(LIST_SHAPE);
  const fromInspect = normalizeContainerInfo(INSPECT_SHAPE);

  it('produces identical keys from both sources', () => {
    expect(Object.keys(fromList).sort()).toEqual(Object.keys(fromInspect).sort());
  });

  it('REGRESSION: ports are populated on the inspect path, not empty', () => {
    // v0.1.1 returned [] here because it read ContainerInfo.Ports, which does not
    // exist on an inspect response - the data lives in NetworkSettings.Ports.
    expect(fromInspect.ports.length).toBeGreaterThan(0);
    expect(fromInspect.ports).toEqual(fromList.ports);
  });

  it('collapses duplicate IPv4/IPv6 bindings of the same published port', () => {
    expect(fromList.ports).toEqual([
      { containerPort: 80, hostPort: 18081, protocol: 'tcp' },
      { containerPort: 81, hostPort: 18082, protocol: 'udp' },
    ]);
  });

  it('REGRESSION: createdAt is ISO with milliseconds on both paths', () => {
    // v0.1.1 passed Docker's nanosecond string straight through on inspect.
    expect(fromInspect.createdAt).toBe('2026-07-31T13:45:48.010Z');
    expect(fromInspect.createdAt).not.toMatch(/\d{9}Z$/);
    expect(fromList.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('REGRESSION: includeLabels is honoured on the inspect path too', () => {
    // v0.1.1 always included labels from inspect, ignoring the flag.
    expect(normalizeContainerInfo(INSPECT_SHAPE, { includeLabels: false }).labels).toEqual({});
    expect(normalizeContainerInfo(INSPECT_SHAPE, { includeLabels: true }).labels).toEqual({
      n8ntest: 'true',
    });
  });

  it('agrees on every field except the sub-second part of createdAt', () => {
    expect({ ...fromInspect, createdAt: null }).toEqual({ ...fromList, createdAt: null });
  });
});

describe('port edge cases from the inspect path', () => {
  it('reports an exposed but unpublished port with no hostPort', () => {
    const raw = {
      Id: 'a'.repeat(64),
      Name: '/exposed-only',
      Created: '2026-01-01T00:00:00.000Z',
      State: { Status: 'running' },
      Config: { Image: 'nginx', Labels: {} },
      NetworkSettings: { Ports: { '443/tcp': null } },
    } as any;
    expect(normalizeContainerInfo(raw).ports).toEqual([
      { containerPort: 443, protocol: 'tcp' },
    ]);
  });

  it('defaults a protocol-less port spec to tcp', () => {
    const raw = {
      Id: 'b'.repeat(64),
      Name: '/odd',
      Created: '2026-01-01T00:00:00.000Z',
      State: { Status: 'running' },
      Config: { Image: 'nginx', Labels: {} },
      NetworkSettings: { Ports: { '8080': [{ HostIp: '0.0.0.0', HostPort: '9090' }] } },
    } as any;
    expect(normalizeContainerInfo(raw).ports).toEqual([
      { containerPort: 8080, hostPort: 9090, protocol: 'tcp' },
    ]);
  });

  it('survives a container with no network settings at all', () => {
    const raw = {
      Id: 'c'.repeat(64),
      Name: '/bare',
      Created: '2026-01-01T00:00:00.000Z',
      State: { Status: 'created' },
      Config: { Image: 'alpine', Labels: {} },
    } as any;
    expect(normalizeContainerInfo(raw).ports).toEqual([]);
    expect(normalizeContainerInfo(raw).status).toBe('created');
  });
});
