import { DockerApi as Docker } from '../../../../utils/dockerApi';
import { IExecuteFunctions } from 'n8n-workflow';

import { translateDockerError } from '../../helpers/errorHandler';
import { normalizeContainerInfo } from '../../helpers/normalizeContainer';
import { resolveContainer } from '../../helpers/resolveContainer';

export async function stopContainer(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<any> {
  try {
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;
    const timeout = this.getNodeParameter('timeout', itemIndex, 10) as number;
    const dryRun = this.getNodeParameter('dryRun', itemIndex, false) as boolean;

    // Resolve name to ID first
    const resolved = await resolveContainer(docker, containerId);
    const container = docker.getContainer(resolved.id);

    // Handle dry run
    if (dryRun) {
      return {
        dryRun: true,
        action: 'stop',
        target: {
          id: resolved.id,
          shortId: resolved.id.substring(0, 12),
          name: resolved.name,
        },
        executed: false,
        message: `Dry run: container '${resolved.name}' (${resolved.id.substring(0, 12)}) would have been stopped.`,
      };
    }

    // Actually stop the container
    await container.stop({ t: timeout });

    // Get updated info using the same container instance
    const containerInfo = await container.inspect();

    return normalizeContainerInfo(containerInfo);
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}
