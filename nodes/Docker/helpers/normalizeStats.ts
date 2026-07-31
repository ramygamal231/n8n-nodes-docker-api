import { sizeToMb } from './normalizePrimitives';

export interface NormalizedStats {
  cpuPercent: number | null;
  cpuCount: number | null;
  memoryUsageMB: number | null;
  memoryLimitMB: number | null;
  memoryPercent: number | null;
  networkRxMB: number;
  networkTxMB: number;
  blockReadMB: number;
  blockWriteMB: number;
  pids: number | null;
  /** False when Docker gave no comparison sample, so CPU could not be derived. */
  cpuMeasurable: boolean;
}

interface RawStats {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
  };
  memory_stats?: {
    usage?: number;
    limit?: number;
    stats?: { cache?: number; inactive_file?: number };
  };
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }> | null;
  blkio_stats?: { io_service_bytes_recursive?: Array<{ op?: string; value?: number }> | null };
  pids_stats?: { current?: number };
}

/**
 * Turns Docker's raw stats into the numbers a person actually wants.
 *
 * Docker reports CPU as monotonically increasing nanosecond counters, not a
 * percentage. Deriving a percentage requires two samples and this formula:
 *
 *   cpuDelta    = cpu_usage.total_usage   - precpu.cpu_usage.total_usage
 *   systemDelta = system_cpu_usage        - precpu.system_cpu_usage
 *   percent     = (cpuDelta / systemDelta) * cpuCount * 100
 *
 * A single one-shot stats call already includes `precpu_stats`, so no second
 * request is needed — but on a container's very first sample precpu is zeroed,
 * and dividing by that yields a meaningless number. That case reports null with
 * cpuMeasurable false rather than a confident fabrication.
 *
 * Memory usage likewise needs the page cache subtracted, otherwise a container
 * that has merely read files appears to be consuming far more than it is.
 */
export function normalizeStats(raw: RawStats): NormalizedStats {
  const cpu = raw.cpu_stats;
  const pre = raw.precpu_stats;

  const cpuDelta = (cpu?.cpu_usage?.total_usage ?? 0) - (pre?.cpu_usage?.total_usage ?? 0);
  const systemDelta = (cpu?.system_cpu_usage ?? 0) - (pre?.system_cpu_usage ?? 0);
  const cpuCount = cpu?.online_cpus ?? cpu?.cpu_usage?.percpu_usage?.length ?? null;

  // systemDelta is 0 on the first sample of a container's life, and negative
  // values would mean the counters reset. Neither can produce a real percentage.
  const cpuMeasurable = systemDelta > 0 && cpuDelta >= 0 && (cpuCount ?? 0) > 0;
  const cpuPercent = cpuMeasurable
    ? Math.round((cpuDelta / systemDelta) * (cpuCount as number) * 100 * 100) / 100
    : null;

  const mem = raw.memory_stats;
  // cgroup v2 calls it inactive_file, v1 calls it cache. Both are page cache the
  // container is not really "using" and Docker's own CLI subtracts it.
  const cache = mem?.stats?.inactive_file ?? mem?.stats?.cache ?? 0;
  const memUsageBytes = mem?.usage !== undefined ? Math.max(0, mem.usage - cache) : null;
  const memLimitBytes = mem?.limit && mem.limit > 0 ? mem.limit : null;

  const networks = Object.values(raw.networks ?? {});
  const rx = networks.reduce((s, n) => s + (n?.rx_bytes ?? 0), 0);
  const tx = networks.reduce((s, n) => s + (n?.tx_bytes ?? 0), 0);

  const blk = raw.blkio_stats?.io_service_bytes_recursive ?? [];
  const blkRead = blk
    .filter((b) => (b.op ?? '').toLowerCase() === 'read')
    .reduce((s, b) => s + (b.value ?? 0), 0);
  const blkWrite = blk
    .filter((b) => (b.op ?? '').toLowerCase() === 'write')
    .reduce((s, b) => s + (b.value ?? 0), 0);

  return {
    cpuPercent,
    cpuCount,
    cpuMeasurable,
    memoryUsageMB: memUsageBytes === null ? null : sizeToMb(memUsageBytes),
    memoryLimitMB: memLimitBytes === null ? null : sizeToMb(memLimitBytes),
    memoryPercent:
      memUsageBytes !== null && memLimitBytes
        ? Math.round((memUsageBytes / memLimitBytes) * 100 * 100) / 100
        : null,
    networkRxMB: sizeToMb(rx),
    networkTxMB: sizeToMb(tx),
    blockReadMB: sizeToMb(blkRead),
    blockWriteMB: sizeToMb(blkWrite),
    pids: raw.pids_stats?.current ?? null,
  };
}
