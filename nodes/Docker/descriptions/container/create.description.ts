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
      {
        displayName: 'CPU Limit (Cores)',
        name: 'cpus',
        type: 'number',
        default: 0,
        typeOptions: { minValue: 0, numberPrecision: 2 },
        description:
          'Maximum CPU cores the container may use, e.g. 1.5 for one and a half cores. Leave at 0 for unlimited. Equivalent to docker run --cpus.',
      },
      {
        displayName: 'CPU Shares',
        name: 'cpuShares',
        type: 'number',
        default: 0,
        typeOptions: { minValue: 0 },
        description:
          'Relative weight against other containers when CPU is contended (1024 is the default weight). This is a priority, not a ceiling — use CPU Limit for a hard cap.',
      },
      {
        displayName: 'Health Check',
        name: 'healthcheck',
        type: 'fixedCollection',
        default: {},
        description:
          'Defines how Docker decides the container is healthy. Without one, Wait For State cannot wait on “healthy”, because there is nothing to report a health status.',
        options: [
          {
            displayName: 'Check',
            name: 'check',
            values: [
              {
                displayName: 'Test Command',
                name: 'test',
                type: 'string',
                default: '',
                required: true,
                placeholder: 'curl -f http://localhost:8080/health || exit 1',
                description:
                  'Command run inside the container. Exit code 0 means healthy. Runs via a shell.',
              },
              {
                displayName: 'Interval (Seconds)',
                name: 'intervalSeconds',
                type: 'number',
                default: 30,
                typeOptions: { minValue: 1 },
                description: 'How often to run the check',
              },
              {
                displayName: 'Timeout (Seconds)',
                name: 'timeoutSeconds',
                type: 'number',
                default: 30,
                typeOptions: { minValue: 1 },
                description: 'How long a single check may take before it counts as a failure',
              },
              {
                displayName: 'Retries',
                name: 'retries',
                type: 'number',
                default: 3,
                typeOptions: { minValue: 1 },
                description: 'Consecutive failures before the container is considered unhealthy',
              },
              {
                displayName: 'Start Period (Seconds)',
                name: 'startPeriodSeconds',
                type: 'number',
                default: 0,
                typeOptions: { minValue: 0 },
                description:
                  'Grace period after start during which failures do not count against Retries. Use it for containers that take a while to come up.',
              },
            ],
          },
        ],
      },
      {
        displayName: 'Extra Hosts',
        name: 'extraHosts',
        type: 'string',
        default: '',
        placeholder: 'host.docker.internal:host-gateway, db:10.0.0.5',
        description:
          'Comma-separated hostname:IP entries added to the container’s /etc/hosts. Equivalent to docker run --add-host.',
      },
      {
        displayName: 'DNS Servers',
        name: 'dns',
        type: 'string',
        default: '',
        placeholder: '1.1.1.1, 8.8.8.8',
        description: 'Comma-separated DNS servers for the container',
      },
      {
        displayName: 'Add Capabilities',
        name: 'capAdd',
        type: 'string',
        default: '',
        placeholder: 'NET_ADMIN, SYS_PTRACE',
        description:
          'Comma-separated Linux capabilities to grant. Prefer these over Privileged, which grants everything.',
      },
      {
        displayName: 'Drop Capabilities',
        name: 'capDrop',
        type: 'string',
        default: '',
        placeholder: 'ALL, NET_RAW',
        description: 'Comma-separated Linux capabilities to remove',
      },
      {
        displayName: 'Privileged',
        name: 'privileged',
        type: 'boolean',
        default: false,
        description:
          'Whether to give the container full access to the host. This effectively removes isolation — prefer Add Capabilities for a specific need.',
      },
      {
        displayName: 'Devices',
        name: 'devices',
        type: 'string',
        default: '',
        placeholder: '/dev/ttyUSB0, /dev/dri:/dev/dri',
        description:
          'Comma-separated host devices to expose, as hostPath or hostPath:containerPath. Equivalent to docker run --device.',
      },
      {
        displayName: 'Shared Memory (MB)',
        name: 'shmSizeMB',
        type: 'number',
        default: 0,
        typeOptions: { minValue: 0 },
        description:
          'Size of /dev/shm. Leave at 0 for Docker’s 64 MB default. Browsers and some databases need considerably more and crash without saying why.',
      },
      {
        displayName: 'Tmpfs Mounts',
        name: 'tmpfs',
        type: 'string',
        default: '',
        placeholder: '/tmp, /run:size=64m',
        description:
          'Comma-separated in-memory mount paths, optionally as path:options. Contents are lost when the container stops.',
      },
      {
        displayName: 'Run Init Process',
        name: 'init',
        type: 'boolean',
        default: false,
        description:
          'Whether to run an init process as PID 1 to reap zombie processes and forward signals. Useful when the main process does not handle either.',
      },
    ],
  },
];
