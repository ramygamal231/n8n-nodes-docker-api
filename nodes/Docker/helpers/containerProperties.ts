import Docker from 'dockerode';

export function buildEnvList(envData: any): string[] {
  return (envData.envValues || [])
    .map((env: { name: string; value: string }) => {
      if (!env.name) return '';
      return `${env.name}=${env.value ?? ''}`;
    })
    .filter(Boolean);
}

export function buildLabelMap(labelData: any): Record<string, string> {
  const labels: Record<string, string> = {};

  for (const label of labelData.labelValues || []) {
    if (label.name) {
      labels[label.name] = label.value ?? '';
    }
  }

  return labels;
}

export function buildExposedPorts(portData: any): Record<string, {}> {
  const exposedPorts: Record<string, {}> = {};

  for (const port of portData.portValues || []) {
    if (port.containerPort === undefined || port.containerPort === null) {
      continue;
    }

    const protocolSuffix = port.protocol ? `/${port.protocol}` : '';
    exposedPorts[`${port.containerPort}${protocolSuffix}`] = {};
  }

  return exposedPorts;
}

export function buildPortBindings(portData: any): Record<string, Docker.PortBinding[]> {
  const bindings: Record<string, Docker.PortBinding[]> = {};

  for (const port of portData.portValues || []) {
    if (
      port.containerPort === undefined ||
      port.containerPort === null ||
      port.hostPort === undefined ||
      port.hostPort === null
    ) {
      continue;
    }

    const protocolSuffix = port.protocol ? `/${port.protocol}` : '';
    const key = `${port.containerPort}${protocolSuffix}`;

    bindings[key] = [
      {
        HostPort: String(port.hostPort),
        HostIp: port.hostIp || undefined,
      },
    ];
  }

  return bindings;
}

export function buildBinds(volumeData: any): string[] {
  return (volumeData.volumeValues || [])
    .map((volume: { hostPath: string; containerPath: string; readOnly?: boolean }) => {
      if (!volume.hostPath || !volume.containerPath) {
        return '';
      }

      return `${volume.hostPath}:${volume.containerPath}${volume.readOnly ? ':ro' : ''}`;
    })
    .filter(Boolean);
}
