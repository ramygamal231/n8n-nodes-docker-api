import Docker from 'dockerode';
import { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import {
  imageHistory,
  inspectImage,
  listImages,
  searchImages,
} from './image/read.operation';
import { distributionInspect, pullImage, pushImage } from './image/registry.operation';
import { pruneImages, removeImage, tagImage } from './image/manage.operation';
import {
  buildImage,
  commitContainer,
  loadImage,
  pruneBuildCache,
  saveImage,
} from './image/build.operation';

/** Operations that emit many items rather than one. */
const MULTI: Record<
  string,
  (this: IExecuteFunctions, docker: Docker, itemIndex: number) => Promise<IDataObject[]>
> = {
  listImages,
  search: searchImages,
};

const SINGLE: Record<
  string,
  (this: IExecuteFunctions, docker: Docker, itemIndex: number) => Promise<IDataObject>
> = {
  inspectImage,
  history: imageHistory,
  pullImage,
  pushImage,
  distributionInspect,
  tagImage,
  removeImage,
  pruneImages,
  buildImage,
  commit: commitContainer,
  loadImage,
  pruneBuildCache,
};

export async function executeImageOperation(
  this: IExecuteFunctions,
  docker: Docker,
  operation: string,
  itemIndex: number,
): Promise<INodeExecutionData[]> {
  // saveImage returns binary rather than json.
  if (operation === 'saveImage') {
    return [await saveImage.call(this, docker, itemIndex)];
  }

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
    `Unknown image operation: ${operation}. This is a bug in the node — please report it.`,
  );
}
