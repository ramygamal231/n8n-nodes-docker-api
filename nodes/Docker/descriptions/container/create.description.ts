import { INodeProperties } from 'n8n-workflow';

export const createContainerFields: INodeProperties[] = [
  {
    displayName: 'Name',
    name: 'containerName',
    type: 'string',
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    default: '',
    description: 'Custom name for the container',
    placeholder: 'my-container',
  },
  {
    displayName: 'Image',
    name: 'containerImage',
    type: 'string',
    required: true,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    default: '',
    description: 'The OCI image to create the container from',
    placeholder: 'nginx:latest',
  },
  {
    displayName: 'Pull Image If Missing',
    name: 'pullIfMissing',
    type: 'boolean',
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    default: true,
    description: 'Pull the image first if it is not already available locally',
  },
  {
    displayName: 'Environment Variables',
    name: 'containerEnvs',
    type: 'fixedCollection',
    typeOptions: {
      multipleValues: true,
    },
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    options: [
      {
        name: 'envValues',
        displayName: 'Env',
        values: [
          {
            displayName: 'Name',
            name: 'name',
            type: 'string',
            default: '',
            placeholder: 'NODE_ENV',
          },
          {
            displayName: 'Value',
            name: 'value',
            type: 'string',
            default: '',
            placeholder: 'production',
          },
        ],
      },
    ],
    default: {},
  },
  {
    displayName: 'Labels',
    name: 'containerLabels',
    type: 'fixedCollection',
    typeOptions: {
      multipleValues: true,
    },
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    options: [
      {
        name: 'labelValues',
        displayName: 'Label',
        values: [
          {
            displayName: 'Name',
            name: 'name',
            type: 'string',
            default: '',
            placeholder: 'app',
          },
          {
            displayName: 'Value',
            name: 'value',
            type: 'string',
            default: '',
            placeholder: 'web',
          },
        ],
      },
    ],
    default: {},
  },
  {
    displayName: 'Ports',
    name: 'containerPorts',
    type: 'fixedCollection',
    typeOptions: {
      multipleValues: true,
    },
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    options: [
      {
        name: 'portValues',
        displayName: 'Port',
        values: [
          {
            displayName: 'Container Port',
            name: 'containerPort',
            type: 'number',
            default: 80,
          },
          {
            displayName: 'Host Port',
            name: 'hostPort',
            type: 'number',
            default: 8080,
          },
          {
            displayName: 'Protocol',
            name: 'protocol',
            type: 'options',
            options: [
              { name: 'TCP', value: 'tcp' },
              { name: 'UDP', value: 'udp' },
            ],
            default: '',
            description: 'Optional protocol, If left empty, Docker will use its default behavior.',
          },
          {
            displayName: 'Host IP',
            name: 'hostIp',
            type: 'string',
            default: '',
            placeholder: '127.0.0.1',
          },
        ],
      },
    ],
    default: {},
  },
  {
    displayName: 'Volumes',
    name: 'containerVolumes',
    type: 'fixedCollection',
    typeOptions: {
      multipleValues: true,
    },
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    options: [
      {
        name: 'volumeValues',
        displayName: 'Volume',
        values: [
          {
            displayName: 'Host Path',
            name: 'hostPath',
            type: 'string',
            default: '',
            placeholder: '/data',
          },
          {
            displayName: 'Container Path',
            name: 'containerPath',
            type: 'string',
            default: '',
            placeholder: '/var/lib/data',
          },
          {
            displayName: 'Read Only',
            name: 'readOnly',
            type: 'boolean',
            default: false,
          },
        ],
      },
    ],
    default: {},
  },
  {
    displayName: 'Command',
    name: 'containerCmd',
    type: 'string',
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    default: '',
    description: 'Command to start the container with',
    placeholder: '/bin/bash',
  },
  {
    displayName: 'Entrypoint',
    name: 'containerEntrypoint',
    type: 'string',
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    default: '',
    description: 'Override the image entrypoint as a comma-separated list',
    placeholder: '/bin/sh,-c',
  },
  {
    displayName: 'Hostname',
    name: 'containerHostname',
    type: 'string',
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    default: '',
    description: 'Container hostname',
    placeholder: 'my-host',
  },
  {
    displayName: 'Working Directory',
    name: 'containerWorkingDir',
    type: 'string',
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    default: '',
    description: 'Working directory inside the container',
    placeholder: '/app',
  },
  {
    displayName: 'User',
    name: 'containerUser',
    type: 'string',
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    default: '',
    description: 'User to run the container as',
    placeholder: '1000:1000',
  },
  {
    displayName: 'Auto Remove',
    name: 'containerAutoRemove',
    type: 'boolean',
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    default: false,
    description: 'Automatically remove the container when it exits',
  },
  {
    displayName: 'Privileged',
    name: 'containerPrivileged',
    type: 'boolean',
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    default: false,
    description: 'Give extended privileges to this container',
  },
  {
    displayName: 'Publish All Ports',
    name: 'containerPublishAllPorts',
    type: 'boolean',
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    default: false,
    description: 'Publish all exposed ports to random host ports',
  },
  {
    displayName: 'Network Mode',
    name: 'containerNetworkMode',
    type: 'string',
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    default: '',
    description: 'Container network mode',
    placeholder: 'bridge',
  },
  {
    displayName: 'Restart Policy',
    name: 'containerRestartPolicy',
    type: 'options',
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    options: [
      { name: 'None', value: '' },
      { name: 'No', value: 'no' },
      { name: 'Always', value: 'always' },
      { name: 'Unless Stopped', value: 'unless-stopped' },
      { name: 'On Failure', value: 'on-failure' },
    ],
    default: '',
    description: 'Restart behavior for the container',
  },
  {
    displayName: 'Restart Policy Max Retry Count',
    name: 'containerRestartPolicyMaxRetryCount',
    type: 'number',
    required: false,
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['create'],
      },
    },
    default: 0,
    description: 'Maximum restart attempts when using on-failure',
  },
];
