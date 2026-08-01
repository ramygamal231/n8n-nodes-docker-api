import { DockerApi as Docker } from '../../../../utils/dockerApi';
import { Readable } from 'stream';
import { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { translateDockerError } from '../../helpers/errorHandler';
import { normalizeContainerInfo } from '../../helpers/normalizeContainer';
import { resolveTarget } from '../../helpers/containerTarget';
import { bytesToMb, toNullableTimestamp } from '../../helpers/normalizePrimitives';

/**
 * Exports a container's entire filesystem as a tar archive.
 *
 * The archive is handed to n8n's binary helpers as a STREAM rather than a
 * buffer. A container filesystem is routinely tens or hundreds of megabytes, and
 * streaming lets n8n spool it according to its binary data mode instead of
 * holding the whole thing in memory and embedding it in the execution record.
 */
export async function exportContainer(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<INodeExecutionData> {
  try {
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;
    const outputProperty = (this.getNodeParameter(
      'binaryPropertyName',
      itemIndex,
      'data',
    ) as string).trim();

    const target = await resolveTarget(docker, containerId);
    const stream = (await target.container.export()) as unknown as Readable;
    const fileName = `${target.name}.tar`;

    return {
      json: {
        containerId: target.id,
        shortId: target.shortId,
        containerName: target.name,
        fileName,
        format: 'tar',
        exportedAt: new Date().toISOString(),
      },
      binary: {
        [outputProperty]: await this.helpers.prepareBinaryData(
          stream,
          fileName,
          'application/x-tar',
        ),
      },
      pairedItem: itemIndex,
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

/**
 * Reports what exists at a path inside a container, without transferring it.
 *
 * Docker answers this with a HEAD request whose entire payload sits in the
 * `X-Docker-Container-Path-Stat` response header as base64 JSON — there is no
 * response body at all. Reading only the body yields an empty string, which is
 * why this endpoint is easy to get silently wrong.
 */
export async function containerPathInfo(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  let response: { headers?: Record<string, string>; destroy?: () => void } | undefined;
  try {
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;
    const remotePath = (this.getNodeParameter('remotePath', itemIndex) as string).trim();
    if (remotePath === '') throw new Error('Container Path is required and cannot be empty.');

    const target = await resolveTarget(docker, containerId);

    // dockerode types this as void because the useful part is not the body; the
    // stat arrives as a base64 header on the response object it actually returns.
    try {
      response = (await target.container.infoArchive({ path: remotePath })) as unknown as {
        headers?: Record<string, string>;
        destroy?: () => void;
      };
    } catch (error) {
      // Docker answers a missing PATH with "(HTTP code 404) no such container"
      // and an empty body — the same error it gives for a missing container, so
      // the message alone cannot tell them apart. The container was just
      // resolved successfully, so a 404 here can only mean the path.
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 404) {
        throw new Error(
          `Path '${remotePath}' does not exist in container '${target.name}'. ` +
            `Check the path is correct and absolute.`,
        );
      }
      throw error;
    }

    const encoded = response?.headers?.['x-docker-container-path-stat'];
    if (!encoded) {
      throw new Error(
        `Docker returned no path information for '${remotePath}'. The path may not exist.`,
      );
    }

    const stat = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as {
      name?: string;
      size?: number;
      mode?: number;
      mtime?: string;
      linkTarget?: string;
    };

    // Go's os.FileMode packs type bits above the permission bits; the directory
    // flag is 1<<31. Surfacing "is it a directory" is more useful than the raw int.
    const mode = stat.mode ?? 0;
    const isDir = (mode & 0x80000000) !== 0;

    return {
      containerId: target.id,
      shortId: target.shortId,
      containerName: target.name,
      path: remotePath,
      name: stat.name ?? null,
      exists: true,
      isDirectory: isDir,
      sizeBytes: stat.size ?? 0,
      sizeMB: bytesToMb(stat.size),
      permissions: (mode & 0o777).toString(8).padStart(3, '0'),
      linkTarget: stat.linkTarget && stat.linkTarget !== '' ? stat.linkTarget : null,
      modifiedAt: toNullableTimestamp(stat.mtime),
      retrievedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  } finally {
    // infoArchive is issued with isStream, so the response holds the socket open
    // and would keep the workflow alive if it were not released.
    response?.destroy?.();
  }
}

/**
 * Changes a running container's resource limits and restart policy in place,
 * without recreating it.
 */
export async function updateContainer(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;
    const updates = this.getNodeParameter('updateFields', itemIndex, {}) as {
      memoryMB?: number;
      cpuShares?: number;
      restartPolicy?: string;
      maxRetryCount?: number;
    };

    if (Object.keys(updates).length === 0) {
      throw new Error(
        'No update fields were set. Choose at least one setting to change, ' +
          'otherwise this operation would do nothing.',
      );
    }

    const target = await resolveTarget(docker, containerId);
    const payload: Record<string, unknown> = {};

    // Docker treats 0 as "unlimited" here, so it is a meaningful value rather
    // than an absent one and must be sent when explicitly chosen.
    if (updates.memoryMB !== undefined) {
      payload.Memory = Math.round(updates.memoryMB * 1024 * 1024);
      // MemorySwap must be >= Memory or Docker rejects the update.
      payload.MemorySwap = payload.Memory === 0 ? 0 : Math.round(updates.memoryMB * 2 * 1024 * 1024);
    }
    if (updates.cpuShares !== undefined) payload.CpuShares = updates.cpuShares;
    if (updates.restartPolicy !== undefined) {
      payload.RestartPolicy = {
        Name: updates.restartPolicy === 'no' ? '' : updates.restartPolicy,
        MaximumRetryCount:
          updates.restartPolicy === 'on-failure' ? (updates.maxRetryCount ?? 0) : 0,
      };
    }

    const result = (await target.container.update(payload)) as unknown as {
      Warnings?: string[] | null;
    };
    const info = await target.container.inspect();

    return {
      ...normalizeContainerInfo(info),
      updated: true,
      applied: payload as IDataObject,
      warnings: result?.Warnings ?? [],
      memoryLimitMB: bytesToMb(info.HostConfig?.Memory),
      restartPolicy: info.HostConfig?.RestartPolicy?.Name || 'no',
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}
