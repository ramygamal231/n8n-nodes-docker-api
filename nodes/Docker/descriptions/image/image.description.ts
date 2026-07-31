import { INodeProperties } from 'n8n-workflow';

const IMAGE = 'image';

/** Operations that act on one image by reference. */
const TARGETED = ['inspectImage', 'pullImage', 'pushImage', 'tagImage', 'removeImage', 'history'];

export const imageOperations: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: [IMAGE] } },
    options: [
      {
        name: 'List Images',
        value: 'listImages',
        description: 'List images with normalized output',
        action: 'List images',
      },
      {
        name: 'Inspect Image',
        value: 'inspectImage',
        description: 'Get full details of an image, including config and layers',
        action: 'Inspect image',
      },
      {
        name: 'Get Image History',
        value: 'history',
        description: 'List the layers an image is built from',
        action: 'Get image history',
      },
      {
        name: 'Search Images',
        value: 'search',
        description: 'Search Docker Hub for images',
        action: 'Search images',
      },
      {
        name: 'Pull Image',
        value: 'pullImage',
        description: 'Download an image from a registry, waiting for completion',
        action: 'Pull image',
      },
      {
        name: 'Push Image',
        value: 'pushImage',
        description: 'Upload an image to a registry, waiting for completion',
        action: 'Push image',
      },
      {
        name: 'Tag Image',
        value: 'tagImage',
        description: 'Add a new tag to an existing image',
        action: 'Tag image',
      },
      {
        name: 'Remove Image',
        value: 'removeImage',
        description: 'Delete an image from the local store',
        action: 'Remove image',
      },
      {
        name: 'Prune Images',
        value: 'pruneImages',
        description: 'Delete unused images, with a preview of what would go',
        action: 'Prune images',
      },
    ],
    default: 'listImages',
  },
];

export const imageFields: INodeProperties[] = [
  {
    displayName: 'Image',
    name: 'imageReference',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'alpine:latest',
    displayOptions: { show: { resource: [IMAGE], operation: TARGETED } },
    description:
      'Image reference. Accepts name, name:tag, a full registry path, or an image ID. Without a tag, "latest" is assumed.',
  },

  // --- list ---
  {
    displayName: 'Show All',
    name: 'showAllImages',
    type: 'boolean',
    default: false,
    displayOptions: { show: { resource: [IMAGE], operation: ['listImages'] } },
    description:
      'Whether to include intermediate layers. Off shows only top-level images, which is what docker images displays.',
  },
  {
    displayName: 'Include Labels',
    name: 'includeLabels',
    type: 'boolean',
    // Off by default, unlike containers. Container labels are usually small
    // Compose metadata, but image labels routinely carry vendor blurbs — one
    // common image ships ~4 KB of marketing HTML in a single label — which would
    // dominate the payload of every image listing.
    default: false,
    displayOptions: { show: { resource: [IMAGE], operation: ['listImages'] } },
    description:
      'Whether to include image labels. Off by default because image labels often contain large vendor descriptions.',
  },
  {
    displayName: 'Filters',
    name: 'imageFilters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    displayOptions: { show: { resource: [IMAGE], operation: ['listImages'] } },
    options: [
      {
        displayName: 'Reference',
        name: 'reference',
        type: 'string',
        default: '',
        placeholder: 'alpine',
        description: 'Only images with a tag containing this text (partial match)',
      },
      {
        displayName: 'Dangling Only',
        name: 'dangling',
        type: 'boolean',
        default: false,
        description: 'Whether to return only untagged images left behind by rebuilds',
      },
    ],
  },

  // --- search ---
  {
    displayName: 'Search Term',
    name: 'searchTerm',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'postgres',
    displayOptions: { show: { resource: [IMAGE], operation: ['search'] } },
    description: 'Text to search for on Docker Hub',
  },
  {
    displayName: 'Limit',
    name: 'searchLimit',
    type: 'number',
    default: 25,
    typeOptions: { minValue: 1, maxValue: 100 },
    displayOptions: { show: { resource: [IMAGE], operation: ['search'] } },
    description: 'Max number of results to return',
  },

  // --- tag ---
  {
    displayName: 'Target Repository',
    name: 'targetRepository',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'myregistry.local:5000/team/app',
    displayOptions: { show: { resource: [IMAGE], operation: ['tagImage'] } },
    description: 'Repository for the new tag, including registry host if pushing elsewhere',
  },
  {
    displayName: 'Target Tag',
    name: 'targetTag',
    type: 'string',
    default: 'latest',
    displayOptions: { show: { resource: [IMAGE], operation: ['tagImage'] } },
    description: 'Tag to apply, for example a version number',
  },

  // --- push ---
  {
    displayName: 'Tag to Push',
    name: 'pushTag',
    type: 'string',
    default: '',
    displayOptions: { show: { resource: [IMAGE], operation: ['pushImage'] } },
    description: 'Specific tag to push. Leave empty to push the tag in the image reference.',
  },

  // --- remove ---
  {
    displayName: 'Force',
    name: 'force',
    type: 'boolean',
    default: false,
    displayOptions: { show: { resource: [IMAGE], operation: ['removeImage'] } },
    description: 'Whether to remove the image even if it is tagged more than once or in use',
  },
  {
    displayName: 'Keep Parent Layers',
    name: 'noPrune',
    type: 'boolean',
    default: false,
    displayOptions: { show: { resource: [IMAGE], operation: ['removeImage'] } },
    description: 'Whether to keep untagged parent layers instead of deleting them too',
  },

  // --- prune ---
  {
    displayName: 'Dangling Only',
    name: 'danglingOnly',
    type: 'boolean',
    default: true,
    displayOptions: { show: { resource: [IMAGE], operation: ['pruneImages'] } },
    description:
      'Whether to remove only untagged images. Turn this off and Docker removes every image not used by a container, which is far more destructive.',
  },

  // --- registry auth, shared by pull and push ---
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: { show: { resource: [IMAGE], operation: ['pullImage', 'pushImage'] } },
    options: [
      {
        displayName: 'Registry Username',
        name: 'username',
        type: 'string',
        default: '',
        description: 'Username for a private registry. Leave empty for anonymous access.',
      },
      {
        displayName: 'Registry Password',
        name: 'password',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        description: 'Password or access token for a private registry',
      },
      {
        displayName: 'Registry Address',
        name: 'serveraddress',
        type: 'string',
        default: '',
        placeholder: 'https://index.docker.io/v1/',
        description: 'Registry the credentials belong to. Defaults to Docker Hub.',
      },
    ],
  },

  {
    displayName: 'Dry Run',
    name: 'dryRun',
    type: 'boolean',
    default: false,
    displayOptions: { show: { resource: [IMAGE], operation: ['removeImage', 'pruneImages'] } },
    description:
      'Whether to report what would be removed without removing it. Deleting images cannot be undone.',
  },
];
