import type Dockerode from 'dockerode';
import { DockerApi as Docker } from '../../../utils/dockerApi';
import { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { translateDockerError } from '../helpers/errorHandler';
import { normalizeNetwork } from '../helpers/normalizeNetwork';
import { sizeToMb } from '../helpers/normalizePrimitives';

interface KeyValueEntry {
  entry?: Array<{ name: string; value: string }>;
}

const pairsToObject = (raw: KeyValueEntry | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const { name, value } of raw?.entry ?? []) {
    if (name) out[name] = value ?? '';
  }
  return out;
};

export async function listNetworks(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject[]> {
  try {
    const includeLabels = this.getNodeParameter('includeLabels', itemIndex, true) as boolean;
    const filters = this.getNodeParameter('networkFilters', itemIndex, {}) as {
      name?: string;
      driver?: string;
    };

    const networks = (await docker.listNetworks()) as unknown as Array<Record<string, unknown>>;
    let normalized = networks.map((n) =>
      // The list endpoint never populates container membership.
      normalizeNetwork(n, { includeLabels, containersEnumerated: false }),
    );

    if (filters.name) {
      const needle = filters.name.toLowerCase();
      normalized = normalized.filter((n) => n.name.toLowerCase().includes(needle));
    }
    if (filters.driver) {
      normalized = normalized.filter((n) => n.driver === filters.driver);
    }

    return normalized as unknown as IDataObject[];
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function inspectNetwork(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const id = (this.getNodeParameter('networkId', itemIndex) as string).trim();
    const raw = (await docker.getNetwork(id).inspect()) as unknown as Record<string, unknown>;
    // Inspect is the only call that returns attached containers.
    return normalizeNetwork(raw, { containersEnumerated: true }) as unknown as IDataObject;
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function createNetwork(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const name = (this.getNodeParameter('networkName', itemIndex) as string).trim();
    if (name === '') throw new Error('Network Name is required and cannot be empty.');

    const labelPairs = this.getNodeParameter('labels', itemIndex, {}) as KeyValueEntry;
    const extra = this.getNodeParameter('additionalFields', itemIndex, {}) as {
      driver?: string;
      internal?: boolean;
      attachable?: boolean;
      enableIPv6?: boolean;
      subnet?: string;
      gateway?: string;
    };

    const labels = pairsToObject(labelPairs);
    const options: Dockerode.NetworkCreateOptions = {
      Name: name,
      Driver: extra.driver || 'bridge',
      Internal: extra.internal === true,
      Attachable: extra.attachable === true,
      EnableIPv6: extra.enableIPv6 === true,
      Labels: Object.keys(labels).length ? labels : undefined,
    };

    // IPAM is only sent when the user actually specified addressing, otherwise
    // Docker's automatic subnet allocation is overridden with an empty config.
    if (extra.subnet || extra.gateway) {
      (options as Dockerode.NetworkCreateOptions & { IPAM?: unknown }).IPAM = {
        Driver: 'default',
        Config: [
          {
            ...(extra.subnet ? { Subnet: extra.subnet } : {}),
            ...(extra.gateway ? { Gateway: extra.gateway } : {}),
          },
        ],
      };
    }

    const created = await docker.createNetwork(options);
    const raw = (await created.inspect()) as unknown as Record<string, unknown>;
    return {
      ...(normalizeNetwork(raw, { containersEnumerated: true }) as unknown as IDataObject),
      created: true,
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function removeNetwork(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const id = (this.getNodeParameter('networkId', itemIndex) as string).trim();
    const dryRun = this.getNodeParameter('dryRun', itemIndex, false) as boolean;

    const raw = (await docker.getNetwork(id).inspect()) as unknown as Record<string, unknown>;
    const net = normalizeNetwork(raw, { containersEnumerated: true });

    if (dryRun) {
      return {
        dryRun: true,
        action: 'removeNetwork',
        target: { id: net.id, shortId: net.shortId, name: net.name, driver: net.driver },
        executed: false,
        attachedContainers: net.containerCount,
        message:
          `Dry run: network '${net.name}' (${net.shortId}) would have been removed.` +
          (net.containerCount > 0
            ? ` ${net.containerCount} container(s) are still attached and would block removal.`
            : ''),
      };
    }

    await docker.getNetwork(net.id).remove();
    return {
      removed: true,
      id: net.id,
      shortId: net.shortId,
      name: net.name,
      removedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function connectNetwork(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const id = (this.getNodeParameter('networkId', itemIndex) as string).trim();
    const container = (this.getNodeParameter('targetContainer', itemIndex) as string).trim();
    const alias = (this.getNodeParameter('networkAlias', itemIndex, '') as string).trim();

    await docker.getNetwork(id).connect({
      Container: container,
      EndpointConfig: alias ? { Aliases: [alias] } : undefined,
    });

    const raw = (await docker.getNetwork(id).inspect()) as unknown as Record<string, unknown>;
    const net = normalizeNetwork(raw, { containersEnumerated: true });
    return {
      connected: true,
      network: { id: net.id, shortId: net.shortId, name: net.name },
      container,
      alias: alias || null,
      attachedContainers: net.containerCount,
      containers: net.containers as unknown as IDataObject[],
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function disconnectNetwork(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const id = (this.getNodeParameter('networkId', itemIndex) as string).trim();
    const container = (this.getNodeParameter('targetContainer', itemIndex) as string).trim();
    const force = this.getNodeParameter('force', itemIndex, false) as boolean;

    await docker.getNetwork(id).disconnect({ Container: container, Force: force });

    const raw = (await docker.getNetwork(id).inspect()) as unknown as Record<string, unknown>;
    const net = normalizeNetwork(raw, { containersEnumerated: true });
    return {
      disconnected: true,
      network: { id: net.id, shortId: net.shortId, name: net.name },
      container,
      forced: force,
      attachedContainers: net.containerCount,
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function pruneNetworks(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const dryRun = this.getNodeParameter('dryRun', itemIndex, false) as boolean;

    if (dryRun) {
      // Docker prunes any network with no attached containers, excluding the
      // three predefined ones it will never remove.
      const PREDEFINED = ['bridge', 'host', 'none'];
      const all = (await docker.listNetworks()) as unknown as Array<Record<string, unknown>>;
      const candidates: Array<{ name: string; shortId: string; driver: string }> = [];

      for (const entry of all) {
        const summary = normalizeNetwork(entry, { containersEnumerated: false });
        if (PREDEFINED.includes(summary.name)) continue;
        // Membership requires an inspect; the list call does not carry it.
        const raw = (await docker.getNetwork(summary.id).inspect()) as unknown as Record<
          string,
          unknown
        >;
        const detail = normalizeNetwork(raw, { containersEnumerated: true });
        if (detail.containerCount === 0) {
          candidates.push({
            name: detail.name,
            shortId: detail.shortId,
            driver: detail.driver,
          });
        }
      }

      return {
        dryRun: true,
        action: 'pruneNetworks',
        executed: false,
        candidateCount: candidates.length,
        candidates: candidates as unknown as IDataObject[],
        exactList: true,
        message:
          `Dry run: ${candidates.length} unused network(s) would be removed. ` +
          `The predefined bridge, host and none networks are never removed.`,
      };
    }

    const result = (await docker.pruneNetworks()) as unknown as {
      NetworksDeleted?: string[] | null;
    };
    const deleted = result.NetworksDeleted ?? [];
    return {
      pruned: true,
      networksDeleted: deleted.length,
      names: deleted,
      prunedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

/** Exported for tests. */
export const networkPruneSpaceMb = sizeToMb;
