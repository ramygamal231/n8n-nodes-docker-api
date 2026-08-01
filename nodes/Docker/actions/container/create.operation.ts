import Docker from 'dockerode';
import { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { translateDockerError } from '../../helpers/errorHandler';
import { normalizeContainerInfo } from '../../helpers/normalizeContainer';

interface KeyValueEntry {
  entry?: Array<{ name: string; value: string }>;
}
interface PortEntry {
  mapping?: Array<{ containerPort: number; hostPort: number; protocol: string }>;
}
interface VolumeEntry {
  mapping?: Array<{ source: string; target: string; readOnly: boolean }>;
}

/**
 * Splits a command string into argv, respecting single and double quotes so that
 *   sh -c "echo hello world"
 * becomes three arguments rather than five. Docker takes an array; making the
 * user hand-write JSON for the common case would be poor UX.
 */
export function parseCommand(input: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let started = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (current !== '' || started) out.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
  }
  if (current !== '' || started) out.push(current);
  return out;
}

const pairsToObject = (raw: KeyValueEntry | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const { name, value } of raw?.entry ?? []) {
    if (name) out[name] = value ?? '';
  }
  return out;
};

export async function createContainer(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const image = this.getNodeParameter('image', itemIndex) as string;
    const name = (this.getNodeParameter('containerName', itemIndex, '') as string).trim();
    const commandRaw = (this.getNodeParameter('command', itemIndex, '') as string).trim();
    const portMappings = this.getNodeParameter('portMappings', itemIndex, {}) as PortEntry;
    const volumeMappings = this.getNodeParameter('volumeMappings', itemIndex, {}) as VolumeEntry;
    const envPairs = this.getNodeParameter('env', itemIndex, {}) as KeyValueEntry;
    const labelPairs = this.getNodeParameter('labels', itemIndex, {}) as KeyValueEntry;
    const extra = this.getNodeParameter('additionalFields', itemIndex, {}) as {
      workingDir?: string;
      user?: string;
      entrypoint?: string;
      restartPolicy?: string;
      autoRemove?: boolean;
      networkMode?: string;
      memoryMB?: number;
      startAfterCreate?: boolean;
      cpus?: number;
      cpuShares?: number;
      healthcheck?: {
        check?: {
          test?: string;
          intervalSeconds?: number;
          timeoutSeconds?: number;
          retries?: number;
          startPeriodSeconds?: number;
        };
      };
      extraHosts?: string;
      dns?: string;
      capAdd?: string;
      capDrop?: string;
      privileged?: boolean;
      devices?: string;
      shmSizeMB?: number;
      tmpfs?: string;
      init?: boolean;
    };

    const exposedPorts: Record<string, Record<string, never>> = {};
    const portBindings: Record<string, Array<{ HostPort: string }>> = {};
    for (const m of portMappings.mapping ?? []) {
      const key = `${m.containerPort}/${m.protocol || 'tcp'}`;
      exposedPorts[key] = {};
      // Host port 0 tells Docker to pick a free port rather than binding to 0.
      portBindings[key] = [{ HostPort: m.hostPort ? String(m.hostPort) : '' }];
    }

    const binds = (volumeMappings.mapping ?? [])
      .filter((m) => m.source && m.target)
      .map((m) => `${m.source}:${m.target}${m.readOnly ? ':ro' : ''}`);

    const env = Object.entries(pairsToObject(envPairs)).map(([k, v]) => `${k}=${v}`);

    /** Comma-separated free text into a clean list, ignoring stray whitespace. */
    const csv = (raw: string | undefined): string[] =>
      (raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');

    // Docker expects devices as objects, and defaults the in-container path to
    // the host path when only one is given — which is what people mean by
    // --device /dev/ttyUSB0.
    const devices = csv(extra.devices).map((d) => {
      const [host, container] = d.split(':');
      return {
        PathOnHost: host,
        PathInContainer: container || host,
        CgroupPermissions: 'rwm',
      };
    });

    // Tmpfs is a map of path to mount options, where an empty string means
    // "defaults" rather than "no options".
    const tmpfs: Record<string, string> = {};
    for (const entry of csv(extra.tmpfs)) {
      const idx = entry.indexOf(':');
      if (idx === -1) tmpfs[entry] = '';
      else tmpfs[entry.slice(0, idx)] = entry.slice(idx + 1);
    }

    const hc = extra.healthcheck?.check;
    const healthTest = hc?.test?.trim();
    // Docker takes nanoseconds. Seconds are what people think in.
    const toNs = (seconds: number | undefined): number | undefined =>
      typeof seconds === 'number' && seconds > 0 ? Math.round(seconds * 1e9) : undefined;

    const createOptions: Docker.ContainerCreateOptions = {
      Image: image,
      Env: env.length ? env : undefined,
      Cmd: commandRaw ? parseCommand(commandRaw) : undefined,
      Entrypoint: extra.entrypoint ? parseCommand(extra.entrypoint) : undefined,
      WorkingDir: extra.workingDir || undefined,
      User: extra.user || undefined,
      Labels: Object.keys(pairsToObject(labelPairs)).length
        ? pairsToObject(labelPairs)
        : undefined,
      ExposedPorts: Object.keys(exposedPorts).length ? exposedPorts : undefined,
      // Defining a healthcheck here is what makes Wait For State's "healthy"
      // usable on a container this node created: without one Docker reports no
      // health status at all, and there is nothing to wait for.
      Healthcheck: healthTest
        ? {
            // CMD-SHELL runs the string through a shell, so an ordinary command
            // line with pipes and || works as typed.
            Test: ['CMD-SHELL', healthTest],
            Interval: toNs(hc?.intervalSeconds),
            Timeout: toNs(hc?.timeoutSeconds),
            Retries: hc?.retries && hc.retries > 0 ? hc.retries : undefined,
            StartPeriod: toNs(hc?.startPeriodSeconds),
          }
        : undefined,
      HostConfig: {
        PortBindings: Object.keys(portBindings).length ? portBindings : undefined,
        Binds: binds.length ? binds : undefined,
        AutoRemove: extra.autoRemove === true ? true : undefined,
        NetworkMode: extra.networkMode || undefined,
        Memory: extra.memoryMB ? Math.round(extra.memoryMB * 1024 * 1024) : undefined,
        // Docker expresses a CPU ceiling in billionths of a core.
        NanoCpus: extra.cpus ? Math.round(extra.cpus * 1e9) : undefined,
        CpuShares: extra.cpuShares ? Math.round(extra.cpuShares) : undefined,
        ExtraHosts: csv(extra.extraHosts).length ? csv(extra.extraHosts) : undefined,
        Dns: csv(extra.dns).length ? csv(extra.dns) : undefined,
        CapAdd: csv(extra.capAdd).length ? csv(extra.capAdd) : undefined,
        CapDrop: csv(extra.capDrop).length ? csv(extra.capDrop) : undefined,
        Privileged: extra.privileged === true ? true : undefined,
        Devices: devices.length ? devices : undefined,
        ShmSize: extra.shmSizeMB ? Math.round(extra.shmSizeMB * 1024 * 1024) : undefined,
        Tmpfs: Object.keys(tmpfs).length ? tmpfs : undefined,
        Init: extra.init === true ? true : undefined,
        RestartPolicy:
          extra.restartPolicy && extra.restartPolicy !== 'no'
            ? { Name: extra.restartPolicy }
            : undefined,
      },
    };
    if (name) (createOptions as Docker.ContainerCreateOptions & { name?: string }).name = name;

    const created = await docker.createContainer(createOptions);

    if (extra.startAfterCreate === true) {
      try {
        await created.start();
      } catch (startError) {
        // The container exists at this point — Docker creates it first and only
        // fails when starting (a taken host port is the usual cause). Leaving it
        // matches the Docker CLI, but saying nothing would leave the user with a
        // container they do not know about, so the message names it.
        const shortId = created.id.substring(0, 12);
        throw new Error(
          `${translateDockerError(startError)} The container was created but could not be ` +
            `started, and has been left in place as '${name || shortId}' (${shortId}) so you ` +
            `can inspect or remove it.`,
        );
      }
    }

    const info = await created.inspect();
    return {
      ...normalizeContainerInfo(info),
      started: extra.startAfterCreate === true,
      // Docker returns warnings for things like an unreachable image platform.
      warnings: (info as unknown as { Warnings?: string[] }).Warnings ?? [],
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}
