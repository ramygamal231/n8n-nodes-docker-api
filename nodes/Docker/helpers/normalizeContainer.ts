import { ContainerInfo, ContainerInspectInfo } from 'dockerode';

export type ContainerStatus =
  | 'running'
  | 'stopped'
  | 'exited'
  | 'paused'
  | 'restarting'
  | 'dead'
  | 'created'
  | 'removing'
  | 'unknown';

export interface NormalizedPort {
  containerPort: number;
  hostPort?: number;
  protocol: string;
}

export interface NormalizedContainer {
  id: string;
  shortId: string;
  name: string;
  image: string;
  status: ContainerStatus;
  /**
   * Health check status, or null when the container defines no health check.
   *
   * null and "unhealthy" mean very different things and must not collapse into
   * each other: one is "nobody is checking", the other is "checked and failing".
   * The key is always present so a downstream IF node can rely on it.
   */
  health: string | null;
  createdAt: string;
  ports: NormalizedPort[];
  labels: Record<string, string>;
}

/**
 * Docker returns containers in two different shapes: `ContainerInfo` from
 * /containers/json (list) and `ContainerInspectInfo` from /containers/{id}/json
 * (inspect). They disagree on field names, on where ports live, and on how the
 * creation time is encoded.
 *
 * v0.1.1 normalised each shape separately, so the SAME container came back
 * differently depending on which operation produced it - ports were always empty
 * from start/stop, and createdAt leaked Docker's raw nanosecond string. That
 * defeats the entire point of having a normalised schema.
 *
 * The fix is structural rather than a patch: both shapes are first reduced to one
 * intermediate form, and only that form is ever normalised. Adding a new source
 * shape means writing a new reducer, and it is then impossible for it to produce
 * a different output shape.
 */
interface CommonContainerFields {
  id: string;
  name: string;
  image: string;
  state: string;
  createdAt: string;
  ports: NormalizedPort[];
  labels: Record<string, string>;
  /** null when the container defines no health check — not the same as unhealthy. */
  health: string | null;
}

const stripLeadingSlash = (value: string): string => value.replace(/^\//, '');

/** Docker sends a mix of unix seconds, RFC3339, and RFC3339 with nanoseconds. */
function toIsoTimestamp(raw: string | number | undefined): string {
  if (raw === undefined || raw === null || raw === '') return new Date(0).toISOString();
  if (typeof raw === 'number') return new Date(raw * 1000).toISOString();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return new Date(0).toISOString();
  // Date() truncates sub-millisecond precision, which is what normalises
  // "2026-07-31T13:42:39.344492418Z" to "2026-07-31T13:42:39.344Z".
  return parsed.toISOString();
}

function dedupePorts(ports: NormalizedPort[]): NormalizedPort[] {
  const seen = new Set<string>();
  const out: NormalizedPort[] = [];
  for (const port of ports) {
    // A published port appears once per host interface (IPv4 and IPv6); collapse them.
    const key = `${port.containerPort}-${port.hostPort ?? 'none'}-${port.protocol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(port);
  }
  return out.sort(
    (a, b) => a.containerPort - b.containerPort || a.protocol.localeCompare(b.protocol),
  );
}

/** Ports as they arrive from /containers/json. */
function portsFromList(raw: ContainerInfo): NormalizedPort[] {
  return dedupePorts(
    (raw.Ports ?? []).map((p) => ({
      containerPort: p.PrivatePort,
      hostPort: p.PublicPort,
      protocol: p.Type,
    })),
  );
}

/**
 * Ports as they arrive from /containers/{id}/json, which is a completely
 * different structure: { "80/tcp": [{ HostIp, HostPort }, ...], "81/udp": null }
 * A null value means the port is exposed but not published.
 */
function portsFromInspect(raw: ContainerInspectInfo): NormalizedPort[] {
  const portMap = raw.NetworkSettings?.Ports ?? {};
  const out: NormalizedPort[] = [];
  for (const [spec, bindings] of Object.entries(portMap)) {
    const [portPart, protocol = 'tcp'] = spec.split('/');
    const containerPort = Number(portPart);
    if (!Number.isFinite(containerPort)) continue;
    if (!bindings || bindings.length === 0) {
      out.push({ containerPort, protocol });
      continue;
    }
    for (const binding of bindings) {
      const hostPort = Number(binding?.HostPort);
      out.push({
        containerPort,
        hostPort: Number.isFinite(hostPort) ? hostPort : undefined,
        protocol,
      });
    }
  }
  return dedupePorts(out);
}

const isInspectInfo = (
  raw: ContainerInfo | ContainerInspectInfo,
): raw is ContainerInspectInfo => 'Name' in raw && 'State' in raw && typeof raw.State === 'object';

function toCommonFields(raw: ContainerInfo | ContainerInspectInfo): CommonContainerFields {
  if (isInspectInfo(raw)) {
    return {
      id: raw.Id,
      name: stripLeadingSlash(raw.Name ?? ''),
      image: raw.Config?.Image ?? 'unknown',
      state: raw.State?.Status ?? 'unknown',
      createdAt: toIsoTimestamp(raw.Created),
      ports: portsFromInspect(raw),
      labels: raw.Config?.Labels ?? {},
      health: (raw.State as { Health?: { Status?: string } } | undefined)?.Health?.Status ?? null,
    };
  }
  const list = raw as ContainerInfo;
  return {
    id: list.Id,
    name: stripLeadingSlash(list.Names?.[0] ?? ''),
    image: list.Image ?? 'unknown',
    state: list.State ?? 'unknown',
    createdAt: toIsoTimestamp(list.Created),
    ports: portsFromList(list),
    labels: list.Labels ?? {},
    // The list endpoint has no health field. It hides the status inside the
    // human-readable Status string, as "Up 2 minutes (healthy)".
    health: /\((healthy|unhealthy|starting)\)/.exec(list.Status ?? '')?.[1] ?? null,
  };
}

function mapStatus(dockerState: string): ContainerStatus {
  const map: Record<string, ContainerStatus> = {
    running: 'running',
    exited: 'exited',
    stopped: 'stopped',
    paused: 'paused',
    restarting: 'restarting',
    dead: 'dead',
    created: 'created',
    removing: 'removing',
  };
  return map[dockerState?.toLowerCase()] ?? 'unknown';
}

export interface NormalizeOptions {
  /**
   * When false, `labels` is emitted as an empty object rather than being omitted.
   * The key is always present: a field that sometimes disappears is exactly the
   * kind of inconsistency this normaliser exists to prevent.
   */
  includeLabels?: boolean;
}

export function normalizeContainerInfo(
  raw: ContainerInfo | ContainerInspectInfo,
  options: NormalizeOptions | boolean = {},
): NormalizedContainer {
  // v0.1.1 took a bare boolean here; keep that working.
  const opts: NormalizeOptions = typeof options === 'boolean' ? { includeLabels: options } : options;
  const includeLabels = opts.includeLabels !== false;

  const common = toCommonFields(raw);
  return {
    id: common.id,
    shortId: common.id.substring(0, 12),
    name: common.name === '' ? 'unknown' : common.name,
    image: common.image,
    status: mapStatus(common.state),
    health: common.health,
    createdAt: common.createdAt,
    ports: common.ports,
    labels: includeLabels ? common.labels : {},
  };
}
