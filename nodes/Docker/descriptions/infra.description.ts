import { INodeProperties } from 'n8n-workflow';

const NETWORK = 'network';
const VOLUME = 'volume';
const SYSTEM = 'system';

const kv = (resource: string, operations: string[]): INodeProperties => ({
  displayName: 'Labels',
  name: 'labels',
  type: 'fixedCollection',
  typeOptions: { multipleValues: true },
  default: {},
  placeholder: 'Add Label',
  displayOptions: { show: { resource: [resource], operation: operations } },
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
});

// ---------------------------------------------------------------- networks ---

export const networkOperations: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: [NETWORK] } },
    options: [
      { name: 'List Networks', value: 'listNetworks', description: 'List networks', action: 'List networks' },
      { name: 'Inspect Network', value: 'inspectNetwork', description: 'Get network details including attached containers', action: 'Inspect network' },
      { name: 'Create Network', value: 'createNetwork', description: 'Create a network', action: 'Create network' },
      { name: 'Connect Container', value: 'connectNetwork', description: 'Attach a container to a network', action: 'Connect container to network' },
      { name: 'Disconnect Container', value: 'disconnectNetwork', description: 'Detach a container from a network', action: 'Disconnect container from network' },
      { name: 'Remove Network', value: 'removeNetwork', description: 'Delete a network', action: 'Remove network' },
      { name: 'Prune Networks', value: 'pruneNetworks', description: 'Delete unused networks, with a preview', action: 'Prune networks' },
    ],
    default: 'listNetworks',
  },
];

export const networkFields: INodeProperties[] = [
  {
    displayName: 'Network ID or Name',
    name: 'networkId',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'my-network or abc123',
    displayOptions: {
      show: {
        resource: [NETWORK],
        operation: ['inspectNetwork', 'removeNetwork', 'connectNetwork', 'disconnectNetwork'],
      },
    },
    description: 'The network to act on, by name or ID',
  },
  {
    displayName: 'Network Name',
    name: 'networkName',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'my-network',
    displayOptions: { show: { resource: [NETWORK], operation: ['createNetwork'] } },
    description: 'Name for the new network',
  },
  {
    displayName: 'Container ID or Name',
    name: 'targetContainer',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: { resource: [NETWORK], operation: ['connectNetwork', 'disconnectNetwork'] },
    },
    description: 'The container to attach or detach',
  },
  {
    displayName: 'Network Alias',
    name: 'networkAlias',
    type: 'string',
    default: '',
    displayOptions: { show: { resource: [NETWORK], operation: ['connectNetwork'] } },
    description:
      'Extra DNS name the container answers to on this network. Other containers can reach it by this name.',
  },
  {
    displayName: 'Force',
    name: 'force',
    type: 'boolean',
    default: false,
    displayOptions: { show: { resource: [NETWORK], operation: ['disconnectNetwork'] } },
    description: 'Whether to detach even if the container is running',
  },
  {
    displayName: 'Include Labels',
    name: 'includeLabels',
    type: 'boolean',
    default: true,
    displayOptions: { show: { resource: [NETWORK], operation: ['listNetworks'] } },
    description: 'Whether to include network labels in the output',
  },
  {
    displayName: 'Filters',
    name: 'networkFilters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    displayOptions: { show: { resource: [NETWORK], operation: ['listNetworks'] } },
    options: [
      { displayName: 'Name', name: 'name', type: 'string', default: '', description: 'Partial name match' },
      {
        displayName: 'Driver',
        name: 'driver',
        type: 'options',
        default: 'bridge',
        options: [
          { name: 'Bridge', value: 'bridge' },
          { name: 'Host', value: 'host' },
          { name: 'Overlay', value: 'overlay' },
          { name: 'Macvlan', value: 'macvlan' },
          { name: 'None', value: 'none' },
        ],
      },
    ],
  },
  kv(NETWORK, ['createNetwork']),
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: { show: { resource: [NETWORK], operation: ['createNetwork'] } },
    options: [
      {
        displayName: 'Driver',
        name: 'driver',
        type: 'options',
        default: 'bridge',
        options: [
          { name: 'Bridge', value: 'bridge' },
          { name: 'Overlay', value: 'overlay' },
          { name: 'Macvlan', value: 'macvlan' },
          { name: 'IPvlan', value: 'ipvlan' },
        ],
        description: 'Network driver. Bridge is the normal choice on a single host.',
      },
      {
        displayName: 'Subnet',
        name: 'subnet',
        type: 'string',
        default: '',
        placeholder: '172.28.0.0/16',
        description: 'Fixed subnet in CIDR form. Leave empty to let Docker choose.',
      },
      {
        displayName: 'Gateway',
        name: 'gateway',
        type: 'string',
        default: '',
        placeholder: '172.28.0.1',
        description: 'Gateway address for the subnet',
      },
      {
        displayName: 'Internal',
        name: 'internal',
        type: 'boolean',
        default: false,
        description: 'Whether to block all external access from this network',
      },
      {
        displayName: 'Attachable',
        name: 'attachable',
        type: 'boolean',
        default: false,
        description: 'Whether standalone containers may attach to this network',
      },
      {
        displayName: 'Enable IPv6',
        name: 'enableIPv6',
        type: 'boolean',
        default: false,
        description: 'Whether to enable IPv6 addressing',
      },
    ],
  },
  {
    displayName: 'Dry Run',
    name: 'dryRun',
    type: 'boolean',
    default: false,
    displayOptions: { show: { resource: [NETWORK], operation: ['removeNetwork', 'pruneNetworks'] } },
    description: 'Whether to report what would be removed without removing it',
  },
];

// ----------------------------------------------------------------- volumes ---

export const volumeOperations: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: [VOLUME] } },
    options: [
      { name: 'List Volumes', value: 'listVolumes', description: 'List volumes', action: 'List volumes' },
      { name: 'Inspect Volume', value: 'inspectVolume', description: 'Get volume details', action: 'Inspect volume' },
      { name: 'Create Volume', value: 'createVolume', description: 'Create a volume', action: 'Create volume' },
      { name: 'Remove Volume', value: 'removeVolume', description: 'Delete a volume and its data', action: 'Remove volume' },
      { name: 'Prune Volumes', value: 'pruneVolumes', description: 'Delete unused volumes, with a preview', action: 'Prune volumes' },
    ],
    default: 'listVolumes',
  },
];

export const volumeFields: INodeProperties[] = [
  {
    displayName: 'Volume Name',
    name: 'volumeName',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'my-volume',
    displayOptions: {
      show: { resource: [VOLUME], operation: ['inspectVolume', 'createVolume', 'removeVolume'] },
    },
    description: 'The volume to act on, by name',
  },
  {
    displayName: 'Force',
    name: 'force',
    type: 'boolean',
    default: false,
    displayOptions: { show: { resource: [VOLUME], operation: ['removeVolume'] } },
    description: 'Whether to remove the volume even if it is still referenced',
  },
  {
    displayName: 'Include Labels',
    name: 'includeLabels',
    type: 'boolean',
    default: true,
    displayOptions: { show: { resource: [VOLUME], operation: ['listVolumes'] } },
    description: 'Whether to include volume labels in the output',
  },
  {
    displayName: 'Filters',
    name: 'volumeFilters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    displayOptions: { show: { resource: [VOLUME], operation: ['listVolumes'] } },
    options: [
      { displayName: 'Name', name: 'name', type: 'string', default: '', description: 'Partial name match' },
      {
        displayName: 'Unused Only',
        name: 'danglingOnly',
        type: 'boolean',
        default: false,
        description: 'Whether to return only volumes no container references',
      },
    ],
  },
  kv(VOLUME, ['createVolume']),
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: { show: { resource: [VOLUME], operation: ['createVolume'] } },
    options: [
      {
        displayName: 'Driver',
        name: 'driver',
        type: 'string',
        default: 'local',
        description: 'Volume driver. "local" unless a plugin provides another.',
      },
    ],
  },
  {
    displayName: 'Dry Run',
    name: 'dryRun',
    type: 'boolean',
    default: false,
    displayOptions: { show: { resource: [VOLUME], operation: ['removeVolume', 'pruneVolumes'] } },
    description:
      'Whether to report what would be removed without removing it. Volume data cannot be recovered afterwards.',
  },
];

// ------------------------------------------------------------------ system ---

export const systemOperations: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: [SYSTEM] } },
    options: [
      { name: 'Get Info', value: 'info', description: 'Host details, container and image counts, resources', action: 'Get system info' },
      { name: 'Get Version', value: 'version', description: 'Docker engine and API versions', action: 'Get version' },
      { name: 'Ping', value: 'ping', description: 'Check the daemon is reachable and measure latency', action: 'Ping daemon' },
      { name: 'Get Disk Usage', value: 'diskUsage', description: 'Space used by images, containers, volumes and build cache', action: 'Get disk usage' },
      { name: 'Get Events', value: 'events', description: 'Read Docker events over a bounded time window', action: 'Get events' },
    ],
    default: 'info',
  },
];

export const systemFields: INodeProperties[] = [
  {
    displayName: 'Look Back (Minutes)',
    name: 'sinceMinutes',
    type: 'number',
    default: 60,
    typeOptions: { minValue: 1 },
    displayOptions: { show: { resource: [SYSTEM], operation: ['events'] } },
    description:
      'How far back to read events from. The window always ends now, so this operation is guaranteed to return rather than stream indefinitely.',
  },
  {
    displayName: 'Filters',
    name: 'eventFilters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    displayOptions: { show: { resource: [SYSTEM], operation: ['events'] } },
    options: [
      {
        displayName: 'Type',
        name: 'type',
        type: 'options',
        default: 'container',
        options: [
          { name: 'Container', value: 'container' },
          { name: 'Image', value: 'image' },
          { name: 'Network', value: 'network' },
          { name: 'Volume', value: 'volume' },
          { name: 'Daemon', value: 'daemon' },
        ],
        description: 'Only events about this kind of object',
      },
      {
        displayName: 'Action',
        name: 'action',
        type: 'string',
        default: '',
        placeholder: 'start, die, pull',
        description: 'Only events with this action',
      },
      {
        displayName: 'Container',
        name: 'container',
        type: 'string',
        default: '',
        description: 'Only events about this container, by name or ID',
      },
    ],
  },
];
