import Docker from 'dockerode';
import { Readable } from 'stream';
import { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { translateDockerError } from '../../helpers/errorHandler';
import { resolveTarget } from '../../helpers/containerTarget';
import { extractTar, fileEntries, packTar } from '../../helpers/tarUtils';

/**
 * File transfer in and out of containers.
 *
 * Docker's copy endpoints speak tar in both directions, even for a single file,
 * and the payload is genuinely binary. It therefore travels through n8n's binary
 * data system rather than a JSON field: decoding arbitrary bytes as UTF-8 text
 * destroys anything that is not valid UTF-8, irreversibly and silently. A real
 * tar of a compiled binary loses roughly a quarter of its bytes that way.
 *
 * `json` carries facts about the transfer; `binary` carries the bytes.
 */
export async function copyFromContainer(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<INodeExecutionData> {
  try {
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;
    const remotePath = (this.getNodeParameter('remotePath', itemIndex) as string).trim();
    const outputProperty = (this.getNodeParameter(
      'binaryPropertyName',
      itemIndex,
      'data',
    ) as string).trim();
    const returnRawTar = this.getNodeParameter('returnRawTar', itemIndex, false) as boolean;

    if (remotePath === '') throw new Error('Container Path is required and cannot be empty.');

    const target = await resolveTarget(docker, containerId);
    const stream = (await target.container.getArchive({
      path: remotePath,
    })) as unknown as Readable;

    if (returnRawTar) {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      const tarBuffer = Buffer.concat(chunks);
      const fileName = `${remotePath.split('/').filter(Boolean).pop() || 'archive'}.tar`;

      return {
        json: {
          containerId: target.id,
          shortId: target.shortId,
          containerName: target.name,
          path: remotePath,
          fileName,
          sizeBytes: tarBuffer.length,
          format: 'tar',
        },
        binary: {
          [outputProperty]: await this.helpers.prepareBinaryData(
            tarBuffer,
            fileName,
            'application/x-tar',
          ),
        },
        pairedItem: itemIndex,
      };
    }

    const entries = fileEntries(await extractTar(stream));

    if (entries.length === 0) {
      throw new Error(
        `No files found at '${remotePath}' in container '${target.name}'. ` +
          `The path may be an empty directory, or may not exist.`,
      );
    }

    // A directory yields many files, which cannot be returned as one binary
    // property. Say so rather than silently handing back only the first.
    if (entries.length > 1) {
      throw new Error(
        `'${remotePath}' contains ${entries.length} files. A single binary output cannot ` +
          `represent a directory — enable "Return Raw Tar Archive" to get them all as one file.`,
      );
    }

    const file = entries[0];
    const fileName = file.name.split('/').filter(Boolean).pop() || 'file';

    return {
      json: {
        containerId: target.id,
        shortId: target.shortId,
        containerName: target.name,
        path: remotePath,
        fileName,
        sizeBytes: file.content.length,
        mode: file.mode,
        modifiedAt: file.mtime ? file.mtime.toISOString() : null,
        format: 'file',
      },
      binary: {
        [outputProperty]: await this.helpers.prepareBinaryData(file.content, fileName),
      },
      pairedItem: itemIndex,
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

export async function copyToContainer(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;
    const targetDir = (this.getNodeParameter('remotePath', itemIndex) as string).trim();
    const inputProperty = (this.getNodeParameter(
      'binaryPropertyName',
      itemIndex,
      'data',
    ) as string).trim();
    const overrideName = (this.getNodeParameter('targetFileName', itemIndex, '') as string).trim();

    if (targetDir === '') throw new Error('Container Path is required and cannot be empty.');

    // assertBinaryData throws a clear, n8n-worded error when the incoming item
    // has no such binary property, which beats a confusing failure later on.
    const binary = this.helpers.assertBinaryData(itemIndex, inputProperty);
    const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, inputProperty);

    const fileName = overrideName || binary.fileName || 'file';
    const target = await resolveTarget(docker, containerId);
    const tarBuffer = await packTar(fileName, buffer);

    await target.container.putArchive(Readable.from(tarBuffer), { path: targetDir });

    return {
      containerId: target.id,
      shortId: target.shortId,
      containerName: target.name,
      path: targetDir,
      fileName,
      destination: `${targetDir.replace(/\/+$/, '')}/${fileName}`,
      sizeBytes: buffer.length,
      mimeType: binary.mimeType ?? null,
      copied: true,
      copiedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}
