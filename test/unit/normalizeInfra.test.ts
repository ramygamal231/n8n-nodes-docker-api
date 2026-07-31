import { normalizeNetwork } from '../../nodes/Docker/helpers/normalizeNetwork';
import { normalizeVolume } from '../../nodes/Docker/helpers/normalizeVolume';

describe('normalizeNetwork', () => {
  const INSPECT = {
    Id: 'a1b2c3d4e5f60000000000000000000000000000000000000000000000000000',
    Name: 'n8ntest-net',
    Driver: 'bridge',
    Scope: 'local',
    Created: '2026-07-31T10:00:00.123456789Z',
    Internal: false,
    Attachable: true,
    EnableIPv6: false,
    IPAM: { Driver: 'default', Config: [{ Subnet: '172.28.0.0/16', Gateway: '172.28.0.1' }] },
    Containers: {
      ffffffffffff0000000000000000000000000000000000000000000000000000: {
        Name: 'n8ntest-logger',
        IPv4Address: '172.28.0.2/16',
        IPv6Address: '',
        MacAddress: '02:42:ac:1c:00:02',
      },
    },
    Labels: { purpose: 'test' },
  };

  it('flattens attached containers into a list', () => {
    const n = normalizeNetwork(INSPECT);
    expect(n.containerCount).toBe(1);
    expect(n.containers[0]).toEqual({
      id: 'ffffffffffff0000000000000000000000000000000000000000000000000000',
      shortId: 'ffffffffffff',
      name: 'n8ntest-logger',
      ipv4: '172.28.0.2/16',
      ipv6: null, // empty string is "not assigned", not an address
      macAddress: '02:42:ac:1c:00:02',
    });
  });

  it('normalises the timestamp and flattens IPAM config', () => {
    const n = normalizeNetwork(INSPECT);
    expect(n.createdAt).toBe('2026-07-31T10:00:00.123Z');
    expect(n.ipam).toEqual({
      driver: 'default',
      subnets: [{ subnet: '172.28.0.0/16', gateway: '172.28.0.1' }],
    });
  });

  describe('containersEnumerated — empty must not be ambiguous', () => {
    it('is false for a list response, where membership is never returned', () => {
      // /networks omits Containers entirely. Without this flag, "no containers"
      // and "not looked up" would produce identical output.
      const fromList = normalizeNetwork(
        { Id: 'x'.repeat(64), Name: 'bridge', Driver: 'bridge' },
        { containersEnumerated: false },
      );
      expect(fromList.containers).toEqual([]);
      expect(fromList.containerCount).toBe(0);
      expect(fromList.containersEnumerated).toBe(false);
    });

    it('is true for an inspect response with genuinely no containers', () => {
      const empty = normalizeNetwork({ ...INSPECT, Containers: {} }, { containersEnumerated: true });
      expect(empty.containers).toEqual([]);
      expect(empty.containersEnumerated).toBe(true);
    });

    it('infers enumeration from whether Containers was present', () => {
      expect(normalizeNetwork({ Id: 'a', Containers: {} }).containersEnumerated).toBe(true);
      expect(normalizeNetwork({ Id: 'a' }).containersEnumerated).toBe(false);
    });
  });

  it('keeps the labels key even when suppressed', () => {
    const n = normalizeNetwork(INSPECT, { includeLabels: false });
    expect(n).toHaveProperty('labels');
    expect(n.labels).toEqual({});
  });
});

describe('normalizeVolume', () => {
  const BASE = {
    Name: 'n8ntest-vol',
    Driver: 'local',
    Scope: 'local',
    Mountpoint: '/var/lib/docker/volumes/n8ntest-vol/_data',
    CreatedAt: '2026-07-31T10:00:00Z',
    Labels: { purpose: 'test' },
    Options: {},
  };

  describe('usageKnown — Docker signals "not calculated" with -1', () => {
    it('reports null rather than -1 or a misleading 0', () => {
      // Passing -1 through as a size is nonsense; reporting 0 is a lie.
      const v = normalizeVolume({ ...BASE, UsageData: { Size: -1, RefCount: -1 } });
      expect(v.sizeMB).toBeNull();
      expect(v.refCount).toBeNull();
      expect(v.usageKnown).toBe(false);
      expect(v.inUse).toBeNull();
    });

    it('reports real usage when Docker computed it', () => {
      const v = normalizeVolume({ ...BASE, UsageData: { Size: 5242880, RefCount: 2 } });
      expect(v.sizeMB).toBe(5);
      expect(v.refCount).toBe(2);
      expect(v.usageKnown).toBe(true);
      expect(v.inUse).toBe(true);
    });

    it('distinguishes a genuinely unused volume from an unknown one', () => {
      const unused = normalizeVolume({ ...BASE, UsageData: { Size: 0, RefCount: 0 } });
      expect(unused.usageKnown).toBe(true);
      expect(unused.inUse).toBe(false);
      expect(unused.sizeMB).toBe(0);

      const unknown = normalizeVolume({ ...BASE });
      expect(unknown.usageKnown).toBe(false);
      expect(unknown.inUse).toBeNull();
    });
  });

  it('normalises the timestamp and defaults the driver', () => {
    const v = normalizeVolume({ Name: 'bare' });
    expect(v.driver).toBe('local');
    expect(v.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(v.labels).toEqual({});
    expect(v.options).toEqual({});
  });
});
