import { normalizeStats } from '../../nodes/Docker/helpers/normalizeStats';
import { demuxFrames, demuxToStreams } from '../../nodes/Docker/helpers/streamDemux';
import { extractTar, fileEntries, packTar } from '../../nodes/Docker/helpers/tarUtils';
import { Readable } from 'stream';

/** Builds a Docker multiplexed frame. */
function frame(streamType: 1 | 2, text: string | Buffer): Buffer {
  const payload = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header[0] = streamType;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

describe('demuxToStreams', () => {
  it('separates stdout and stderr into complete strings', () => {
    const buf = Buffer.concat([
      frame(1, 'out one\n'),
      frame(2, 'err one\n'),
      frame(1, 'out two\n'),
    ]);
    expect(demuxToStreams(buf)).toEqual({ stdout: 'out one\nout two\n', stderr: 'err one\n' });
  });

  it('preserves a multi-byte character split across two frames', () => {
    // "é" is 0xC3 0xA9. Decoding each frame separately would corrupt it into
    // replacement characters; concatenating before decoding does not.
    const euro = Buffer.from('é', 'utf8');
    const buf = Buffer.concat([
      frame(1, euro.subarray(0, 1)),
      frame(1, euro.subarray(1)),
    ]);
    expect(demuxToStreams(buf).stdout).toBe('é');
    expect(demuxToStreams(buf).stdout).not.toContain('�');
  });

  it('returns empty strings for an empty buffer', () => {
    expect(demuxToStreams(Buffer.alloc(0))).toEqual({ stdout: '', stderr: '' });
  });

  it('stops cleanly at a truncated frame', () => {
    const buf = Buffer.concat([frame(1, 'complete\n'), frame(1, 'cut').subarray(0, 6)]);
    expect(demuxToStreams(buf).stdout).toBe('complete\n');
  });

  it('treats unknown stream types as stdout', () => {
    expect(demuxFrames(frame(1, 'x'))[0].stream).toBe('stdout');
    expect(demuxFrames(frame(2, 'x'))[0].stream).toBe('stderr');
  });
});

describe('normalizeStats — CPU percentage derivation', () => {
  const sample = (over: Record<string, unknown> = {}) => ({
    cpu_stats: {
      cpu_usage: { total_usage: 2_000_000_000 },
      system_cpu_usage: 20_000_000_000,
      online_cpus: 4,
    },
    precpu_stats: {
      cpu_usage: { total_usage: 1_000_000_000 },
      system_cpu_usage: 10_000_000_000,
    },
    memory_stats: { usage: 209_715_200, limit: 2_147_483_648, stats: { inactive_file: 104_857_600 } },
    networks: { eth0: { rx_bytes: 1_048_576, tx_bytes: 2_097_152 } },
    blkio_stats: {
      io_service_bytes_recursive: [
        { op: 'read', value: 5_242_880 },
        { op: 'write', value: 1_048_576 },
      ],
    },
    pids_stats: { current: 7 },
    ...over,
  });

  it('applies (cpuDelta / systemDelta) * cpuCount * 100', () => {
    // 1e9 / 1e10 = 0.1, times 4 CPUs = 40%
    const s = normalizeStats(sample());
    expect(s.cpuPercent).toBe(40);
    expect(s.cpuCount).toBe(4);
    expect(s.cpuMeasurable).toBe(true);
  });

  it('subtracts page cache from memory usage', () => {
    // 200 MB reported, 100 MB of it page cache -> 100 MB actually used.
    const s = normalizeStats(sample());
    expect(s.memoryUsageMB).toBe(100);
    expect(s.memoryLimitMB).toBe(2048);
    expect(s.memoryPercent).toBeCloseTo(4.88, 1);
  });

  it('falls back to cgroup v1 "cache" when inactive_file is absent', () => {
    const s = normalizeStats(
      sample({
        memory_stats: { usage: 209_715_200, limit: 2_147_483_648, stats: { cache: 104_857_600 } },
      }),
    );
    expect(s.memoryUsageMB).toBe(100);
  });

  it('reports null rather than Infinity when there is no time between samples', () => {
    // Measured against a live daemon: a one-shot stats read DOES carry a
    // meaningful precpu_stats, because Docker takes two samples internally about
    // a second apart. So the normal path yields a genuine instantaneous figure.
    //
    // The degenerate case this guards is systemDelta === 0 — identical samples,
    // where the division is undefined. Reporting Infinity or NaN as a percentage
    // would be worse than admitting the value is unavailable.
    const s = normalizeStats(
      sample({
        cpu_stats: {
          cpu_usage: { total_usage: 2_000_000_000 },
          system_cpu_usage: 10_000_000_000,
          online_cpus: 4,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 1_000_000_000 },
          system_cpu_usage: 10_000_000_000, // no elapsed system time
        },
      }),
    );
    expect(s.cpuPercent).toBeNull();
    expect(s.cpuMeasurable).toBe(false);
    // Everything else is still perfectly usable.
    expect(s.memoryUsageMB).toBe(100);
  });

  it('reports null when the CPU count is unknown', () => {
    const s = normalizeStats(
      sample({
        cpu_stats: { cpu_usage: { total_usage: 2_000_000_000 }, system_cpu_usage: 20_000_000_000 },
      }),
    );
    expect(s.cpuCount).toBeNull();
    expect(s.cpuPercent).toBeNull();
    expect(s.cpuMeasurable).toBe(false);
  });

  it('falls back to percpu_usage length when online_cpus is missing', () => {
    const s = normalizeStats(
      sample({
        cpu_stats: {
          cpu_usage: { total_usage: 2_000_000_000, percpu_usage: [1, 2] },
          system_cpu_usage: 20_000_000_000,
        },
      }),
    );
    expect(s.cpuCount).toBe(2);
    expect(s.cpuPercent).toBe(20);
  });

  it('sums network interfaces and splits block IO by direction', () => {
    const s = normalizeStats(sample());
    expect(s.networkRxMB).toBe(1);
    expect(s.networkTxMB).toBe(2);
    expect(s.blockReadMB).toBe(5);
    expect(s.blockWriteMB).toBe(1);
    expect(s.pids).toBe(7);
  });

  it('survives a completely empty stats payload', () => {
    const s = normalizeStats({});
    expect(s.cpuPercent).toBeNull();
    expect(s.memoryUsageMB).toBeNull();
    expect(s.networkRxMB).toBe(0);
  });
});

describe('tar round trip', () => {
  it('packs and extracts a file byte-identically', async () => {
    // Deliberately not valid UTF-8: this is what a JSON string field destroys.
    const content = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0xff, 0xfe, 0x00, 0x01, 0x80]);
    const tarBuffer = await packTar('busybox', content);
    const entries = fileEntries(await extractTar(Readable.from(tarBuffer)));

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('busybox');
    expect(entries[0].content.equals(content)).toBe(true);
  });

  it('preserves an empty file', async () => {
    const tarBuffer = await packTar('empty.txt', Buffer.alloc(0));
    const entries = fileEntries(await extractTar(Readable.from(tarBuffer)));
    expect(entries).toHaveLength(1);
    expect(entries[0].content.length).toBe(0);
  });

  it('fileEntries filters out directory entries', () => {
    const entries = [
      { name: 'dir/', type: 'directory', size: 0, mode: 0, mtime: null, content: Buffer.alloc(0) },
      { name: 'dir/file', type: 'file', size: 1, mode: 0, mtime: null, content: Buffer.from('x') },
    ];
    expect(fileEntries(entries).map((e) => e.name)).toEqual(['dir/file']);
  });
});

describe('REGRESSION: exec output is always framed, even with a TTY', () => {
  // Measured against a live daemon. Container logs and exec differ here, which is
  // the trap: for LOGS a TTY removes the framing entirely, but for EXEC the
  // framing is always present and a TTY only changes what is inside it.
  //
  //   exec Tty:false -> frames of type 1 AND 2, streams separate, LF endings
  //   exec Tty:true  -> frames of type 1 only, streams merged, CRLF endings
  //
  // Treating a TTY exec as unframed leaked "\u0001\u0000...\n" into stdout.
  const ttyExecOutput = Buffer.concat([frame(1, 'probe-out\r\nprobe-err\r\n')]);

  it('demuxes a TTY exec frame instead of passing the header through', () => {
    const { stdout, stderr } = demuxToStreams(ttyExecOutput);
    expect(stdout).toBe('probe-out\r\nprobe-err\r\n');
    expect(stdout).not.toContain('\u0001');
    // A TTY merges the streams before framing, so stderr is legitimately empty.
    expect(stderr).toBe('');
  });

  it('keeps the streams separate for a non-TTY exec', () => {
    const nonTty = Buffer.concat([frame(1, 'probe-out\n'), frame(2, 'probe-err\n')]);
    expect(demuxToStreams(nonTty)).toEqual({ stdout: 'probe-out\n', stderr: 'probe-err\n' });
  });
});
