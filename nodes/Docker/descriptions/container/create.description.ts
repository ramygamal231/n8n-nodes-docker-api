import { INodeProperties } from 'n8n-workflow';

import { keyValueField, portMappingField, volumeMappingField } from './shared';

const CREATE = ['create'];

export const createContainerFields: INodeProperties[] = [
  {
    displayName: 'Image',
    name: 'image',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'nginx:alpine',
    displayOptions: { show: { resource: ['container'], operation: CREATE } },
    description:
      'Image to create the container from. It must already be present locally — pull it first if not.',
  },
  {
    displayName: 'Container Name',
    name: 'containerName',
    type: 'string',
    default: '',
    placeholder: 'my-container',
    displayOptions: { show: { resource: ['container'], operation: CREATE } },
    description: 'Name for the new container. Leave empty to let Docker generate one.',
  },
  {
    displayName: 'Command',
    name: 'command',
    type: 'string',
    default: '',
    placeholder: 'sh -c "echo hello"',
    displayOptions: { show: { resource: ['container'], operation: CREATE } },
    description:
      'Command to run instead of the image default. Quoted sections are kept together as one argument.',
  },
  portMappingField(CREATE),
  volumeMappingField(CREATE),
  keyValueField(
    'env',
    'Environment Variables',
    CREATE,
    'Environment variables to set inside the container',
    'Add Variable',
  ),
  keyValueField('labels', 'Labels', CREATE, 'Labels to attach to the container', 'Add Label'),
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: { show: { resource: ['container'], operation: CREATE } },
    options: [
      {
        displayName: 'Start After Create',
        name: 'startAfterCreate',
        type: 'boolean',
        default: false,
        description:
          'Whether to start the container immediately after creating it, instead of leaving it in the created state',
      },
      {
        displayName: 'Entrypoint',
        name: 'entrypoint',
        type: 'string',
        default: '',
        description: 'Override the image entrypoint',
      },
      {
        displayName: 'Working Directory',
        name: 'workingDir',
        type: 'string',
        default: '',
        placeholder: '/app',
        description: 'Working directory for the command',
      },
      {
        displayName: 'User',
        name: 'user',
        type: 'string',
        default: '',
        placeholder: '1000:1000 or appuser',
        description: 'User the process runs as inside the container',
      },
      {
        displayName: 'Restart Policy',
        name: 'restartPolicy',
        type: 'options',
        default: 'no',
        options: [
          { name: 'No', value: 'no' },
          { name: 'On Failure', value: 'on-failure' },
          { name: 'Always', value: 'always' },
          { name: 'Unless Stopped', value: 'unless-stopped' },
        ],
        description: 'When Docker should automatically restart the container',
      },
      {
        displayName: 'Auto Remove',
        name: 'autoRemove',
        type: 'boolean',
        default: false,
        description: 'Whether to delete the container automatically once it exits',
      },
      {
        displayName: 'Network Mode',
        name: 'networkMode',
        type: 'string',
        default: '',
        placeholder: 'bridge, host, or a network name',
        description: 'Network the container attaches to',
      },
      {
        displayName: 'Memory Limit (MB)',
        name: 'memoryMB',
        type: 'number',
        default: 0,
        typeOptions: { minValue: 0 },
        description: 'Hard memory limit in megabytes. Leave at 0 for unlimited.',
      },
    ],
  },
];
