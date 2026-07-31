import Docker from 'dockerode';
import { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import {
  connectNetwork,
  createNetwork,
  disconnectNetwork,
  inspectNetwork,
  listNetworks,
  pruneNetworks,
  removeNetwork,
} from './network.operation';
import {
  createVolume,
  inspectVolume,
  listVolumes,
  pruneVolumes,
  removeVolume,
} from './volume.operation';
import {
  systemDiskUsage,
  systemEvents,
  systemInfo,
  systemPing,
  systemVersion,
} from './system.operation';

type Single = (
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
) => Promise<IDataObject>;
type Multi = (
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
) => Promise<IDataObject[]>;

const MULTI: Record<string, Multi> = {
  listNetworks,
  listVolumes,
};

const SINGLE: Record<string, Single> = {
  inspectNetwork,
  createNetwork,
  removeNetwork,
  connectNetwork,
  disconnectNetwork,
  pruneNetworks,
  inspectVolume,
  createVolume,
  removeVolume,
  pruneVolumes,
  info: systemInfo,
  version: systemVersion,
  ping: systemPing,
  diskUsage: systemDiskUsage,
  events: systemEvents,
};

/** Network, volume and system share a dispatcher — none of them need per-item fan-out logic. */
export async function executeInfraOperation(
  this: IExecuteFunctions,
  docker: Docker,
  operation: string,
  itemIndex: number,
): Promise<INodeExecutionData[]> {
  const multi = MULTI[operation];
  if (multi) {
    const results = await multi.call(this, docker, itemIndex);
    return results.map((json) => ({ json, pairedItem: itemIndex }));
  }

  const single = SINGLE[operation];
  if (single) {
    const json = await single.call(this, docker, itemIndex);
    return [{ json, pairedItem: itemIndex }];
  }

  throw new Error(
    `Unknown operation: ${operation}. This is a bug in the node — please report it.`,
  );
}
