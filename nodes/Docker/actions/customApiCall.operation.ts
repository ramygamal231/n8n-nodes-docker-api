import Docker from 'dockerode';
import { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { translateDockerError } from '../helpers/errorHandler';

interface QueryEntry {
  entry?: Array<{ name: string; value: string }>;
}

const SUCCESS_CODES: Record<number, boolean> = {
  200: true,
  201: true,
  202: true,
  204: true,
  304: true,
};

/**
 * Raw, unnormalised access to any Docker Engine endpoint.
 *
 * Every other operation in this node exists to give a stable, predictable shape.
 * This one deliberately does not: it is the escape hatch for endpoints the node
 * does not cover, for a newer Docker API than this release knows about, or for
 * anything genuinely bespoke. The response is returned as Docker sent it.
 *
 * It goes through dockerode's modem rather than a fresh HTTP client, so it
 * inherits the configured transport — including Portainer's path prefix and auth
 * header — and works identically on socket, TCP, TLS and Portainer.
 */
export async function customApiCall(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  const method = (this.getNodeParameter('httpMethod', itemIndex, 'GET') as string).toUpperCase();
  const rawPath = (this.getNodeParameter('apiPath', itemIndex) as string).trim();
  const queryParams = this.getNodeParameter('queryParameters', itemIndex, {}) as QueryEntry;
  const bodyText = (this.getNodeParameter('requestBody', itemIndex, '') as string).trim();

  if (rawPath === '') throw new Error('API Path is required and cannot be empty.');

  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;

  if (path.includes('?')) {
    // docker-modem strips the final character of a path containing '?' when no
    // separate query object is supplied, silently mangling the request. Query
    // values belong in the Query Parameters field, which is also better UX.
    throw new Error(
      'Put query values in the Query Parameters field rather than in the path. ' +
        `Use '${path.split('?')[0]}' and add each parameter separately.`,
    );
  }

  const query: Record<string, string> = {};
  for (const { name, value } of queryParams.entry ?? []) {
    if (name) query[name] = value ?? '';
  }
  const hasQuery = Object.keys(query).length > 0;

  let body: unknown;
  if (bodyText !== '') {
    try {
      body = JSON.parse(bodyText);
    } catch (error) {
      throw new Error(
        `Request Body is not valid JSON: ${(error as Error).message}. ` +
          'Leave it empty for requests that take no body.',
      );
    }
  }

  const startedAt = Date.now();

  const response = await new Promise<unknown>((resolve, reject) => {
    docker.modem.dial(
      {
        // A trailing '?' is what docker-modem expects when a query object is
        // supplied; without one it appends nothing.
        path: hasQuery ? `${path}?` : path,
        method,
        options: hasQuery ? query : undefined,
        data: body,
        statusCodes: SUCCESS_CODES,
        // Never stream. Streaming endpoints such as /events or /containers/{id}/stats
        // would otherwise hold the workflow open forever; use the dedicated
        // operations or the Docker Trigger node for those.
        isStream: false,
      } as never,
      (err: Error | null, data: unknown) => (err ? reject(err) : resolve(data)),
    );
  }).catch((error) => {
    throw new Error(translateDockerError(error));
  });

  // Docker returns JSON for most endpoints, plain text for a few, and nothing
  // for 204s. All three are reported honestly rather than coerced into a shape.
  const isObject = typeof response === 'object' && response !== null;

  return {
    request: {
      method,
      path,
      query: hasQuery ? (query as IDataObject) : {},
      hadBody: body !== undefined,
    },
    response: isObject ? (response as IDataObject) : null,
    responseText: isObject ? null : (response === undefined ? null : String(response)),
    responseType: isObject ? (Array.isArray(response) ? 'array' : 'object') : typeof response,
    normalized: false,
    durationMs: Date.now() - startedAt,
    calledAt: new Date().toISOString(),
  };
}
