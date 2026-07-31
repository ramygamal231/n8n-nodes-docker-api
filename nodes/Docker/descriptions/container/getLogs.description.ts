import { INodeProperties } from 'n8n-workflow';

// The "Container ID or Name" field is NOT declared here. It comes from the
// shared containerIdField() in lifecycle.description.ts, which covers every
// operation that targets one container. Declaring it in both places rendered the
// field twice in the panel — invisible to any test of behaviour, since the node
// reads the parameter once regardless.
export const getLogsContainerFields: INodeProperties[] = [
  {
    displayName: 'Tail (Lines)',
    name: 'tail',
    type: 'number',
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['getLogs'],
      },
    },
    default: 100,
    description: 'Number of lines from the end of the log to return. Use 0 for all lines.',
  },
  {
    displayName: 'Include Timestamps',
    name: 'timestamps',
    type: 'boolean',
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['getLogs'],
      },
    },
    default: false,
    description: 'Whether to prepend timestamps to each log line',
  },
  {
    displayName: 'Stream',
    name: 'stream',
    type: 'options',
    displayOptions: {
      show: {
        resource: ['container'],
        operation: ['getLogs'],
      },
    },
    options: [
      { name: 'Both (stdout + stderr)', value: 'both' },
      { name: 'stdout Only', value: 'stdout' },
      { name: 'stderr Only', value: 'stderr' },
    ],
    default: 'both',
    description: 'Which output stream(s) to include in the logs',
  },
];
