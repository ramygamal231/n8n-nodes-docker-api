import { INodeProperties } from 'n8n-workflow';

const C = 'container';
const I = 'image';
const S = 'system';

const kvOption = (name: string, displayName: string, placeholder: string) => ({
  displayName,
  name,
  type: 'fixedCollection' as const,
  typeOptions: { multipleValues: true },
  default: {},
  placeholder,
  options: [
    {
      name: 'entry',
      displayName: 'Entry',
      values: [
        { displayName: 'Name', name: 'name', type: 'string' as const, default: '' },
        { displayName: 'Value', name: 'value', type: 'string' as const, default: '' },
      ],
    },
  ],
});

// ------------------------------------------------------------- containers ---

export const containerGapFields: INodeProperties[] = [
  {
    displayName: 'Binary Property',
    name: 'binaryPropertyName',
    type: 'string',
    default: 'data',
    required: true,
    displayOptions: { show: { resource: [C], operation: ['export'] } },
    description: 'Name of the binary property to write the archive to',
  },
  {
    displayName: 'Container Path',
    name: 'remotePath',
    type: 'string',
    required: true,
    default: '',
    placeholder: '/etc/nginx/nginx.conf',
    displayOptions: { show: { resource: [C], operation: ['pathInfo'] } },
    description: 'The file or directory to report on',
  },
  {
    displayName: 'Update Fields',
    name: 'updateFields',
    type: 'collection',
    placeholder: 'Add Setting',
    default: {},
    displayOptions: { show: { resource: [C], operation: ['update'] } },
    description: 'Settings to change. Anything left out is untouched.',
    options: [
      {
        displayName: 'Memory Limit (MB)',
        name: 'memoryMB',
        type: 'number',
        default: 512,
        typeOptions: { minValue: 0 },
        description: 'Hard memory limit. Use 0 for unlimited.',
      },
      {
        displayName: 'CPU Shares',
        name: 'cpuShares',
        type: 'number',
        default: 1024,
        typeOptions: { minValue: 0 },
        description: 'Relative CPU weight against other containers. The default is 1024.',
      },
      {
        displayName: 'Restart Policy',
        name: 'restartPolicy',
        type: 'options',
        default: 'unless-stopped',
        options: [
          { name: 'No', value: 'no' },
          { name: 'On Failure', value: 'on-failure' },
          { name: 'Always', value: 'always' },
          { name: 'Unless Stopped', value: 'unless-stopped' },
        ],
      },
      {
        displayName: 'Max Retry Count',
        name: 'maxRetryCount',
        type: 'number',
        default: 3,
        typeOptions: { minValue: 0 },
        description: 'Only applies to the On Failure restart policy',
      },
    ],
  },
];

// ----------------------------------------------------------------- images ---

export const imageGapFields: INodeProperties[] = [
  // --- build ---
  {
    displayName: 'Build Context',
    name: 'contextSource',
    type: 'options',
    default: 'dockerfile',
    displayOptions: { show: { resource: [I], operation: ['buildImage'] } },
    options: [
      {
        name: 'Dockerfile Text',
        value: 'dockerfile',
        description: 'Write the Dockerfile here. Suitable unless the build needs to COPY files.',
      },
      {
        name: 'Tar Archive (Binary)',
        value: 'binary',
        description: 'Use a tar archive from the incoming item as the build directory',
      },
    ],
    description: 'Where the build directory comes from',
  },
  {
    displayName: 'Image Tag',
    name: 'imageTag',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'my-app:1.0.0',
    displayOptions: { show: { resource: [I], operation: ['buildImage'] } },
    description: 'Tag to give the built image',
  },
  {
    displayName: 'Dockerfile',
    name: 'dockerfile',
    type: 'string',
    typeOptions: { rows: 8 },
    default: 'FROM alpine:latest\nRUN echo "hello" > /hello.txt\nCMD ["cat", "/hello.txt"]',
    displayOptions: {
      show: { resource: [I], operation: ['buildImage'], contextSource: ['dockerfile'] },
    },
    description: 'Dockerfile contents. COPY and ADD of local files need a tar context instead.',
  },
  {
    displayName: 'Binary Property',
    name: 'binaryPropertyName',
    type: 'string',
    default: 'data',
    required: true,
    displayOptions: {
      show: { resource: [I], operation: ['buildImage'], contextSource: ['binary'] },
    },
    description: 'Incoming binary property holding the tar build context',
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: { show: { resource: [I], operation: ['buildImage'] } },
    options: [
      kvOption('buildArgs', 'Build Arguments', 'Add Build Arg'),
      kvOption('labels', 'Labels', 'Add Label'),
      {
        displayName: 'No Cache',
        name: 'noCache',
        type: 'boolean',
        default: false,
        description: 'Whether to rebuild every layer instead of reusing cached ones',
      },
      {
        displayName: 'Pull Base Image',
        name: 'pullBaseImage',
        type: 'boolean',
        default: false,
        description: 'Whether to always fetch a newer base image before building',
      },
      {
        displayName: 'Target Stage',
        name: 'target',
        type: 'string',
        default: '',
        description: 'Stop at this stage in a multi-stage build',
      },
    ],
  },

  // --- commit ---
  {
    displayName: 'Source Container',
    name: 'sourceContainer',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'my-container',
    displayOptions: { show: { resource: [I], operation: ['commit'] } },
    description: 'Container whose current state becomes the new image',
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: { show: { resource: [I], operation: ['commit'] } },
    options: [
      { displayName: 'Comment', name: 'comment', type: 'string', default: '', description: 'Message recorded with the image' },
      { displayName: 'Author', name: 'author', type: 'string', default: '', placeholder: 'Jane <jane@example.com>' },
      {
        displayName: 'Pause Container',
        name: 'pauseContainer',
        type: 'boolean',
        default: true,
        description:
          'Whether to pause the container while committing, so the filesystem does not change mid-snapshot',
      },
    ],
  },

  // --- save / load ---
  {
    displayName: 'Binary Property',
    name: 'binaryPropertyName',
    type: 'string',
    default: 'data',
    required: true,
    displayOptions: { show: { resource: [I], operation: ['saveImage', 'loadImage'] } },
    description:
      'For Save, the property to write the archive to. For Load, the property to read it from.',
  },
];

// ----------------------------------------------------------------- system ---

export const systemGapFields: INodeProperties[] = [
  {
    displayName: 'Username',
    name: 'registryUsername',
    type: 'string',
    default: '',
    displayOptions: { show: { resource: [S], operation: ['auth'] } },
    description: 'Registry username',
  },
  {
    displayName: 'Password',
    name: 'registryPassword',
    type: 'string',
    typeOptions: { password: true },
    default: '',
    displayOptions: { show: { resource: [S], operation: ['auth'] } },
    description: 'Registry password or access token',
  },
  {
    displayName: 'Registry Address',
    name: 'registryAddress',
    type: 'string',
    default: '',
    placeholder: 'https://index.docker.io/v1/',
    displayOptions: { show: { resource: [S], operation: ['auth'] } },
    description: 'Registry to authenticate against. Defaults to Docker Hub.',
  },
];
