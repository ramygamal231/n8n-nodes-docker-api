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
      HostConfig: {
        PortBindings: Object.keys(portBindings).length ? portBindings : undefined,
        Binds: binds.length ? binds : undefined,
        AutoRemove: extra.autoRemove === true ? true : undefined,
        NetworkMode: extra.networkMode || undefined,
        Memory: extra.memoryMB ? Math.round(extra.memoryMB * 1024 * 1024) : undefined,
        RestartPolicy:
          extra.restartPolicy && extra.restartPolicy !== 'no'
            ? { Name: extra.restartPolicy }
            : undefined,
      },
    };
    if (name) (createOptions as Docker.ContainerCreateOptions & { name?: string }).name = name;

    const created = await docker.createContainer(createOptions);

    if (extra.startAfterCreate === true) {
      await created.start();
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
