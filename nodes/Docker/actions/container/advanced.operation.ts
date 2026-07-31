import Docker from 'dockerode';
import { Readable } from 'stream';
import { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import { translateDockerError } from '../../helpers/errorHandler';
import { normalizeContainerInfo } from '../../helpers/normalizeContainer';
import { normalizeStats } from '../../helpers/normalizeStats';
import { dryRunResult, resolveTarget } from '../../helpers/containerTarget';
import { demuxToStreams } from '../../helpers/streamDemux';
import { sizeToMb } from '../../helpers/normalizePrimitives';
import { parseCommand } from './create.operation';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Collects a hijacked exec stream without depending on it ever closing.
 *
 * Over a Unix socket the stream ends when the command finishes. Through
 * Portainer's Docker proxy it does NOT — the exec runs, output arrives, and the
 * connection is simply held open, so waiting for 'end' hangs the workflow
 * indefinitely. Verified against a live Portainer 2.39.5.
 *
 * Completion is therefore decided by the exec itself: poll until Docker reports
 * it is no longer running, allow a short drain for the last bytes, then stop.
 * The stream's own 'end' still short-circuits this on transports where it works.
 */
async function collectExecOutput(
  stream: Readable,
  exec: Docker.Exec,
  timeoutMs: number,
): Promise<{ buffer: Buffer; timedOut: boolean; streamClosed: boolean }> {
  const chunks: Buffer[] = [];
  let ended = false;
  let failed: Error | null = null;

  stream.on('data', (c: Buffer) => chunks.push(c));
  stream.on('end', () => (ended = true));
  stream.on('error', (e: Error) => (failed = e));

  const deadline = Date.now() + timeoutMs;
  let finished = false;

  while (!ended && Date.now() < deadline) {
    if (failed) break;
    const info = await exec.inspect().catch(() => null);
    if (info && info.Running === false) {
      finished = true;
      // The last frames can still be in flight when Running flips to false.
      await sleep(150);
      break;
    }
    await sleep(120);
  }

  stream.destroy();
  if (failed) throw failed;

  return {
    buffer: Buffer.concat(chunks),
    timedOut: !ended && !finished,
    // Whether the stream closed on its own. A transport that never closes it is
    // also, in practice, one that may not deliver its contents at all — see the
    // caller, which turns "ran fine but produced nothing" into an explicit warning
    // rather than an empty string the user has to puzzle over.
    streamClosed: ended,
  };
}

// ---------------------------------------------------------------------------
// Execute Command
// ---------------------------------------------------------------------------

/**
 * Runs a command inside a container and returns its output and exit code.
 *
 * Docker's exec is genuinely three API calls — create the exec instance, start
 * it, then inspect it for the exit code — and its output arrives in the same
 * multiplexed framing as container logs. Exposing those three steps separately,
 * as the raw API does, turns "run one command" into a three-node workflow whose
 * output still needs hand-parsing. They are composed here instead.
 */
export async function executeCommand(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;
    const command = (this.getNodeParameter('command', itemIndex) as string).trim();
    const extra = this.getNodeParameter('additionalFields', itemIndex, {}) as {
      user?: string;
      workingDir?: string;
      useTty?: boolean;
      env?: { entry?: Array<{ name: string; value: string }> };
    };

    if (command === '') throw new Error('Command is required and cannot be empty.');

    const target = await resolveTarget(docker, containerId);
    const useTty = extra.useTty === true;
    const startedAt = Date.now();

    const exec = await target.container.exec({
      Cmd: parseCommand(command),
      AttachStdout: true,
      AttachStderr: true,
      // A TTY merges stdout and stderr into one stream (see the note below on
      // framing). Off by default so the two stay separable, which is what a
      // workflow usually wants.
      Tty: useTty,
      User: extra.user || undefined,
      WorkingDir: extra.workingDir || undefined,
      Env: (extra.env?.entry ?? [])
        .filter((e) => e.name)
        .map((e) => `${e.name}=${e.value ?? ''}`),
    });

    const timeoutSec = (this.getNodeParameter('execTimeout', itemIndex, 60) as number) || 60;
    const stream = (await exec.start({ hijack: true, stdin: false })) as unknown as Readable;
    const { buffer: raw, timedOut, streamClosed } = await collectExecOutput(
      stream,
      exec,
      Math.max(1, timeoutSec) * 1000,
    );

    // Exec output is ALWAYS framed, unlike container logs where a TTY removes the
    // framing entirely. Verified against a live daemon:
    //
    //   Tty: false -> frames of type 1 AND type 2, streams separate, LF endings
    //   Tty: true  -> frames of type 1 only, both streams merged, CRLF endings
    //
    // So it is always demuxed; with a TTY, stderr simply comes back empty because
    // Docker merged it into stdout before framing. Treating a TTY exec as
    // unframed leaks the 8-byte header straight into the output.
    const { stdout, stderr } = demuxToStreams(raw);
    const details = await exec.inspect();

    const result: IDataObject = {
      containerId: target.id,
      shortId: target.shortId,
      containerName: target.name,
      command,
      stdout,
      stderr,
      exitCode: details.ExitCode ?? null,
      success: (details.ExitCode ?? 1) === 0 && !timedOut,
      timedOut,
      outputCaptured: raw.length > 0,
      tty: useTty,
      durationMs: Date.now() - startedAt,
      executedAt: new Date().toISOString(),
    };

    // The command ran, but nothing came back AND the stream never closed. That
    // combination means the transport did not deliver the hijacked exec output —
    // observed with Portainer's Docker proxy, which runs the command correctly
    // and returns a valid exit code while forwarding none of the output.
    //
    // Returning an empty string here would be indistinguishable from a command
    // that genuinely printed nothing, so say which one it is.
    if (raw.length === 0 && !streamClosed && !timedOut) {
      result.warning =
        `The command ran (exit code ${details.ExitCode ?? 'unknown'}) but its output could not ` +
        `be read. The Docker API is being reached through a proxy that does not forward ` +
        `interactive exec streams — Portainer is known to behave this way. Use a direct socket, ` +
        `TCP or TLS connection to capture command output.`;
    }

    return result;
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

// ---------------------------------------------------------------------------
// Wait For State
// ---------------------------------------------------------------------------

type WaitTarget = 'running' | 'healthy' | 'exited';

/**
 * Blocks until a container reaches a state, or the timeout expires.
 *
 * Docker's own /wait endpoint only waits for a container to EXIT. Waiting for
 * "running" or, more usefully, "healthy" has no equivalent and otherwise has to
 * be built by hand in a workflow out of a loop, a Wait node and an IF. Health in
 * particular is what deploy-then-verify pipelines actually need.
 */
export async function waitForState(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;
    const targetState = this.getNodeParameter('targetState', itemIndex, 'running') as WaitTarget;
    const timeoutSec = this.getNodeParameter('waitTimeout', itemIndex, 60) as number;
    const pollMs = 1000;

    const target = await resolveTarget(docker, containerId);
    const startedAt = Date.now();
    const deadline = startedAt + Math.max(1, timeoutSec) * 1000;
    let polls = 0;
    let last = await target.container.inspect();

    // Waiting for health on an image without a HEALTHCHECK would spin until the
    // timeout and then report a misleading failure. Fail immediately and say why.
    if (targetState === 'healthy' && last.State?.Health === undefined) {
      throw new Error(
        `Container '${target.name}' has no health check, so it can never report as healthy. ` +
          `Add a HEALTHCHECK to the image, or wait for 'running' instead.`,
      );
    }

    const reached = (info: Docker.ContainerInspectInfo): boolean => {
      if (targetState === 'running') return info.State?.Running === true;
      if (targetState === 'exited') return info.State?.Status === 'exited';
      return info.State?.Health?.Status === 'healthy';
    };

    while (!reached(last) && Date.now() < deadline) {
      // A container that has already exited will never become running or healthy.
      if (targetState !== 'exited' && last.State?.Status === 'exited') {
        break;
      }
      await sleep(pollMs);
      polls++;
      last = await target.container.inspect();
    }

    const success = reached(last);
    return {
      ...normalizeContainerInfo(last),
      waitedFor: targetState,
      reached: success,
      timedOut: !success,
      health: last.State?.Health?.Status ?? null,
      exitCode: last.State?.ExitCode ?? null,
      polls,
      waitedMs: Date.now() - startedAt,
      message: success
        ? `Container '${target.name}' reached '${targetState}' after ${Math.round((Date.now() - startedAt) / 1000)}s.`
        : `Container '${target.name}' did not reach '${targetState}' within ${timeoutSec}s ` +
          `(last state: ${last.State?.Status ?? 'unknown'}` +
          `${last.State?.Health?.Status ? `, health: ${last.State.Health.Status}` : ''}).`,
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

// ---------------------------------------------------------------------------
// Run (ephemeral)
// ---------------------------------------------------------------------------

/**
 * Creates a container, runs it to completion, captures its output and removes it.
 *
 * The raw API makes this five separate calls, and a workflow that fails midway
 * leaks a container. Everything after creation is wrapped so the container is
 * cleaned up on any path, including timeout.
 */
export async function runContainer(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  const image = (this.getNodeParameter('image', itemIndex) as string).trim();
  const command = (this.getNodeParameter('command', itemIndex, '') as string).trim();
  const timeoutSec = this.getNodeParameter('runTimeout', itemIndex, 60) as number;
  const extra = this.getNodeParameter('additionalFields', itemIndex, {}) as {
    containerName?: string;
    user?: string;
    workingDir?: string;
    networkMode?: string;
    keepContainer?: boolean;
    env?: { entry?: Array<{ name: string; value: string }> };
  };

  const startedAt = Date.now();
  let container: Docker.Container | undefined;
  let timedOut = false;

  try {
    container = await docker.createContainer({
      Image: image,
      Cmd: command ? parseCommand(command) : undefined,
      User: extra.user || undefined,
      WorkingDir: extra.workingDir || undefined,
      Env: (extra.env?.entry ?? [])
        .filter((e) => e.name)
        .map((e) => `${e.name}=${e.value ?? ''}`),
      Tty: false,
      HostConfig: { NetworkMode: extra.networkMode || undefined },
      ...(extra.containerName ? { name: extra.containerName } : {}),
    } as Docker.ContainerCreateOptions);

    await container.start();

    // Race the container against the timeout. Docker's wait blocks indefinitely,
    // so without this a runaway command would hang the workflow.
    const waitPromise = container.wait();
    const result = await Promise.race([
      waitPromise.then((r) => ({ timedOut: false, statusCode: r.StatusCode as number })),
      sleep(Math.max(1, timeoutSec) * 1000).then(() => ({ timedOut: true, statusCode: -1 })),
    ]);
    timedOut = result.timedOut;

    if (timedOut) {
      // Stop it so logs can still be collected from a container that overran.
      await container.stop({ t: 0 }).catch(() => undefined);
    }

    const logBuffer = (await container.logs({
      stdout: true,
      stderr: true,
      follow: false,
    })) as unknown as Buffer;
    const { stdout, stderr } = demuxToStreams(logBuffer);

    return {
      image,
      command: command || null,
      containerId: container.id,
      shortId: container.id.substring(0, 12),
      exitCode: timedOut ? null : result.statusCode,
      success: !timedOut && result.statusCode === 0,
      timedOut,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
      removed: extra.keepContainer !== true,
      message: timedOut
        ? `Container did not finish within ${timeoutSec}s and was stopped. Output captured up to that point.`
        : `Container exited with code ${result.statusCode} after ${Date.now() - startedAt}ms.`,
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  } finally {
    // Runs on success, failure and timeout alike — an ephemeral container that
    // survives its workflow is a leak, and these accumulate silently.
    if (container && extra.keepContainer !== true) {
      await container.remove({ force: true }).catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function containerStats(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;
    const target = await resolveTarget(docker, containerId);

    // stream:false is essential — the default streams samples forever.
    const raw = (await target.container.stats({ stream: false })) as unknown as Record<
      string,
      unknown
    >;
    const stats = normalizeStats(raw);

    return {
      containerId: target.id,
      shortId: target.shortId,
      containerName: target.name,
      ...stats,
      sampledAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

// ---------------------------------------------------------------------------
// Prune containers
// ---------------------------------------------------------------------------

export async function pruneContainers(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<IDataObject> {
  try {
    const dryRun = this.getNodeParameter('dryRun', itemIndex, false) as boolean;

    if (dryRun) {
      // Docker prunes containers in the stopped/exited/created states.
      const all = await docker.listContainers({ all: true });
      const candidates = all
        .map((c) => normalizeContainerInfo(c))
        .filter((c) => ['exited', 'created', 'stopped', 'dead'].includes(c.status));

      return {
        dryRun: true,
        action: 'pruneContainers',
        executed: false,
        candidateCount: candidates.length,
        candidates: candidates.map((c) => ({
          shortId: c.shortId,
          name: c.name,
          image: c.image,
          status: c.status,
        })) as unknown as IDataObject[],
        exactList: true,
        message:
          `Dry run: ${candidates.length} stopped container(s) would be removed. ` +
          `Running and paused containers are never pruned.`,
      };
    }

    const result = (await docker.pruneContainers()) as unknown as {
      ContainersDeleted?: string[] | null;
      SpaceReclaimed?: number;
    };
    const deleted = result.ContainersDeleted ?? [];
    return {
      pruned: true,
      containersDeleted: deleted.length,
      ids: deleted,
      reclaimedMB: sizeToMb(result.SpaceReclaimed),
      prunedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}

/** Re-exported so the dispatcher can build a dry-run payload consistently. */
export { dryRunResult };
