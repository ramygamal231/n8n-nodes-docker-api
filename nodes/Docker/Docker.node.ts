import {
  ICredentialDataDecryptedObject,
  ICredentialsDecrypted,
  ICredentialTestFunctions,
  IExecuteFunctions,
  INodeCredentialTestResult,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
} from 'n8n-workflow';

import { createDockerClient } from '../../utils/dockerClient';
import { resolveRetryOptions } from '../../utils/connectionRetry';
import { containerOperations, containerFields } from './descriptions';
import { imageOperations, imageFields } from './descriptions/image/image.description';
import {
  networkOperations, networkFields,
  volumeOperations, volumeFields,
  systemOperations, systemFields,
} from './descriptions/infra.description';
import {
  customApiOperations,
  customApiFields,
} from './descriptions/customApiCall.description';
import { executeContainerOperation } from './actions';
import { executeImageOperation } from './actions/imageIndex';
import { retryFields } from './descriptions/retry.description';
import { executeInfraOperation } from './actions/infraIndex';
import { customApiCall } from './actions/customApiCall.operation';
import { enforceAccessMode } from './helpers/accessGuard';
import { translateDockerError } from './helpers/errorHandler';

export class Docker implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Docker API',
    name: 'docker',
    icon: 'file:docker.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Interact with Docker via direct API (no Portainer required)',
    defaults: {
      name: 'Docker API',
    },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'dockerApi',
        required: true,
        testedBy: 'dockerApiTest',
      },
    ],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Container',
            value: 'container',
          },
          {
            name: 'Image',
            value: 'image',
          },
          {
            name: 'Network',
            value: 'network',
          },
          {
            name: 'Volume',
            value: 'volume',
          },
          {
            name: 'System',
            value: 'system',
          },
          {
            name: 'Custom API Call',
            value: 'custom',
          },
        ],
        default: 'container',
      },
      ...containerOperations,
      ...containerFields,
      ...imageOperations,
      ...imageFields,
      ...networkOperations,
      ...networkFields,
      ...volumeOperations,
      ...volumeFields,
      ...systemOperations,
      ...systemFields,
      ...customApiOperations,
      ...customApiFields,
      // Last, because it applies to everything and is rarely changed.
      ...retryFields,
    ],
  };

  methods = {
    credentialTest: {
      /**
       * Backs the "Test Connection" button. Uses a method rather than a
       * declarative ICredentialTestRequest because socket mode talks to a Unix
       * socket or Windows named pipe, which n8n's HTTP-based declarative test
       * cannot reach.
       */
      async dockerApiTest(
        this: ICredentialTestFunctions,
        credential: ICredentialsDecrypted,
      ): Promise<INodeCredentialTestResult> {
        try {
          const docker = createDockerClient(
            credential.data as ICredentialDataDecryptedObject,
          );
          await docker.ping();
          const version = await docker.version();
          const mode = (credential.data as ICredentialDataDecryptedObject)?.authMode ?? 'socket';
          return {
            status: 'OK',
            message: `Connected to Docker ${version.Version} (API ${version.ApiVersion}) via ${mode}.`,
          };
        } catch (error) {
          return { status: 'Error', message: translateDockerError(error) };
        }
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const credentials = await this.getCredentials('dockerApi');
    const resource = this.getNodeParameter('resource', 0) as string;
    const operation = this.getNodeParameter('operation', 0) as string;

    // A Custom API Call cannot be classified by name — whether it writes depends
    // entirely on the HTTP method the user chose, so the guard is told which.
    enforceAccessMode(credentials, operation, {
      httpMethod:
        operation === 'customApiCall'
          ? (this.getNodeParameter('httpMethod', 0, 'GET') as string)
          : undefined,
    });

    // Read once for the node rather than per item: it configures the transport,
    // which every item shares.
    const retry = resolveRetryOptions(this.getNodeParameter('retryPolicy', 0, {}));
    const docker = createDockerClient(credentials, retry);
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const result =
          resource === 'custom'
            ? [{ json: await customApiCall.call(this, docker, i), pairedItem: i }]
            : resource === 'image'
            ? await executeImageOperation.call(this, docker, operation, i)
            : resource === 'network' || resource === 'volume' || resource === 'system'
              ? await executeInfraOperation.call(this, docker, operation, i)
              : await executeContainerOperation.call(this, docker, operation, i);
        returnData.push(...result);
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({ json: { error: (error as Error).message }, pairedItem: i });
          continue;
        }
        throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
      }
    }

    return [returnData];
  }
}
