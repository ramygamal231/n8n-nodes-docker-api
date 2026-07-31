/**
 * Docker's multiplexed stream framing, shared by container logs and exec output.
 *
 * Without a TTY, stdout and stderr travel down one connection framed as:
 *   [stream type (1 byte)][0,0,0][payload size (4 bytes, big-endian)][payload]
 * Stream type: 1 = stdout, 2 = stderr.
 *
 * With a TTY there is only one stream, so Docker sends raw bytes with no framing
 * at all. Applying the framed parser to unframed output reads the first bytes of
 * text as a length field, computes an absurd size, and silently yields nothing —
 * the bug this project already shipped once in Get Container Logs. Callers must
 * therefore know which format they are about to receive: for logs that means
 * inspecting Config.Tty, and for exec it means whatever Tty was requested.
 */

export type StreamName = 'stdout' | 'stderr';

export interface DemuxedFrame {
  stream: StreamName;
  payload: Buffer;
}

/** Walks the framed format, yielding raw payload chunks in order. */
export function demuxFrames(buffer: Buffer): DemuxedFrame[] {
  const frames: DemuxedFrame[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break; // not enough bytes for a header
    const streamType = buffer[offset];
    const payloadSize = buffer.readUInt32BE(offset + 4);
    if (offset + 8 + payloadSize > buffer.length) break; // truncated payload

    frames.push({
      stream: streamType === 2 ? 'stderr' : 'stdout',
      payload: buffer.subarray(offset + 8, offset + 8 + payloadSize),
    });
    offset += 8 + payloadSize;
  }

  return frames;
}

/**
 * Splits framed output into two complete strings.
 *
 * Used by exec, where the caller wants the whole of stdout and stderr rather
 * than a line list. Payloads are concatenated before decoding so a multi-byte
 * UTF-8 character split across two frames is not corrupted — decoding each frame
 * separately would turn it into replacement characters.
 */
export function demuxToStreams(buffer: Buffer): { stdout: string; stderr: string } {
  const out: Buffer[] = [];
  const err: Buffer[] = [];

  for (const frame of demuxFrames(buffer)) {
    (frame.stream === 'stderr' ? err : out).push(frame.payload);
  }

  return {
    stdout: Buffer.concat(out).toString('utf8'),
    stderr: Buffer.concat(err).toString('utf8'),
  };
}

