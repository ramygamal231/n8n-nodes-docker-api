import { INodeProperties } from 'n8n-workflow';

import { listContainerFields } from './container/list.description';
import { getLogsContainerFields } from './container/getLogs.description';
import { containerLifecycleFields } from './container/lifecycle.description';
import { createContainerFields } from './container/create.description';

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
      // --- read ---
      {
        name: 'List Containers',
        value: 'list',
        description: 'List containers with normalized output',
        action: 'List containers',
      },
      {
        name: 'Inspect Container',
        value: 'inspect',
        description: 'Get full details of a container, including health and network',
        action: 'Inspect container',
      },
      {
        name: 'Get Container Logs',
        value: 'getLogs',
        description: 'Retrieve logs from a container',
        action: 'Get container logs',
      },
      {
        name: 'List Processes',
        value: 'top',
        description: 'List processes running inside a container',
        action: 'List processes in container',
      },
      {
        name: 'Get Filesystem Changes',
        value: 'changes',
        description: 'List files changed relative to the container image',
        action: 'Get filesystem changes',
      },
      // --- lifecycle ---
      {
        name: 'Create Container',
        value: 'create',
        description: 'Create a container from an image',
        action: 'Create container',
      },
      {
        name: 'Start Container',
        value: 'start',
        description: 'Start a stopped container',
        action: 'Start container',
      },
      {
        name: 'Stop Container',
        value: 'stop',
        description: 'Stop a running container gracefully',
        action: 'Stop container',
      },
      {
        name: 'Restart Container',
        value: 'restart',
        description: 'Restart a container',
        action: 'Restart container',
      },
      {
        name: 'Kill Container',
        value: 'kill',
        description: 'Send a signal to a container immediately, without a grace period',
        action: 'Kill container',
      },
      {
        name: 'Pause Container',
        value: 'pause',
        description: 'Suspend all processes in a container',
        action: 'Pause container',
      },
      {
        name: 'Unpause Container',
        value: 'unpause',
        description: 'Resume a paused container',
        action: 'Unpause container',
      },
      {
        name: 'Rename Container',
        value: 'rename',
        description: 'Change the name of a container',
        action: 'Rename container',
      },
      {
        name: 'Remove Container',
        value: 'remove',
        description: 'Delete a container',
        action: 'Remove container',
      },
    ],
    default: 'list',
  },
];

export const containerFields: INodeProperties[] = [
  ...listContainerFields,
  ...getLogsContainerFields,
  ...createContainerFields,
  ...containerLifecycleFields,
];
