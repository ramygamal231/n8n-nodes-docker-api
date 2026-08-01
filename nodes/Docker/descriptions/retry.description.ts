import { INodeProperties } from 'n8n-workflow';

/**
 * Shown for every resource and operation, because losing the daemon is not
 * specific to any of them.
 *
 * Deliberately NOT a list of error codes for the user to maintain. Which
 * failures are transient, and which of those are safe to repeat, depends on
 * whether the request reached the daemon and whether it changes anything — facts
 * this node knows per request and a user cannot reasonably be asked to encode.
 * Exposing the codes would look configurable while quietly making correctness
 * the user's problem.
 */
export const retryFields: INodeProperties[] = [
  {
    displayName: 'Connection Retry',
    name: 'retryPolicy',
    type: 'collection',
    placeholder: 'Add Setting',
    default: {},
    description:
      'How to handle the Docker daemon becoming briefly unreachable. Only failures that never reached the daemon are retried; anything Docker actually answered fails immediately.',
    options: [
      {
        displayName: 'Enabled',
        name: 'enabled',
        type: 'boolean',
        default: true,
        description:
          'Whether to retry a request that could not reach the Docker daemon. Retries happen per request, so items that already succeeded are never repeated.',
      },
      {
        displayName: 'Max Attempts',
        name: 'maxAttempts',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 10 },
        default: 3,
        description: 'Total attempts including the first. Set to 1 to disable retrying.',
      },
      {
        displayName: 'Initial Delay (Ms)',
        name: 'initialDelayMs',
        type: 'number',
        typeOptions: { minValue: 0, maxValue: 30000 },
        default: 500,
        description:
          'Delay before the first retry. Doubles each attempt, capped at 8 seconds.',
      },
    ],
  },
];
