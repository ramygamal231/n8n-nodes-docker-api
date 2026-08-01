import Docker from 'dockerode';
import { Readable } from 'stream';
import { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { translateDockerError } from '../helpers/errorHandler';
import { sizeToMb, toIsoTimestamp } from '../helpers/normalizePrimitives';

export async function systemInfo(
  this: IExecuteFunctions,
  docker: Docker,
  _itemIndex: number,
): Promise<IDataObject> {
  try {
    const info = (await docker.info()) as unknown as Record<string, unknown>;
    const n = (k: string): number => (typeof info[k] === 'number' ? (info[k] as number) : 0);
    const s = (k: string): string | null =>
      typeof info[k] === 'string' && info[k] !== '' ? (info[k] as string) : null;

    return {
      name: s('Name'),
      serverVersion: s('ServerVersion'),
      containers: {
        total: n('Containers'),
        running: n('ContainersRunning'),
        paused: n('ContainersPaused'),
        stopped: n('ContainersStopped'),
      },
      images: n('Images'),
      os: {
        type: s('OSType'),
        name: s('OperatingSystem'),
        architecture: s('Architecture'),
        kernelVersion: s('KernelVersion'),
      },
      resources: {
        cpus: n('NCPU'),
        memoryMB: sizeToMb(n('MemTotal')),
      },
      storage: {
        driver: s('Driver'),
        rootDir: s('DockerRootDir'),
      },
      swarm: {
        // LocalNodeState is "inactive" on a non-Swarm host, which is the common case.
        enabled: (info.Swarm as { LocalNodeState?: string })?.LocalNodeState === 'active',
        nodeState: (info.Swarm as { LocalNodeState?: string })?.LocalNodeState ?? 'inactive',
      },
      // Docker surfaces configuration problems here (missing cgroup features,
      // insecure registries, and so on). Passing them through is more useful
      // than dropping them, and they are usually empty.
      warnings: (info.Warnings as string[] | null) ?? [],
      retrievedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function systemVersion(
  this: IExecuteFunctions,
  docker: Docker,
  _itemIndex: number,
): Promise<IDataObject> {
  try {
    const v = (await docker.version()) as unknown as Record<string, unknown>;
    return {
      version: v.Version ?? null,
      apiVersion: v.ApiVersion ?? null,
      minApiVersion: v.MinAPIVersion ?? null,
      gitCommit: v.GitCommit ?? null,
      goVersion: v.GoVersion ?? null,
      os: v.Os ?? null,
      arch: v.Arch ?? null,
      kernelVersion: v.KernelVersion ?? null,
      buildTime: v.BuildTime ? toIsoTimestamp(v.BuildTime as string) : null,
      components: ((v.Components as Array<{ Name?: string; Version?: string }>) ?? []).map((c) => ({
        name: c.Name ?? 'unknown',
        version: c.Version ?? 'unknown',
      })),
      retrievedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function systemPing(
  this: IExecuteFunctions,
  docker: Docker,
  _itemIndex: number,
): Promise<IDataObject> {
  const startedAt = Date.now();
  try {
    await docker.ping();
    return {
      reachable: true,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    // A failed ping is the answer to "is Docker reachable", not an exception to
    // be swallowed - but it is still an error, so the workflow can branch on it.
    throw new Error(translateDockerError(error));
  }
}

export async function systemDiskUsage(
  this: IExecuteFunctions,
  docker: Docker,
  _itemIndex: number,
): Promise<IDataObject> {
  try {
    const df = (await docker.df()) as unknown as {
      LayersSize?: number;
      Images?: Array<{ Size?: number; Containers?: number }> | null;
      Containers?: Array<{ SizeRw?: number }> | null;
      Volumes?: Array<{ UsageData?: { Size?: number; RefCount?: number } }> | null;
      BuildCache?: Array<{ Size?: number; InUse?: boolean }> | null;
    };

    const images = df.Images ?? [];
    const containers = df.Containers ?? [];
    const volumes = df.Volumes ?? [];
    const buildCache = df.BuildCache ?? [];

    const sum = (nums: Array<number | undefined>) =>
      sizeToMb(nums.reduce<number>((a, b) => a + (b ?? 0), 0));

    return {
      images: {
        count: images.length,
        // Unused images are the ones no container references, i.e. reclaimable.
        unused: images.filter((i) => (i.Containers ?? 0) <= 0).length,
        totalMB: sizeToMb(df.LayersSize),
      },
      containers: {
        count: containers.length,
        writableLayerMB: sum(containers.map((c) => c.SizeRw)),
      },
      volumes: {
        count: volumes.length,
        unused: volumes.filter((v) => (v.UsageData?.RefCount ?? 0) <= 0).length,
        totalMB: sum(volumes.map((v) => v.UsageData?.Size)),
      },
      buildCache: {
        count: buildCache.length,
        totalMB: sum(buildCache.map((b) => b.Size)),
        reclaimableMB: sum(buildCache.filter((b) => !b.InUse).map((b) => b.Size)),
      },
      retrievedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

/**
 * Reads Docker events over a bounded time window.
 *
 * /events streams indefinitely when no `until` is given, which is exactly how a
 * workflow ends up hung forever - the failure mode observed in the other Docker
 * node, whose System Events operation never returns. An `until` is therefore
 * always sent, defaulting to now, so this call is guaranteed to terminate.
 *
 * Continuous, open-ended event watching belongs in the trigger node, not here.
 */
export async function systemEvents(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const minutes = this.getNodeParameter('sinceMinutes', itemIndex, 60) as number;
    const filterSpec = this.getNodeParameter('eventFilters', itemIndex, {}) as {
      type?: string;
      action?: string;
      container?: string;
    };

    const untilSec = Math.floor(Date.now() / 1000);
    const sinceSec = untilSec - Math.max(1, minutes) * 60;

    const filters: Record<string, string[]> = {};
    if (filterSpec.type) filters.type = [filterSpec.type];
    if (filterSpec.action) filters.event = [filterSpec.action];
    if (filterSpec.container) filters.container = [filterSpec.container];

    const stream = (await docker.getEvents({
      since: sinceSec,
      until: untilSec,
      filters: Object.keys(filters).length ? filters : undefined,
    } as never)) as unknown as Readable;

    const raw: string = await new Promise((resolve, reject) => {
      let buf = '';
      stream.on('data', (chunk: Buffer) => (buf += chunk.toString('utf8')));
      stream.on('end', () => resolve(buf));
      stream.on('error', reject);
    });

    // The body is newline-delimited JSON, one object per event.
    const events = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((e): e is Record<string, unknown> => e !== null)
      .map((e) => {
        const actor = e.Actor as { ID?: string; Attributes?: Record<string, string> } | undefined;
        return {
          type: e.Type ?? null,
          action: e.Action ?? null,
          actorId: actor?.ID ?? null,
          name: actor?.Attributes?.name ?? null,
          image: actor?.Attributes?.image ?? null,
          scope: e.scope ?? null,
          // timeNano is more precise but arrives as a bare number of nanoseconds.
          time: toIsoTimestamp(e.time as number),
          attributes: actor?.Attributes ?? {},
        };
      });

    // The daemon keeps a fixed ring of recent events in memory — 256 by default —
    // and answers a historical query from that buffer alone. On a busy host it
    // rolls in minutes: a container with a healthcheck emits three exec events
    // every interval, which is enough to evict everything else. Asking for the
    // last hour then returns the last few minutes, with nothing to distinguish
    // that from an hour in which nothing else happened.
    //
    // Both conditions are required before saying so. A full buffer alone is not
    // evidence — a daemon configured with a larger one could legitimately return
    // 256 events — and a short reach alone is not either, since a quiet host
    // genuinely has no older events. Together they mean the buffer was full AND
    // did not reach back to what was asked, which only happens under eviction.
    const times = events.map((e) => e.time).filter((t): t is string => typeof t === 'string');
    const oldest = times.length ? times.reduce((a, b) => (a < b ? a : b)) : null;
    const newest = times.length ? times.reduce((a, b) => (a > b ? a : b)) : null;
    const DAEMON_EVENT_BUFFER = 256;
    const truncated =
      events.length >= DAEMON_EVENT_BUFFER &&
      oldest !== null &&
      new Date(oldest).getTime() > sinceSec * 1000 + 60_000;

    return {
      events,
      eventCount: events.length,
      // The window actually covered, which is not always the window requested.
      oldestEvent: oldest,
      newestEvent: newest,
      windowTruncated: truncated,
      ...(truncated
        ? {
            warning:
              `Docker's in-memory event buffer (${DAEMON_EVENT_BUFFER} events) filled before ` +
              `reaching the requested start time, so older events were discarded by the daemon ` +
              `and cannot be retrieved. These results only reach back to ${oldest}. Use the ` +
              `Docker Trigger node to capture events as they happen rather than reading history.`,
          }
        : {}),
      window: {
        since: new Date(sinceSec * 1000).toISOString(),
        until: new Date(untilSec * 1000).toISOString(),
        minutes,
      },
      retrievedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

/**
 * Verifies registry credentials without pulling or pushing anything.
 *
 * Lets a workflow confirm a registry login is still valid before starting work
 * that depends on it, rather than discovering an expired token halfway through
 * a deployment.
 */
export async function systemAuth(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  const username = (this.getNodeParameter('registryUsername', itemIndex, '') as string).trim();
  const password = this.getNodeParameter('registryPassword', itemIndex, '') as string;
  const serveraddress =
    (this.getNodeParameter('registryAddress', itemIndex, '') as string).trim() ||
    'https://index.docker.io/v1/';

  try {
    const result = (await docker.checkAuth({
      username,
      password,
      serveraddress,
    } as never)) as unknown as { Status?: string; IdentityToken?: string };

    return {
      authenticated: true,
      registry: serveraddress,
      username: username || null,
      status: result?.Status ?? 'Login Succeeded',
      // Present when the registry issues a short-lived token instead of
      // accepting the password on every request.
      identityTokenIssued: !!result?.IdentityToken,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    // A rejected login is the answer to "are these credentials valid", but it is
    // still a failure, so the workflow can branch on it.
    throw new Error(translateDockerError(error));
  }
}
