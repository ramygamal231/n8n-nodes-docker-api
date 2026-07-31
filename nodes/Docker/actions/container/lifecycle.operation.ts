import Docker from 'dockerode';
import { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { translateDockerError } from '../../helpers/errorHandler';
import { normalizeContainerInfo } from '../../helpers/normalizeContainer';
import { dryRunResult, resolveTarget } from '../../helpers/containerTarget';

export type LifecycleAction = 'start' | 'stop' | 'restart' | 'kill' | 'pause' | 'unpause';

/**
 * The six state-change operations differ only in which dockerode call they make
 * and what they say in a dry run. Implementing them once means they cannot drift
 * apart in output shape, error handling or dry-run semantics — which is exactly
 * how v0.1.1 ended up with start and stop returning different data than list.
 */
const ACTIONS: Record<
  LifecycleAction,
  {
    verb: string;
    /** Destructive actions offer a dry run; start/pause/unpause do not. */
    supportsDryRun: boolean;
    run: (
      container: Docker.Container,
      options: { timeout: number; signal: string },
    ) => Promise<unknown>;
  }
> = {
  start: {
    verb: 'started',
    supportsDryRun: false,
    run: (container) => container.start(),
  },
  stop: {
    verb: 'stopped',
    supportsDryRun: true,
    run: (container, { timeout }) => container.stop({ t: timeout }),
  },
  restart: {
    verb: 'restarted',
    supportsDryRun: true,
    run: (container, { timeout }) => container.restart({ t: timeout }),
  },
  kill: {
    verb: 'killed',
    supportsDryRun: true,
    run: (container, { signal }) => container.kill({ signal }),
  },
  pause: {
    verb: 'paused',
    supportsDryRun: false,
    run: (container) => container.pause(),
  },
  unpause: {
    verb: 'unpaused',
    supportsDryRun: false,
    run: (container) => container.unpause(),
  },
};

export async function runLifecycleOperation(
  this: IExecuteFunctions,
  docker: Docker,
  action: LifecycleAction,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const spec = ACTIONS[action];
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;
    const timeout = this.getNodeParameter('timeout', itemIndex, 10) as number;
    const signal = this.getNodeParameter('signal', itemIndex, 'SIGKILL') as string;
    const dryRun = spec.supportsDryRun
      ? (this.getNodeParameter('dryRun', itemIndex, false) as boolean)
      : false;

    const target = await resolveTarget(docker, containerId);

    if (dryRun) {
      return dryRunResult(
        action,
        target,
        `container '${target.name}' (${target.shortId}) would have been ${spec.verb}.`,
      );
    }

    await spec.run(target.container, { timeout, signal });

    // Re-inspect so the caller gets the state after the action, not before it.
    const info = await target.container.inspect();
    return normalizeContainerInfo(info) as unknown as IDataObject;
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}
