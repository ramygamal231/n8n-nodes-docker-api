import { DockerApi as Docker } from '../../../../utils/dockerApi';
import { IExecuteFunctions } from 'n8n-workflow';

import { translateDockerError } from '../../helpers/errorHandler';
import { normalizeContainerInfo } from '../../helpers/normalizeContainer';
import { resolveContainer } from '../../helpers/resolveContainer';

export async function startContainer(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<any> {
  try {
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;

    // Resolve name to ID first
    const resolved = await resolveContainer(docker, containerId);
    const container = docker.getContainer(resolved.id);

    await container.start();

    // Get updated info using the same container instance
    const containerInfo = await container.inspect();

    return normalizeContainerInfo(containerInfo);
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}
