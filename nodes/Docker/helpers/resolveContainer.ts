import type Dockerode from 'dockerode';
import { DockerApi as Docker } from '../../../utils/dockerApi';

/**
 * Resolves a container ID or name to a full container info object.
 * Docker API requires exact ID or name (with leading /).
 * This function handles user-friendly names by finding the matching container.
 */
export async function resolveContainer(
  docker: Docker,
  containerIdOrName: string,
): Promise<{ id: string; name: string; info: Dockerode.ContainerInfo }> {
  const allContainers = await docker.listContainers({ all: true });

  // Try exact match first (ID or name with /)
  let containerInfo = allContainers.find(
    (c) =>
      c.Id === containerIdOrName ||
      c.Id.startsWith(containerIdOrName) ||
      c.Names?.some((n) => n === containerIdOrName || n === `/${containerIdOrName}`),
  );

  // If not found, try name without leading /
  if (!containerInfo) {
    containerInfo = allContainers.find((c) =>
      c.Names?.some((n) => n.replace(/^\//, '') === containerIdOrName),
    );
  }

  if (!containerInfo) {
    throw new Error(
      `Container '${containerIdOrName}' not found. Verify the container ID or name is correct and the container exists.`,
    );
  }

  const name = containerInfo.Names?.[0]?.replace(/^\//, '') ?? 'unknown';

  return {
    id: containerInfo.Id,
    name,
    info: containerInfo,
  };
}
