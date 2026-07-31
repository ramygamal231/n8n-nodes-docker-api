import {
  demuxDockerLogs,
  parseTtyLogs,
} from '../../nodes/Docker/actions/container/getLogs.operation';

/** Builds a Docker multiplexed frame: [type][0,0,0][size BE32][payload] */
function frame(streamType: 1 | 2, text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header[0] = streamType;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

describe('demuxDockerLogs (containers WITHOUT a TTY)', () => {
  it('parses a single stdout frame', () => {
    const buf = frame(1, 'stdout line 1\n');
    expect(demuxDockerLogs(buf)).toEqual([{ message: 'stdout line 1', stream: 'stdout' }]);
  });

  it('separates interleaved stdout and stderr frames', () => {
    const buf = Buffer.concat([
      frame(1, 'out A\n'),
      frame(2, 'err A\n'),
      frame(1, 'out B\n'),
    ]);
    expect(demuxDockerLogs(buf)).toEqual([
      { message: 'out A', stream: 'stdout' },
      { message: 'err A', stream: 'stderr' },
      { message: 'out B', stream: 'stdout' },
    ]);
  });

  it('splits a multi-line payload into separate entries', () => {
    const buf = frame(1, 'first\nsecond\nthird\n');
    expect(demuxDockerLogs(buf).map((l) => l.message)).toEqual(['first', 'second', 'third']);
  });

  it('stops cleanly on a genuinely truncated frame rather than throwing', () => {
    const good = frame(1, 'complete\n');
    const truncated = frame(1, 'this payload is cut short');
    const buf = Buffer.concat([good, truncated.slice(0, 12)]);
    expect(demuxDockerLogs(buf)).toEqual([{ message: 'complete', stream: 'stdout' }]);
  });

  it('returns an empty array for an empty buffer', () => {
    expect(demuxDockerLogs(Buffer.alloc(0))).toEqual([]);
  });
});

describe('parseTtyLogs (containers WITH a TTY)', () => {
  it('parses raw unframed CRLF terminal output', () => {
    const buf = Buffer.from('tty line 1\r\ntty line 2\r\n', 'utf8');
    expect(parseTtyLogs(buf)).toEqual([
      { message: 'tty line 1', stream: 'stdout' },
      { message: 'tty line 2', stream: 'stdout' },
    ]);
  });

  it('strips the trailing carriage return, not just the newline', () => {
    const [line] = parseTtyLogs(Buffer.from('has crlf\r\n', 'utf8'));
    expect(line.message).toBe('has crlf');
    expect(line.message).not.toContain('\r');
  });

  it('handles bare LF endings too', () => {
    expect(parseTtyLogs(Buffer.from('a\nb\n', 'utf8')).map((l) => l.message)).toEqual(['a', 'b']);
  });

  it('drops empty lines', () => {
    expect(parseTtyLogs(Buffer.from('a\r\n\r\nb\r\n', 'utf8')).map((l) => l.message)).toEqual(['a', 'b']);
  });

  it('preserves a line with no trailing newline', () => {
    expect(parseTtyLogs(Buffer.from('no trailing newline', 'utf8'))).toEqual([
      { message: 'no trailing newline', stream: 'stdout' },
    ]);
  });
});

describe('regression: the TTY silent-empty bug', () => {
  // Exact bytes captured from a live `docker run -dt alpine` container.
  // demuxDockerLogs reads 't' as the stream type and the ASCII of "line" as a
  // big-endian length (1,818,848,869), fails its bounds check, and returns [].
  const realTtyBytes = Buffer.from('tty line 2738\r\ntty line 2739\r\n', 'utf8');

  it('demux misreads TTY output as a ~1.8GB frame and yields nothing', () => {
    expect(realTtyBytes.readUInt32BE(4)).toBe(1818848869);
    expect(demuxDockerLogs(realTtyBytes)).toEqual([]);
  });

  it('parseTtyLogs recovers every line from those same bytes', () => {
    expect(parseTtyLogs(realTtyBytes).map((l) => l.message)).toEqual([
      'tty line 2738',
      'tty line 2739',
    ]);
  });
});
