import { INodeProperties } from 'n8n-workflow';

const CUSTOM = 'custom';

export const customApiOperations: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: [CUSTOM] } },
    options: [
      {
        name: 'Custom API Call',
        value: 'customApiCall',
        description: 'Call any Docker Engine API endpoint directly',
        action: 'Make a custom API call',
      },
    ],
    default: 'customApiCall',
  },
];

export const customApiFields: INodeProperties[] = [
  {
    displayName: 'Escape Hatch Notice',
    name: 'customNotice',
    type: 'notice',
    default: '',
    displayOptions: { show: { resource: [CUSTOM] } },
    description:
      'This calls the Docker Engine API directly and returns the response exactly as Docker sent it — unnormalized, unlike every other operation in this node. Use it for endpoints this node does not cover yet. Streaming endpoints such as /events are not supported here; use the Docker Trigger node or Get Events instead.',
  },
  {
    displayName: 'Method',
    name: 'httpMethod',
    type: 'options',
    default: 'GET',
    displayOptions: { show: { resource: [CUSTOM] } },
    options: [
      { name: 'GET', value: 'GET' },
      { name: 'POST', value: 'POST' },
      { name: 'PUT', value: 'PUT' },
      { name: 'DELETE', value: 'DELETE' },
      { name: 'HEAD', value: 'HEAD' },
    ],
    description:
      'HTTP method. A Read Only credential permits GET and HEAD only; anything else needs Full Control.',
  },
  {
    displayName: 'API Path',
    name: 'apiPath',
    type: 'string',
    required: true,
    default: '',
    placeholder: '/containers/json',
    displayOptions: { show: { resource: [CUSTOM] } },
    description:
      'Endpoint path, without the API version prefix. Do not include a query string here — use Query Parameters below.',
  },
  {
    displayName: 'Query Parameters',
    name: 'queryParameters',
    type: 'fixedCollection',
    typeOptions: { multipleValues: true },
    default: {},
    placeholder: 'Add Parameter',
    displayOptions: { show: { resource: [CUSTOM] } },
    description: 'Query string values, added separately so they are encoded correctly',
    options: [
      {
        name: 'entry',
        displayName: 'Parameter',
        values: [
          { displayName: 'Name', name: 'name', type: 'string', default: '', placeholder: 'all' },
          { displayName: 'Value', name: 'value', type: 'string', default: '', placeholder: 'true' },
        ],
      },
    ],
  },
  {
    displayName: 'Request Body',
    name: 'requestBody',
    type: 'json',
    default: '',
    typeOptions: { rows: 5 },
    displayOptions: { show: { resource: [CUSTOM], operation: ['customApiCall'] } },
    description: 'JSON body for POST and PUT requests. Leave empty when the endpoint takes none.',
  },
];
