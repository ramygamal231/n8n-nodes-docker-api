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

    return {
      events,
      eventCount: events.length,
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
