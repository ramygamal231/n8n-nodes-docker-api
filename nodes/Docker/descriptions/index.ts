import { INodeProperties } from 'n8n-workflow';

import { listContainerFields } from './container/list.description';
import { getLogsContainerFields } from './container/getLogs.description';
import { createContainerFields } from './container/create.description';
import { startContainerFields } from './container/start.description';
import { stopContainerFields } from './container/stop.description';

export const containerOperations: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: {
      show: {
        resource: ['container'],
      },
    },
    options: [
      {
        name: 'List Containers',
        value: 'list',
        description: 'List all containers',
        action: 'List containers',
      },
      {
        name: 'Get Container Logs',
        value: 'getLogs',
        description: 'Retrieve logs from a container',
        action: 'Get container logs',
      },
      {
        name: 'Create Container',
        value: 'create',
        description: 'Create a container',
        action: 'Create container',
      },
      {
        name: 'Start Container',
        value: 'start',
        description: 'Start a container',
        action: 'Start container',
      },
      {
        name: 'Stop Container',
        value: 'stop',
        description: 'Stop a container',
        action: 'Stop container',
      },
    ],
    default: 'list',
  },
];

export const containerFields: INodeProperties[] = [
  ...listContainerFields,
  ...getLogsContainerFields,
  ...createContainerFields,
  ...startContainerFields,
  ...stopContainerFields,
];
