import { INodeProperties } from 'n8n-workflow';

const C = 'container';

const envCollection = (operations: string[]): INodeProperties['options'] => [
  {
    displayName: 'Environment Variables',
    name: 'env',
    type: 'fixedCollection',
    typeOptions: { multipleValues: true },
    default: {},
    placeholder: 'Add Variable',
    options: [
      {
        name: 'entry',
        displayName: 'Entry',
        values: [
          { displayName: 'Name', name: 'name', type: 'string', default: '' },
          { displayName: 'Value', name: 'value', type: 'string', default: '' },
        ],
      },
    ],
  },
];

export const advancedContainerFields: INodeProperties[] = [
  // --- Execute Command ---
  {
    displayName: 'Command',
    name: 'command',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'sh -c "cat /etc/hostname"',
    displayOptions: { show: { resource: [C], operation: ['executeCommand'] } },
    description:
      'Command to run inside the container. Quoted sections stay together as a single argument.',
  },
  {
    displayName: 'Timeout (Seconds)',
    name: 'execTimeout',
    type: 'number',
    default: 60,
    typeOptions: { minValue: 1 },
    displayOptions: { show: { resource: [C], operation: ['executeCommand'] } },
    description:
      'Give up waiting for the command after this long. The operation always returns rather than hanging, which matters when the Docker API is reached through a proxy that never closes the connection.',
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: { show: { resource: [C], operation: ['executeCommand'] } },
    options: [
      ...(envCollection(['executeCommand']) ?? []),
      { displayName: 'User', name: 'user', type: 'string', default: '', description: 'User to run the command as' },
      { displayName: 'Working Directory', name: 'workingDir', type: 'string', default: '', description: 'Directory to run the command in' },
      {
        displayName: 'Allocate TTY',
        name: 'useTty',
        type: 'boolean',
        default: false,
        description:
          'Whether to attach a terminal. This merges stdout and stderr into one stream, so leave it off unless the command needs a TTY.',
      },
    ],
  },

  // --- Wait For State ---
  {
    displayName: 'Wait For',
    name: 'targetState',
    type: 'options',
    default: 'running',
    displayOptions: { show: { resource: [C], operation: ['waitForState'] } },
    options: [
      { name: 'Running', value: 'running', description: 'Container is up' },
      {
        name: 'Healthy',
        value: 'healthy',
        description: 'Container reports healthy. Requires a HEALTHCHECK in the image.',
      },
      { name: 'Exited', value: 'exited', description: 'Container has finished' },
    ],
    description: 'State to wait for before continuing',
  },
  {
    displayName: 'Timeout (Seconds)',
    name: 'waitTimeout',
    type: 'number',
    default: 60,
    typeOptions: { minValue: 1 },
    displayOptions: { show: { resource: [C], operation: ['waitForState'] } },
    description: 'Give up after this long. The operation always returns rather than hanging.',
  },

  // --- Run (ephemeral) ---
  {
    displayName: 'Image',
    name: 'image',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'alpine:latest',
    displayOptions: { show: { resource: [C], operation: ['run'] } },
    description: 'Image to run. It must already be present locally.',
  },
  {
    displayName: 'Command',
    name: 'command',
    type: 'string',
    default: '',
    placeholder: 'sh -c "echo hello"',
    displayOptions: { show: { resource: [C], operation: ['run'] } },
    description: 'Command to run instead of the image default',
  },
  {
    displayName: 'Timeout (Seconds)',
    name: 'runTimeout',
    type: 'number',
    default: 60,
    typeOptions: { minValue: 1 },
    displayOptions: { show: { resource: [C], operation: ['run'] } },
    description:
      'Stop the container after this long if it has not finished. Output up to that point is still returned.',
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: { show: { resource: [C], operation: ['run'] } },
    options: [
      ...(envCollection(['run']) ?? []),
      { displayName: 'Container Name', name: 'containerName', type: 'string', default: '', description: 'Name for the temporary container. Leave empty for a generated one.' },
      { displayName: 'User', name: 'user', type: 'string', default: '', description: 'User to run as' },
      { displayName: 'Working Directory', name: 'workingDir', type: 'string', default: '', description: 'Directory to run in' },
      { displayName: 'Network Mode', name: 'networkMode', type: 'string', default: '', placeholder: 'bridge, host, none', description: 'Network for the container. Use "none" to run with no network access.' },
      {
        displayName: 'Keep Container',
        name: 'keepContainer',
        type: 'boolean',
        default: false,
        description:
          'Whether to keep the container after it exits instead of deleting it. Off by default so repeated runs do not accumulate containers.',
      },
    ],
  },

  // --- Copy ---
  {
    displayName: 'Container Path',
    name: 'remotePath',
    type: 'string',
    required: true,
    default: '',
    placeholder: '/etc/hostname or /app/config',
    displayOptions: { show: { resource: [C], operation: ['copyFrom', 'copyTo'] } },
    description:
      'For Copy From, the file or directory to read. For Copy To, the directory to write into.',
  },
  {
    displayName: 'Binary Property',
    name: 'binaryPropertyName',
    type: 'string',
    default: 'data',
    required: true,
    displayOptions: { show: { resource: [C], operation: ['copyFrom', 'copyTo'] } },
    description:
      'Name of the binary property to write the file to, or read it from on the incoming item',
  },
  {
    displayName: 'Return Raw Tar Archive',
    name: 'returnRawTar',
    type: 'boolean',
    default: false,
    displayOptions: { show: { resource: [C], operation: ['copyFrom'] } },
    description:
      'Whether to return Docker’s tar archive as-is. Required for directories, which cannot be returned as a single file.',
  },
  {
    displayName: 'Target File Name',
    name: 'targetFileName',
    type: 'string',
    default: '',
    displayOptions: { show: { resource: [C], operation: ['copyTo'] } },
    description: 'Override the file name inside the container. Defaults to the incoming file name.',
  },
];
