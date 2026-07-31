import { shortenDigest, toIsoTimestamp } from './normalizePrimitives';

export interface NormalizedNetworkContainer {
  id: string;
  shortId: string;
  name: string;
  ipv4: string | null;
  ipv6: string | null;
  macAddress: string | null;
}

export interface NormalizedNetwork {
  id: string;
  shortId: string;
  name: string;
  driver: string;
  scope: string;
  createdAt: string;
  internal: boolean;
  attachable: boolean;
  ingress: boolean;
  ipv6Enabled: boolean;
  ipam: {
    driver: string | null;
    subnets: Array<{ subnet: string | null; gateway: string | null }>;
  };
  containers: NormalizedNetworkContainer[];
  containerCount: number;
  /**
   * Whether container membership was actually available.
   *
   * /networks returns networks WITHOUT their attached containers, while
   * /networks/{id} includes them. An empty `containers` array therefore means
   * two different things depending on which call produced it. Rather than let
   * "no containers" and "not looked up" appear identical - the failure mode this
   * project keeps running into - this flag says which one it is.
   */
  containersEnumerated: boolean;
  labels: Record<string, string>;
}

interface RawNetwork {
  Id?: string;
  Name?: string;
  Driver?: string;
  Scope?: string;
  Created?: string | number;
  Internal?: boolean;
  Attachable?: boolean;
  Ingress?: boolean;
  EnableIPv6?: boolean;
  IPAM?: { Driver?: string; Config?: Array<{ Subnet?: string; Gateway?: string }> };
  Containers?: Record<
    string,
    { Name?: string; IPv4Address?: string; IPv6Address?: string; MacAddress?: string }
  > | null;
  Labels?: Record<string, string> | null;
}

const stripMask = (v: string | undefined): string | null => (v && v !== '' ? v : null);

export function normalizeNetwork(
  raw: RawNetwork,
  options: { includeLabels?: boolean; containersEnumerated?: boolean } = {},
): NormalizedNetwork {
  const includeLabels = options.includeLabels !== false;
  const id = raw.Id ?? '';

  const containerMap = raw.Containers ?? {};
  const containers: NormalizedNetworkContainer[] = Object.entries(containerMap).map(
    ([containerId, c]) => ({
      id: containerId,
      shortId: shortenDigest(containerId),
      name: c?.Name ?? 'unknown',
      ipv4: stripMask(c?.IPv4Address),
      ipv6: stripMask(c?.IPv6Address),
      macAddress: stripMask(c?.MacAddress),
    }),
  );

  // If the caller did not say, infer from whether Containers was present at all.
  const enumerated = options.containersEnumerated ?? raw.Containers !== undefined;

  return {
    id,
    shortId: shortenDigest(id),
    name: raw.Name ?? 'unknown',
    driver: raw.Driver ?? 'unknown',
    scope: raw.Scope ?? 'unknown',
    createdAt: toIsoTimestamp(raw.Created),
    internal: raw.Internal ?? false,
    attachable: raw.Attachable ?? false,
    ingress: raw.Ingress ?? false,
    ipv6Enabled: raw.EnableIPv6 ?? false,
    ipam: {
      driver: raw.IPAM?.Driver ?? null,
      subnets: (raw.IPAM?.Config ?? []).map((c) => ({
        subnet: stripMask(c?.Subnet),
        gateway: stripMask(c?.Gateway),
      })),
    },
    containers,
    containerCount: containers.length,
    containersEnumerated: enumerated,
    labels: includeLabels ? (raw.Labels ?? {}) : {},
  };
}
