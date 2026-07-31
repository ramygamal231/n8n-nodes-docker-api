import Docker from 'dockerode';
import { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { translateDockerError } from '../../helpers/errorHandler';
import { normalizeContainerInfo } from '../../helpers/normalizeContainer';
import { resolveTarget } from '../../helpers/containerTarget';

/**
 * Inspect returns the standard container shape plus the detail that only an
 * inspect response carries. It is a deliberately richer contract than list or
 * the lifecycle operations — but the shared fields are produced by the same
 * normaliser, so the common part is identical everywhere.
 *
 * Raw Docker inspect output is roughly 40 nested keys of which most are empty or
 * internal. What is surfaced here is what an automation workflow can act on.
 */
export async function inspectContainer(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;
    const target = await resolveTarget(docker, containerId);
    const info = await target.container.inspect();

    const base = normalizeContainerInfo(info);

    const health = info.State?.Health?.Status ?? null;
    const restartPolicy = info.HostConfig?.RestartPolicy;
    const networks = info.NetworkSettings?.Networks ?? {};
    const primaryNetwork = Object.values(networks)[0];

    return {
      ...base,
      state: {
        status: info.State?.Status ?? 'unknown',
        running: info.State?.Running ?? false,
        paused: info.State?.Paused ?? false,
        restarting: info.State?.Restarting ?? false,
        exitCode: info.State?.ExitCode ?? null,
        // Docker uses a zero timestamp for "never", which is noise in a workflow.
        startedAt: normalizeNullableTime(info.State?.StartedAt),
        finishedAt: normalizeNullableTime(info.State?.FinishedAt),
        health,
        // Present only when the image defines a HEALTHCHECK.
        healthChecked: health !== null,
        restartCount: info.RestartCount ?? 0,
        error: info.State?.Error === '' ? null : (info.State?.Error ?? null),
      },
      config: {
        image: info.Config?.Image ?? 'unknown',
        entrypoint: toArray(info.Config?.Entrypoint),
        command: toArray(info.Config?.Cmd),
        workingDir: emptyToNull(info.Config?.WorkingDir),
        user: emptyToNull(info.Config?.User),
        env: parseEnv(info.Config?.Env),
        exposedPorts: Object.keys(info.Config?.ExposedPorts ?? {}),
      },
      hostConfig: {
        restartPolicy: restartPolicy?.Name === '' ? 'no' : (restartPolicy?.Name ?? 'no'),
        maxRetryCount: restartPolicy?.MaximumRetryCount ?? 0,
        autoRemove: info.HostConfig?.AutoRemove ?? false,
        privileged: info.HostConfig?.Privileged ?? false,
        memoryLimitMB: bytesToMb(info.HostConfig?.Memory),
        networkMode: info.HostConfig?.NetworkMode ?? null,
      },
      network: {
        names: Object.keys(networks),
        ipAddress: emptyToNull(primaryNetwork?.IPAddress),
        macAddress: emptyToNull(primaryNetwork?.MacAddress),
        gateway: emptyToNull(primaryNetwork?.Gateway),
      },
      mounts: (info.Mounts ?? []).map((m) => ({
        type: m.Type,
        source: m.Source,
        destination: m.Destination,
        readOnly: m.RW === false,
      })),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

/** Docker writes "0001-01-01T00:00:00Z" for timestamps that never happened. */
function normalizeNullableTime(raw: string | undefined): string | null {
  if (!raw || raw.startsWith('0001-01-01')) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

const emptyToNull = (v: string | undefined | null): string | null =>
  v === undefined || v === null || v === '' ? null : v;

const toArray = (v: string[] | string | undefined | null): string[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];

function bytesToMb(bytes: number | undefined): number | null {
  if (!bytes || bytes <= 0) return null; // 0 means "unlimited", not "zero memory"
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

/** Docker returns env as ["KEY=value"]; an object is far easier to use downstream. */
function parseEnv(env: string[] | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of env ?? []) {
    const idx = entry.indexOf('=');
    if (idx === -1) {
      out[entry] = '';
      continue;
    }
    out[entry.slice(0, idx)] = entry.slice(idx + 1);
  }
  return out;
}
