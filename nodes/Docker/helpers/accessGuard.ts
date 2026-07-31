import { ICredentialDataDecryptedObject } from 'n8n-workflow';

/**
 * Operations a Read Only credential is permitted to run.
 *
 * This is deliberately an ALLOWLIST rather than a list of blocked write
 * operations. v0.1.1 used a blocklist, which fails open: every operation added
 * without remembering to update the list would silently become available to
 * read-only credentials. Given that this guard is the boundary between "can look
 * at Docker" and "can control the host", it has to fail closed instead. Forgetting
 * to classify a new read operation produces a clear error; forgetting to classify
 * a new write operation must never grant access.
 */
const READ_ONLY_OPERATIONS = new Set<string>([
  // container
  'list',
  'inspect',
  'getLogs',
  'stats',
  'top',
  'changes',
  'waitForState',
  'copyFrom',
  'export',
  // image
  'listImages',
  'inspectImage',
  'history',
  'search',
  'saveImage',
  // network
  'listNetworks',
  'inspectNetwork',
  // volume
  'listVolumes',
  'inspectVolume',
  // system
  'info',
  'version',
  'ping',
  'diskUsage',
  'events',
]);

/** HTTP methods that only read state, used to classify a Custom API Call. */
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface AccessContext {
  /** For the Custom API Call operation, which cannot be classified by name alone. */
  httpMethod?: string;
}

export function enforceAccessMode(
  credentials: ICredentialDataDecryptedObject,
  operation: string,
  context: AccessContext = {},
): void {
  const accessMode = credentials.accessMode as string;
  if (accessMode !== 'readonly') return;

  // A Custom API Call can be either, so classify it by the method the user chose.
  if (operation === 'customApiCall') {
    const method = (context.httpMethod ?? 'GET').toUpperCase();
    if (READ_ONLY_METHODS.has(method)) return;
    throw new Error(
      `A Custom API Call using ${method} can modify Docker and requires Full Control access. ` +
        `This credential is configured as Read Only. ` +
        `Update your Docker API credential to enable write operations.`,
    );
  }

  if (READ_ONLY_OPERATIONS.has(operation)) return;

  throw new Error(
    `Operation "${operation}" requires Full Control access. ` +
      `This credential is configured as Read Only. ` +
      `Update your Docker API credential to enable write operations.`,
  );
}

/** Exposed so tests can assert every shipped operation is classified. */
export const readOnlyOperations = READ_ONLY_OPERATIONS;
