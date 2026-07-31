import { INodeProperties } from 'n8n-workflow';

/**
 * Field builders shared across container operations.
 *
 * Nearly every container operation needs the same "Container ID or Name" field,
 * and destructive ones need the same Dry Run toggle. Declaring one field that is
 * shown for many operations keeps wording, placeholder and description identical
 * everywhere, and means a copy change happens in one place rather than thirteen.
 */

const CONTAINER = 'container';

export function containerIdField(operations: string[]): INodeProperties {
  return {
    displayName: 'Container ID or Name',
    name: 'containerId',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'my-container or abc123def456',
    displayOptions: { show: { resource: [CONTAINER], operation: operations } },
    description:
      'The container to act on. Accepts the container name, its full ID, or a unique ID prefix.',
  };
}

export function dryRunField(operations: string[]): INodeProperties {
  return {
    displayName: 'Dry Run',
    name: 'dryRun',
    type: 'boolean',
    default: false,
    displayOptions: { show: { resource: [CONTAINER], operation: operations } },
    description:
      'Whether to report what would happen without actually doing it. Nothing is changed when enabled.',
  };
}

export function timeoutField(operations: string[]): INodeProperties {
  return {
    displayName: 'Timeout (Seconds)',
    name: 'timeout',
    type: 'number',
    default: 10,
    typeOptions: { minValue: 0 },
    displayOptions: { show: { resource: [CONTAINER], operation: operations } },
    description:
      'How long to wait for the container to shut down gracefully before it is force-killed',
  };
}

/** Repeatable name/value pairs, used for environment variables and labels. */
export function keyValueField(
  name: string,
  displayName: string,
  operations: string[],
  description: string,
  placeholder: string,
): INodeProperties {
  return {
    displayName,
    name,
    type: 'fixedCollection',
    typeOptions: { multipleValues: true },
    default: {},
    placeholder,
    displayOptions: { show: { resource: [CONTAINER], operation: operations } },
    description,
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
  };
}

export function portMappingField(operations: string[]): INodeProperties {
  return {
    displayName: 'Port Mappings',
    name: 'portMappings',
    type: 'fixedCollection',
    typeOptions: { multipleValues: true },
    default: {},
    placeholder: 'Add Port Mapping',
    displayOptions: { show: { resource: [CONTAINER], operation: operations } },
    description: 'Ports to publish from the container to the host',
    options: [
      {
        name: 'mapping',
        displayName: 'Mapping',
        values: [
          {
            displayName: 'Container Port',
            name: 'containerPort',
            type: 'number',
            default: 80,
            description: 'Port inside the container',
          },
          {
            displayName: 'Host Port',
            name: 'hostPort',
            type: 'number',
            default: 8080,
            description: 'Port on the host. Use 0 to let Docker choose a free port.',
          },
          {
            displayName: 'Protocol',
            name: 'protocol',
            type: 'options',
            options: [
              { name: 'TCP', value: 'tcp' },
              { name: 'UDP', value: 'udp' },
            ],
            default: 'tcp',
          },
        ],
      },
    ],
  };
}

export function volumeMappingField(operations: string[]): INodeProperties {
  return {
    displayName: 'Volume Mappings',
    name: 'volumeMappings',
    type: 'fixedCollection',
    typeOptions: { multipleValues: true },
    default: {},
    placeholder: 'Add Volume Mapping',
    displayOptions: { show: { resource: [CONTAINER], operation: operations } },
    description: 'Host paths or named volumes to mount into the container',
    options: [
      {
        name: 'mapping',
        displayName: 'Mapping',
        values: [
          {
            displayName: 'Host Path or Volume Name',
            name: 'source',
            type: 'string',
            default: '',
            placeholder: '/srv/data or my-volume',
          },
          {
            displayName: 'Container Path',
            name: 'target',
            type: 'string',
            default: '',
            placeholder: '/data',
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
  };
}
