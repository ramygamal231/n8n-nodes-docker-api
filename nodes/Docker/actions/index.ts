import Docker from 'dockerode';
import { IExecuteFunctions } from 'n8n-workflow';

import { listContainers } from './container/list.operation';
import { getContainerLogs } from './container/getLogs.operation';
import { startContainer } from './container/start.operation';
import { stopContainer } from './container/stop.operation';
import { createContainer } from './container/create.operation';

export async function executeContainerOperation(
  this: IExecuteFunctions,
  docker: Docker,
  operation: string,
  itemIndex: number,
): Promise<any[]> {
  switch (operation) {
    case 'list':
      const listResult = await listContainers.call(this, docker, itemIndex);
      return listResult.map((item) => ({ json: item }));

    case 'getLogs':
      const logsResult = await getContainerLogs.call(this, docker, itemIndex);
      return [{ json: logsResult }];

    case 'create':
      const createResult = await createContainer.call(this, docker, itemIndex);
      return [{ json: createResult }];

    case 'start':
      const startResult = await startContainer.call(this, docker, itemIndex);
      return [{ json: startResult }];

    case 'stop':
      const stopResult = await stopContainer.call(this, docker, itemIndex);
      return [{ json: stopResult }];

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}
