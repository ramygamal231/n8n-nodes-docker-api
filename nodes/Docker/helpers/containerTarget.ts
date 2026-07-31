import Docker from 'dockerode';
import { IDataObject } from 'n8n-workflow';

import { resolveContainer } from './resolveContainer';

export interface ContainerTarget {
  container: Docker.Container;
  id: string;
  shortId: string;
  name: string;
}

/**
 * Resolves a user-supplied name or ID prefix to a concrete container handle.
 *
 * Every operation that acts on a single container needs the same three things:
 * the dockerode handle, the full ID, and a human-readable name for messages and
 * output. Doing it in one place keeps "container not found" wording identical
 * across operations.
 */
export async function resolveTarget(
  docker: Docker,
  containerIdOrName: string,
): Promise<ContainerTarget> {
  const resolved = await resolveContainer(docker, containerIdOrName);
  return {
    container: docker.getContainer(resolved.id),
    id: resolved.id,
    shortId: resolved.id.substring(0, 12),
    name: resolved.name,
  };
}

/**
 * The dry-run payload, identical in shape for every destructive operation so a
 * workflow can branch on `dryRun` / `executed` without caring which action it was.
 */
export function dryRunResult(
  action: string,
  target: ContainerTarget,
  summary: string,
): IDataObject {
  return {
    dryRun: true,
    action,
    target: { id: target.id, shortId: target.shortId, name: target.name },
    executed: false,
    message: `Dry run: ${summary}`,
  };
}
