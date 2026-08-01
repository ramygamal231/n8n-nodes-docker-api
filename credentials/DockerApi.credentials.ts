import {
  ICredentialType,
  INodeProperties,
  Icon,
} from 'n8n-workflow';

/**
 * The Unix socket path is meaningless on Windows, where Docker Desktop exposes a
 * named pipe instead. Resolved from the host n8n is running on so the default is
 * correct out of the box rather than a guaranteed connection error.
 */
const defaultSocketPath =
  process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock';

export class DockerApi implements ICredentialType {
  name = 'dockerApi';
  displayName = 'Docker API';
  documentationUrl = 'https://github.com/ramygamal231/n8n-nodes-docker-api';
  icon: Icon = { light: 'file:docker.svg', dark: 'file:docker.svg' };

  properties: INodeProperties[] = [
    {
      displayName: 'Connection Mode',
      name: 'authMode',
      type: 'options',
      options: [
        {
          name: 'Unix Socket / Named Pipe (Local)',
          value: 'socket',
          description: 'Connect to a Docker daemon on the same machine as n8n',
        },
        {
          name: 'TCP (Remote, Unencrypted)',
          value: 'tcp',
          description: 'Connect to a remote Docker daemon over plain HTTP',
        },
        {
          name: 'TLS (Remote, Secure)',
          value: 'tls',
          description: 'Connect to a remote Docker daemon with TLS client certificates',
        },
        {
          name: 'Portainer',
          value: 'portainer',
          description: 'Connect through an existing Portainer instance, which proxies the Docker API',
        },
      ],
      default: 'socket',
    },

    // --- Socket mode -------------------------------------------------------
    {
      displayName: 'Socket Path',
      name: 'socketPath',
      type: 'string',
      default: defaultSocketPath,
      required: true,
      displayOptions: { show: { authMode: ['socket'] } },
      description:
        'Path to the Docker socket. On Linux and macOS this is normally /var/run/docker.sock. On Windows, Docker Desktop uses the named pipe //./pipe/docker_engine.',
    },

    // --- TCP mode ----------------------------------------------------------
    {
      displayName: 'Host',
      name: 'host',
      type: 'string',
      default: '',
      required: true,
      placeholder: '192.168.1.100',
      displayOptions: { show: { authMode: ['tcp', 'tls'] } },
      description: 'IP address or hostname of the Docker host',
    },
    {
      displayName: 'Port',
      name: 'port',
      type: 'number',
      default: 2375,
      required: true,
      displayOptions: { show: { authMode: ['tcp'] } },
      description: 'Docker daemon TCP port. The conventional unencrypted port is 2375.',
    },
    {
      displayName: 'Unencrypted Connection Warning',
      name: 'tcpNotice',
      type: 'notice',
      default: '',
      displayOptions: { show: { authMode: ['tcp'] } },
      description:
        '⚠️ TCP mode sends Docker API traffic unencrypted and unauthenticated. Anyone who can reach this port has full control of the Docker host. Use it only on a trusted private network — prefer TLS mode otherwise.',
    },

    // --- TLS mode ----------------------------------------------------------
    {
      displayName: 'TLS Port',
      name: 'tlsPort',
      type: 'number',
      default: 2376,
      required: true,
      displayOptions: { show: { authMode: ['tls'] } },
      description: 'Docker daemon TLS port. The conventional encrypted port is 2376.',
    },
    {
      displayName: 'CA Certificate',
      name: 'ca',
      type: 'string',
      typeOptions: { rows: 4 },
      default: '',
      displayOptions: { show: { authMode: ['tls'] } },
      description:
        'PEM-encoded CA certificate used to verify the daemon. Leave empty if the daemon certificate is signed by a publicly trusted CA.',
    },
    {
      displayName: 'Client Certificate',
      name: 'cert',
      type: 'string',
      typeOptions: { rows: 4 },
      default: '',
      required: true,
      displayOptions: { show: { authMode: ['tls'] } },
      description: 'PEM-encoded client certificate (cert.pem)',
    },
    {
      displayName: 'Client Key',
      name: 'clientKey',
      type: 'string',
      typeOptions: { rows: 4, password: true },
      default: '',
      required: true,
      displayOptions: { show: { authMode: ['tls'] } },
      description: 'PEM-encoded client private key (key.pem)',
    },
    {
      displayName: 'Skip Certificate Verification',
      name: 'skipTlsVerify',
      type: 'boolean',
      default: false,
      displayOptions: { show: { authMode: ['tls'] } },
      description:
        'Whether to accept the daemon certificate without verifying it. Only enable for self-signed certificates on a trusted network; it removes protection against man-in-the-middle attacks.',
    },

    // --- Portainer mode ----------------------------------------------------
    {
      displayName: 'Portainer URL',
      name: 'portainerUrl',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'https://portainer.example.com',
      displayOptions: { show: { authMode: ['portainer'] } },
      description: 'Base URL of your Portainer instance, without a trailing path',
    },
    {
      displayName: 'Access Token',
      name: 'portainerAccessToken',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      displayOptions: { show: { authMode: ['portainer'] } },
      description:
        'Portainer API access token, created under My Account → Access Tokens. Sent as the X-API-Key header.',
    },
    {
      displayName: 'Environment ID',
      name: 'portainerEndpointId',
      type: 'number',
      default: 1,
      required: true,
      displayOptions: { show: { authMode: ['portainer'] } },
      description:
        'ID of the Portainer environment (endpoint) to control. Visible in the Portainer URL when you open an environment; the first local environment is usually 1.',
    },

    // --- Access control ----------------------------------------------------
    {
      displayName: 'Access Mode',
      name: 'accessMode',
      type: 'options',
      options: [
        {
          name: 'Read Only',
          value: 'readonly',
          description: 'Only listing, inspection and log operations are permitted',
        },
        {
          name: 'Full Control',
          value: 'full',
          description: 'All operations, including creating, starting, stopping and removing',
        },
      ],
      default: 'readonly',
      description: 'Which operations this credential permits, enforced at run time',
    },
    {
      displayName: 'Security Notice',
      name: 'securityNotice',
      type: 'notice',
      default: '',
      description:
        '⚠️ This credential controls the Docker daemon, which is equivalent to root access on the host. Use Read Only unless write access is genuinely required.',
    },
  ];
}
