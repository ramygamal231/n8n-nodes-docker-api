import Docker from 'dockerode';
import { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { listContainers } from './container/list.operation';
import { getContainerLogs } from './container/getLogs.operation';
import { inspectContainer } from './container/inspect.operation';
import { createContainer } from './container/create.operation';
import {
  containerChanges,
  removeContainer,
  renameContainer,
  topContainer,
} from './container/manage.operation';
import { LifecycleAction, runLifecycleOperation } from './container/lifecycle.operation';

const LIFECYCLE_ACTIONS: LifecycleAction[] = [
  'start',
  'stop',
  'restart',
  'kill',
  'pause',
  'unpause',
];

const isLifecycle = (operation: string): operation is LifecycleAction =>
  (LIFECYCLE_ACTIONS as string[]).includes(operation);

/** Operations returning a single object; list is the only one that fans out. */
const SINGLE_RESULT_OPERATIONS: Record<
  string,
  (
    this: IExecuteFunctions,
    docker: Docker,
    itemIndex: number,
  ) => Promise<IDataObject>
> = {
  getLogs: getContainerLogs,
  inspect: inspectContainer,
  create: createContainer,
  remove: removeContainer,
  rename: renameContainer,
  top: topContainer,
  changes: containerChanges,
};

export async function executeContainerOperation(
  this: IExecuteFunctions,
  docker: Docker,
  operation: string,
  itemIndex: number,
): Promise<INodeExecutionData[]> {
  if (operation === 'list') {
    const results = await listContainers.call(this, docker, itemIndex);
    return results.map((item) => ({ json: item, pairedItem: itemIndex }));
  }

  if (isLifecycle(operation)) {
    const result = await runLifecycleOperation.call(this, docker, operation, itemIndex);
    return [{ json: result, pairedItem: itemIndex }];
  }

  const handler = SINGLE_RESULT_OPERATIONS[operation];
  if (handler) {
    const result = await handler.call(this, docker, itemIndex);
    return [{ json: result, pairedItem: itemIndex }];
  }

  throw new Error(
    `Unknown operation: ${operation}. This is a bug in the node — please report it.`,
  );
}
