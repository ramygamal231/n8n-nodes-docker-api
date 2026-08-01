import { DockerApi as Docker } from '../../utils/dockerApi';
import { Readable } from 'stream';
import {
  IDataObject,
  INodeType,
  INodeTypeDescription,
  ITriggerFunctions,
  ITriggerResponse,
  NodeOperationError,
} from 'n8n-workflow';

import { createDockerClient } from '../../utils/dockerClient';
import { translateDockerError } from '../Docker/helpers/errorHandler';
import {
  buildEventFilters,
  createEventLineParser,
  isNewEvent,
  nextBackoffMs,
  normalizeEvent,
  RawEvent,
} from '../Docker/helpers/eventStream';

const INITIAL_BACKOFF_MS = 1_000;

export class DockerTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Docker Trigger',
    name: 'dockerTrigger',
    icon: 'file:docker.svg',
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["eventTypes"].join(", ")}}',
    description: 'Starts a workflow when something happens in Docker',
    defaults: { name: 'Docker Trigger' },
    inputs: [],
    outputs: ['main'],
    credentials: [{ name: 'dockerApi', required: true, testedBy: 'dockerApiTest' }],
    properties: [
      {
        displayName: 'Event Types',
        name: 'eventTypes',
        type: 'multiOptions',
        default: ['container'],
        required: true,
        options: [
          { name: 'Container', value: 'container' },
          { name: 'Image', value: 'image' },
          { name: 'Network', value: 'network' },
          { name: 'Volume', value: 'volume' },
          { name: 'Daemon', value: 'daemon' },
        ],
        description: 'Which kinds of object to watch',
      },
      {
        displayName: 'Actions',
        name: 'actions',
        type: 'multiOptions',
        default: [],
        options: [
          // container
          { name: 'Start', value: 'start' },
          { name: 'Stop', value: 'stop' },
          { name: 'Die (Exited)', value: 'die' },
          { name: 'Kill', value: 'kill' },
          { name: 'Out Of Memory', value: 'oom' },
          { name: 'Health Status Changed', value: 'health_status' },
          { name: 'Create', value: 'create' },
          { name: 'Destroy', value: 'destroy' },
          { name: 'Pause', value: 'pause' },
          { name: 'Unpause', value: 'unpause' },
          { name: 'Restart', value: 'restart' },
          { name: 'Rename', value: 'rename' },
          // image
          { name: 'Pull', value: 'pull' },
          { name: 'Push', value: 'push' },
          { name: 'Tag', value: 'tag' },
          { name: 'Untag', value: 'untag' },
          { name: 'Delete', value: 'delete' },
          // network / volume
          { name: 'Connect', value: 'connect' },
          { name: 'Disconnect', value: 'disconnect' },
          { name: 'Mount', value: 'mount' },
          { name: 'Unmount', value: 'unmount' },
        ],
        description:
          'Only fire for these actions. Leave empty for every action of the selected types.',
      },
      {
        displayName: 'Filters',
        name: 'filters',
        type: 'collection',
        placeholder: 'Add Filter',
        default: {},
        options: [
          {
            displayName: 'Container',
            name: 'container',
            type: 'string',
            default: '',
            description: 'Only events for this container, by name or ID',
          },
          {
            displayName: 'Image',
            name: 'image',
            type: 'string',
            default: '',
            description: 'Only events for containers created from this image',
          },
          {
            displayName: 'Label',
            name: 'label',
            type: 'string',
            default: '',
            placeholder: 'com.example.group=web',
            description: 'Only events for objects carrying this label',
          },
        ],
      },
      {
        displayName: 'Catch Up On Missed Events',
        name: 'catchUp',
        type: 'boolean',
        default: true,
        description:
          'Whether to replay events that occurred while this workflow was not listening, for example during an n8n restart. Turn off to only receive events from the moment the trigger starts.',
      },
      {
        displayName: 'Catch-Up Notice',
        name: 'catchUpNotice',
        type: 'notice',
        default: '',
        displayOptions: { show: { catchUp: [true] } },
        description:
          'After a restart, events missed while offline are delivered first. If the workflow was down for a long time this may be a burst.',
      },
    ],
  };

  async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
    const credentials = await this.getCredentials('dockerApi');
    const eventTypes = this.getNodeParameter('eventTypes', ['container']) as string[];
    const actions = this.getNodeParameter('actions', []) as string[];
    const filterSpec = this.getNodeParameter('filters', {}) as {
      container?: string;
      image?: string;
      label?: string;
    };
    const catchUp = this.getNodeParameter('catchUp', true) as boolean;

    let docker: Docker;
    try {
      docker = createDockerClient(credentials);
    } catch (error) {
      throw new NodeOperationError(this.getNode(), translateDockerError(error));
    }

    const filters = buildEventFilters({ eventTypes, actions, ...filterSpec });

    // Persisted with the workflow, so it survives an n8n restart. This is what
    // makes catch-up possible: without it, every restart silently loses whatever
    // happened while the workflow was down, and a trigger that quietly drops
    // events is worse than no trigger at all.
    const staticData = this.getWorkflowStaticData('node') as {
      /** Nanosecond precision, used to deduplicate the inclusive `since` boundary. */
      lastEventNano?: string;
      /** Whole seconds, which is what Docker's `since` parameter takes. */
      lastEventSec?: number;
    };

    let stream: Readable | undefined;
    let stopped = false;
    let backoff = INITIAL_BACKOFF_MS;
    let reconnectTimer: NodeJS.Timeout | undefined;
    let onFirstEvent: (() => void) | undefined;

    const emitEvents = (events: IDataObject[]) => {
      if (!events.length) return;
      this.emit([this.helpers.returnJsonArray(events)]);
      if (onFirstEvent) {
        const fn = onFirstEvent;
        onFirstEvent = undefined;
        fn();
      }
    };

    const connect = async (): Promise<void> => {
      if (stopped) return;

      // Docker's `since` takes whole seconds and is INCLUSIVE, so the last-seen
      // event is redelivered on reconnect; isNewEvent filters it back out below
      // using the nanosecond value, which is why both are tracked.
      const sinceSec =
        catchUp && staticData.lastEventSec
          ? staticData.lastEventSec
          : Math.floor(Date.now() / 1000);

      try {
        stream = (await docker.getEvents({
          since: sinceSec,
          filters: Object.keys(filters).length ? filters : undefined,
        } as never)) as unknown as Readable;
      } catch (error) {
        scheduleReconnect(translateDockerError(error));
        return;
      }

      // A successful connection resets the backoff, so a brief blip does not
      // leave the trigger waiting 30s after the daemon is already back.
      backoff = INITIAL_BACKOFF_MS;
      const parser = createEventLineParser();

      const consume = (raws: RawEvent[]) => {
        const fresh: IDataObject[] = [];
        for (const raw of raws) {
          const event = normalizeEvent(raw);
          if (!isNewEvent(event.timeNano, staticData.lastEventNano)) continue;
          staticData.lastEventNano = event.timeNano;
          const sec = Math.floor(new Date(event.time).getTime() / 1000);
          if (Number.isFinite(sec)) staticData.lastEventSec = sec;
          fresh.push(event as unknown as IDataObject);
        }
        emitEvents(fresh);
      };

      stream.on('data', (chunk: Buffer) => consume(parser.push(chunk)));
      stream.on('end', () => {
        consume(parser.flush());
        scheduleReconnect('the Docker event stream closed');
      });
      stream.on('error', (error: Error) => {
        scheduleReconnect(translateDockerError(error));
      });
    };

    /**
     * Docker's event stream is long-lived and dies for ordinary reasons: daemon
     * restarts, socket hiccups, a laptop sleeping. Reconnecting with backoff is
     * what separates a trigger you would page on from one that silently stops.
     */
    const scheduleReconnect = (reason: string) => {
      if (stopped) return;
      if (reconnectTimer) return;
      this.logger?.warn?.(
        `Docker Trigger: reconnecting in ${backoff}ms after ${reason}`,
      );
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        backoff = nextBackoffMs(backoff);
        void connect();
      }, backoff);
    };

    await connect();

    const closeFunction = async (): Promise<void> => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stream?.destroy();
    };

    /**
     * Used by "Test step" in the editor, where the user expects to see a real
     * event. It resolves as soon as one arrives rather than returning fake data,
     * so what is shown is genuinely what the workflow will receive.
     */
    const manualTriggerFunction = async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        onFirstEvent = resolve;
      });
    };

    return { closeFunction, manualTriggerFunction };
  }
}
