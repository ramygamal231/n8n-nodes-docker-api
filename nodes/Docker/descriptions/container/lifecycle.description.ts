import { INodeProperties } from 'n8n-workflow';

import {
  containerIdField,
  dryRunField,
  timeoutField,
} from './shared';

/** Operations that act on one existing container by ID or name. */
const TARGETED_OPERATIONS = [
  'inspect',
  'start',
  'stop',
  'restart',
  'kill',
  'pause',
  'unpause',
  'remove',
  'rename',
  'getLogs',
  'top',
  'changes',
];

/** Operations that change state and therefore offer a dry run. */
const DESTRUCTIVE_OPERATIONS = ['stop', 'restart', 'kill', 'remove'];

export const containerLifecycleFields: INodeProperties[] = [
  containerIdField(TARGETED_OPERATIONS),
  timeoutField(['stop', 'restart']),
  {
    displayName: 'Signal',
    name: 'signal',
    type: 'options',
    default: 'SIGKILL',
    displayOptions: { show: { resource: ['container'], operation: ['kill'] } },
    options: [
      { name: 'SIGKILL (Force, Immediate)', value: 'SIGKILL' },
      { name: 'SIGTERM (Graceful)', value: 'SIGTERM' },
      { name: 'SIGINT (Interrupt)', value: 'SIGINT' },
      { name: 'SIGHUP (Hangup)', value: 'SIGHUP' },
      { name: 'SIGQUIT (Quit)', value: 'SIGQUIT' },
      { name: 'SIGUSR1', value: 'SIGUSR1' },
      { name: 'SIGUSR2', value: 'SIGUSR2' },
    ],
    description: 'Signal to send to the container process',
  },
  {
    displayName: 'Force',
    name: 'force',
    type: 'boolean',
    default: false,
    displayOptions: { show: { resource: ['container'], operation: ['remove'] } },
    description: 'Whether to kill a running container instead of refusing to remove it',
  },
  {
    displayName: 'Remove Anonymous Volumes',
    name: 'removeVolumes',
    type: 'boolean',
    default: false,
    displayOptions: { show: { resource: ['container'], operation: ['remove'] } },
    description:
      'Whether to also delete anonymous volumes attached to this container. Named volumes are never removed.',
  },
  {
    displayName: 'New Name',
    name: 'newName',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'my-renamed-container',
    displayOptions: { show: { resource: ['container'], operation: ['rename'] } },
    description: 'The new name for the container',
  },
  {
    displayName: 'ps Arguments',
    name: 'psArgs',
    type: 'string',
    default: '',
    placeholder: '-ef',
    displayOptions: { show: { resource: ['container'], operation: ['top'] } },
    description: 'Arguments passed to ps inside the container. Leave empty for the Docker default.',
  },
  dryRunField(DESTRUCTIVE_OPERATIONS),
];
