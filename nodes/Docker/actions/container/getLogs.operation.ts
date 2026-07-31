import Docker from 'dockerode';
import { IExecuteFunctions } from 'n8n-workflow';

import { translateDockerError } from '../../helpers/errorHandler';
import { resolveContainer } from '../../helpers/resolveContainer';

export interface LogLine {
  message: string;
  stream: 'stdout' | 'stderr';
}

/**
 * Demultiplexes Docker's framed log format, used for containers WITHOUT a TTY.
 *
 * Without a TTY, stdout and stderr are separate pipes that Docker interleaves over
 * a single connection, framing each chunk with an 8-byte header:
 *   [stream type (1 byte)][0,0,0][size (4 bytes, big-endian)][payload]
 * Stream type: 1 = stdout, 2 = stderr
 *
 * Do NOT call this on a TTY container's output - see parseTtyLogs.
 */
export function demuxDockerLogs(buffer: Buffer): Array<{ message: string; stream: 'stdout' | 'stderr' }> {
  const logs: Array<{ message: string; stream: 'stdout' | 'stderr' }> = [];
  let offset = 0;

  while (offset < buffer.length) {
    // Need at least 8 bytes for header
    if (offset + 8 > buffer.length) {
      break;
    }

    const streamType = buffer[offset];
    // Bytes 1-4 are zeros
    // Bytes 5-8 are the payload size (big-endian uint32)
    const payloadSize = buffer.readUInt32BE(offset + 4);

    // Validate we have enough data for the payload
    if (offset + 8 + payloadSize > buffer.length) {
      break;
    }

    const payload = buffer.slice(offset + 8, offset + 8 + payloadSize);
    const message = payload.toString('utf8');

    // Split message into lines and add each line separately
    const lines = message.split('\n').filter((line) => line.length > 0);
    for (const line of lines) {
      logs.push({
        message: line,
        stream: streamType === 1 ? 'stdout' : 'stderr',
      });
    }

    offset += 8 + payloadSize;
  }

  return logs;
}

/**
 * Parses log output from a container running WITH a TTY.
 *
 * A TTY is a single terminal device, so stdout and stderr are already merged by the
 * time Docker sees them. There is nothing to demultiplex and Docker therefore sends
 * raw bytes with no framing header at all. Running demuxDockerLogs over this reads
 * the first text bytes as a length field, computes an absurd payload size, fails the
 * bounds check and silently returns zero lines.
 *
 * Terminal output uses CRLF line endings, so trailing \r is stripped. Stream origin
 * is unknowable here - Docker itself cannot tell them apart - so every line is
 * reported as 'stdout' by convention.
 */
export function parseTtyLogs(buffer: Buffer): LogLine[] {
  return buffer
    .toString('utf8')
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line.length > 0)
    .map((message) => ({ message, stream: 'stdout' as const }));
}

export async function getContainerLogs(
  this: IExecuteFunctions,
  docker: Docker,
  itemIndex: number,
): Promise<any> {
  try {
    const containerId = this.getNodeParameter('containerId', itemIndex) as string;
    const tail = this.getNodeParameter('tail', itemIndex, 100) as number;
    const timestamps = this.getNodeParameter('timestamps', itemIndex, false) as boolean;
    const stream = this.getNodeParameter('stream', itemIndex, 'both') as 'both' | 'stdout' | 'stderr';

    // Resolve name to ID first
    const resolved = await resolveContainer(docker, containerId);
    const container = docker.getContainer(resolved.id);

    // Docker uses two entirely different wire formats for logs depending on whether
    // the container has a TTY, and the only way to know which one you are about to
    // receive is to ask. Costs one extra API call; without it, TTY containers
    // silently report zero log lines.
    const details = await container.inspect();
    const isTty = details.Config?.Tty === true;

    // With a TTY, all output arrives on the stdout channel regardless of which pipe
    // the process wrote to. Asking Docker for stderr-only would return an empty
    // buffer, so always request both and explain the limitation in the result.
    const logOptions = {
      stdout: isTty ? true : stream === 'both' || stream === 'stdout',
      stderr: isTty ? true : stream === 'both' || stream === 'stderr',
      tail: tail === 0 ? undefined : tail,
      follow: false as false,
      timestamps,
    };

    // Get logs as a Buffer (follow: false returns Buffer)
    const logsBuffer = await container.logs(logOptions);

    // Pick the parser that matches the format Docker actually sent
    const allLogs = isTty ? parseTtyLogs(logsBuffer) : demuxDockerLogs(logsBuffer);

    // Filter by stream selection. Only meaningful without a TTY - with one, Docker
    // has already merged the streams and every line is labelled 'stdout', so
    // filtering would drop everything and reproduce the silent-empty bug we just
    // fixed. Return the full output and say why instead.
    let logs: LogLine[] = allLogs;

    if (!isTty && stream === 'stdout') {
      logs = allLogs.filter((log) => log.stream === 'stdout');
    } else if (!isTty && stream === 'stderr') {
      logs = allLogs.filter((log) => log.stream === 'stderr');
    }

    const result: Record<string, unknown> = {
      containerId: resolved.id,
      shortId: resolved.id.substring(0, 12),
      containerName: resolved.name,
      logs,
      lineCount: logs.length,
      stream,
      tty: isTty,
      retrievedAt: new Date().toISOString(),
    };

    if (isTty && stream !== 'both') {
      result.warning =
        `Container '${resolved.name}' runs with a TTY, so Docker merges stdout and stderr ` +
        `into a single stream. Filtering by '${stream}' is not possible; all output is ` +
        `returned and reported as 'stdout'.`;
    }

    return result;
  } catch (error) {
    throw new Error(translateDockerError(error));
  }
}
