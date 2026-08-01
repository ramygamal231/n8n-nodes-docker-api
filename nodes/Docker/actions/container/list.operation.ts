import type Dockerode from 'dockerode';
import { DockerApi as Docker } from '../../../../utils/dockerApi';
import { IExecuteFunctions } from 'n8n-workflow';

import { translateDockerError } from '../../helpers/errorHandler';
import { normalizeContainerInfo } from '../../helpers/normalizeContainer';

/**
 * Maps user-friendly status values to Docker API values
 */
const statusMap: Record<string, string> = {
  stopped: 'exited',
};

export async function listContainers(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<any[]> {
  try {
    const showAll = this.getNodeParameter('showAll', itemIndex, false) as boolean;
    const filters = this.getNodeParameter('filters', itemIndex, {}) as {
      name?: string;
      status?: string;
    };
    const includeLabels = this.getNodeParameter('includeLabels', itemIndex, true) as boolean;

    const listOptions: Dockerode.ContainerListOptions = {
      all: showAll,
      filters: {},
    };

    // Build filters - map user-friendly values to Docker API values
    if (filters.status && filters.status !== '') {
      const dockerStatus = statusMap[filters.status.toLowerCase()] || filters.status;
      (listOptions.filters as any) = {
        status: [dockerStatus],
      };
    }

    const containers = await docker.listContainers(listOptions);

    // Normalize and filter by name if provided
    let normalized = containers.map((c) => normalizeContainerInfo(c, includeLabels));

    if (filters.name && filters.name !== '') {
      const nameFilter = filters.name.toLowerCase();
      normalized = normalized.filter((c) => c.name.toLowerCase().includes(nameFilter));
    }

    return normalized;
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}
