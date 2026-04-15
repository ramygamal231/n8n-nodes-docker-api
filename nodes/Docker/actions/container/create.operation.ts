import Docker from 'dockerode'
import { IExecuteFunctions } from 'n8n-workflow';
import { translateDockerError } from '../../helpers/errorHandler';
import { normalizeContainerInfo } from '../../helpers/normalizeContainer';
import {
  buildBinds,
  buildEnvList,
  buildExposedPorts,
  buildLabelMap,
  buildPortBindings,
} from '../../helpers/containerProperties';

async function imageExistsLocally(docker: Docker, imageName: string): Promise<boolean> {
  try {
    await docker.getImage(imageName).inspect();
    return true;
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    if (message.includes('404') || message.toLowerCase().includes('no such image')) {
      return false;
    }
    throw error;
  }
}

async function pullImage(docker: Docker, imageName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    docker.pull(imageName, (err: any, stream: NodeJS.ReadableStream) => {
      if (err) {
        reject(err);
        return;
      }

      if (!stream) {
        reject(new Error(`Docker did not return a pull stream for image '${imageName}'.`));
        return;
      }

      docker.modem.followProgress(
        stream,
        (pullError) => {
          if (pullError) {
            reject(pullError);
            return;
          }
          resolve();
        },
        () => undefined
      );
    });
  });
}

export async function createContainer(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number
): Promise<any> {
  try {
    const containerName = this.getNodeParameter('containerName', itemIndex, '') as string;
    const containerImage = this.getNodeParameter('containerImage', itemIndex) as string;
    const pullIfMissing = this.getNodeParameter('pullIfMissing', itemIndex, true) as boolean;

    const envData = this.getNodeParameter('containerEnvs', itemIndex, {}) as any;
    const labelData = this.getNodeParameter('containerLabels', itemIndex, {}) as any;
    const portData = this.getNodeParameter('containerPorts', itemIndex, {}) as any;
    const volumeData = this.getNodeParameter('containerVolumes', itemIndex, {}) as any;

    const containerCmd = this.getNodeParameter('containerCmd', itemIndex, []) as string[];
    const entrypoint = this.getNodeParameter('containerEntrypoint', itemIndex, '') as string;
    const hostname = this.getNodeParameter('containerHostname', itemIndex, '') as string;
    const workingDir = this.getNodeParameter('containerWorkingDir', itemIndex, '') as string;
    const user = this.getNodeParameter('containerUser', itemIndex, '') as string;

    const autoRemove = this.getNodeParameter('containerAutoRemove', itemIndex, false) as boolean;
    const privileged = this.getNodeParameter('containerPrivileged', itemIndex, false) as boolean;
    const publishAllPorts = this.getNodeParameter(
      'containerPublishAllPorts',
      itemIndex,
      false
    ) as boolean;
    const networkMode = this.getNodeParameter('containerNetworkMode', itemIndex, '') as string;
    const restartPolicyName = this.getNodeParameter(
      'containerRestartPolicy',
      itemIndex,
      ''
    ) as string;
    const restartPolicyMaximumRetryCount = this.getNodeParameter(
      'containerRestartPolicyMaxRetryCount',
      itemIndex,
      0
    ) as number;

    if (pullIfMissing && !(await imageExistsLocally(docker, containerImage))) {
      await pullImage(docker, containerImage);
    }

    const container = await docker.createContainer({
      name: containerName || undefined,
      Image: containerImage,
      Env: buildEnvList(envData),
      Cmd: containerCmd.length > 0 ? containerCmd : undefined,
      Entrypoint: entrypoint
        ? entrypoint
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined,
      Hostname: hostname || undefined,
      WorkingDir: workingDir || undefined,
      User: user || undefined,
      Labels: buildLabelMap(labelData),
      ExposedPorts: buildExposedPorts(portData),
      HostConfig: {
        AutoRemove: autoRemove || undefined,
        Privileged: privileged || undefined,
        PublishAllPorts: publishAllPorts || undefined,
        NetworkMode: networkMode || undefined,
        Binds: buildBinds(volumeData),
        PortBindings: buildPortBindings(portData),
        RestartPolicy: restartPolicyName
          ? {
              Name: restartPolicyName as Docker.HostRestartPolicy['Name'],
              MaximumRetryCount: restartPolicyMaximumRetryCount || undefined,
            }
          : undefined,
      },
    });

    const containerInfo = await container.inspect();
    return normalizeContainerInfo(containerInfo);
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}