import * as tar from 'tar-stream';

import { fileEntries, packTarSync, parseTar } from '../../nodes/Docker/helpers/tarUtils';

/**
 * The tar implementation is hand-written because verified n8n community nodes
 * may not ship runtime dependencies. That trade only pays if the result is
 * genuinely interchangeable with a real one, so these tests check it BOTH ways
 * against tar-stream — the library being replaced, still installed as a dev
 * dependency purely so it can act as the oracle here.
 *
 * A round-trip through our own code proves only internal consistency: an
 * implementation that writes a malformed archive and reads it back with the same
 * misunderstanding passes that test and corrupts every real file it touches.
 */

/** Builds an archive with the real library, to be read by ours. */
function packWithLibrary(
  entries: Array<{ name: string; content: Buffer; mode?: number }>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pack = tar.pack();
    const chunks: Buffer[] = [];
    pack.on('data', (c: Buffer) => chunks.push(c));
    pack.on('end', () => resolve(Buffer.concat(chunks)));
    pack.on('error', reject);

    let i = 0;
    const next = (): void => {
      if (i >= entries.length) return pack.finalize();
      const e = entries[i++];
      pack.entry({ name: e.name, size: e.content.length, mode: e.mode ?? 0o644 }, e.content, (err) =>
        err ? reject(err) : next(),
      );
    };
    next();
  });
}

/** Reads an archive with the real library, to check what ours wrote. */
function parseWithLibrary(buffer: Buffer): Promise<Array<{ name: string; content: Buffer }>> {
  return new Promise((resolve, reject) => {
    const out: Array<{ name: string; content: Buffer }> = [];
    const extract = tar.extract();
    extract.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        out.push({ name: header.name, content: Buffer.concat(chunks) });
        next();
      });
      stream.resume();
    });
    extract.on('finish', () => resolve(out));
    extract.on('error', reject);
    extract.end(buffer);
  });
}

describe('parseTar — reading what the real library writes', () => {
  it('reads a single file', async () => {
    const archive = await packWithLibrary([{ name: 'hello.txt', content: Buffer.from('hi there') }]);
    const [entry] = parseTar(archive);
    expect(entry.name).toBe('hello.txt');
    expect(entry.content.toString()).toBe('hi there');
    expect(entry.type).toBe('file');
  });

  it('reads several files in order', async () => {
    const archive = await packWithLibrary([
      { name: 'a.txt', content: Buffer.from('AAA') },
      { name: 'b.txt', content: Buffer.from('BBBB') },
      { name: 'c.txt', content: Buffer.from('CCCCC') },
    ]);
    expect(parseTar(archive).map((e) => [e.name, e.content.toString()])).toEqual([
      ['a.txt', 'AAA'],
      ['b.txt', 'BBBB'],
      ['c.txt', 'CCCCC'],
    ]);
  });

  it('preserves bytes that are not valid UTF-8', async () => {
    // Copying a binary file out of a container must be byte-identical. Anything
    // that round-trips through a string here silently corrupts it.
    const binary = Buffer.from([0xf0, 0x90, 0x8d, 0x88, 0xff, 0xfe, 0x00, 0x01, 0x80]);
    const archive = await packWithLibrary([{ name: 'blob.bin', content: binary }]);
    expect(parseTar(archive)[0].content.equals(binary)).toBe(true);
  });

  it('handles content landing exactly on a block boundary', async () => {
    // 512 and 1024 are where an off-by-one in the padding maths shows up: too
    // little padding and the next header is misread, too much and it is skipped.
    for (const size of [511, 512, 513, 1023, 1024, 1025]) {
      const content = Buffer.alloc(size, 0x41);
      const archive = await packWithLibrary([
        { name: 'padded.bin', content },
        { name: 'after.txt', content: Buffer.from('still here') },
      ]);
      const entries = parseTar(archive);
      expect(entries).toHaveLength(2);
      expect(entries[0].content.length).toBe(size);
      expect(entries[1].content.toString()).toBe('still here');
    }
  });

  it('handles an empty file without losing the entries after it', async () => {
    const archive = await packWithLibrary([
      { name: 'empty.txt', content: Buffer.alloc(0) },
      { name: 'next.txt', content: Buffer.from('present') },
    ]);
    const entries = parseTar(archive);
    expect(entries.map((e) => e.name)).toEqual(['empty.txt', 'next.txt']);
    expect(entries[0].content.length).toBe(0);
  });

  it('reads a name too long for the 100-byte field', async () => {
    // The library emits a PAX header for this. Ignoring PAX would yield a
    // truncated path, which means a file written to the wrong place.
    const longName = `${'nested/'.repeat(20)}deeply-buried-file.txt`;
    expect(longName.length).toBeGreaterThan(100);
    const archive = await packWithLibrary([{ name: longName, content: Buffer.from('found me') }]);
    const [entry] = parseTar(archive);
    expect(entry.name).toBe(longName);
    expect(entry.content.toString()).toBe('found me');
  });

  it('preserves the file mode', async () => {
    const archive = await packWithLibrary([
      { name: 'script.sh', content: Buffer.from('#!/bin/sh\n'), mode: 0o755 },
    ]);
    expect(parseTar(archive)[0].mode).toBe(0o755);
  });
});

describe('packTarSync — writing what the real library can read', () => {
  it('produces an archive the library reads back identically', async () => {
    const content = Buffer.from('written by hand, read by the library');
    const parsed = await parseWithLibrary(packTarSync('note.txt', content));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('note.txt');
    expect(parsed[0].content.equals(content)).toBe(true);
  });

  it('survives binary content in both directions', async () => {
    const binary = Buffer.from([0x00, 0xff, 0x7f, 0x80, 0x0a, 0x0d, 0x1a]);
    const parsed = await parseWithLibrary(packTarSync('blob.bin', binary));
    expect(parsed[0].content.equals(binary)).toBe(true);
  });

  it('writes a long name the library reads back in full', async () => {
    const longName = `${'a'.repeat(60)}/${'b'.repeat(60)}.txt`;
    expect(longName.length).toBeGreaterThan(100);
    const parsed = await parseWithLibrary(packTarSync(longName, Buffer.from('x')));
    expect(parsed[0].name).toBe(longName);
  });

  it('pads correctly at block boundaries', async () => {
    for (const size of [0, 1, 511, 512, 513, 1024]) {
      const content = Buffer.alloc(size, 0x5a);
      const parsed = await parseWithLibrary(packTarSync('padded.bin', content));
      expect(parsed[0].content.length).toBe(size);
    }
  });

  it('strips a leading slash, as Docker expects a relative path', () => {
    const [entry] = parseTar(packTarSync('/tmp/file.txt', Buffer.from('x')));
    expect(entry.name).toBe('tmp/file.txt');
  });

  it('round-trips through our own code', () => {
    const [entry] = parseTar(packTarSync('a/b/c.txt', Buffer.from('round trip'), 0o600));
    expect(entry.name).toBe('a/b/c.txt');
    expect(entry.content.toString()).toBe('round trip');
    expect(entry.mode).toBe(0o600);
  });
});

describe('parseTar — refusing to guess', () => {
  it('stops at the end-of-archive marker rather than reading past it', () => {
    const archive = Buffer.concat([packTarSync('one.txt', Buffer.from('1')), Buffer.alloc(2048)]);
    expect(parseTar(archive)).toHaveLength(1);
  });

  it('stops on a block whose checksum does not verify', () => {
    // Without the checksum test, file data that happens to sit on a block
    // boundary can be mistaken for a header and produce invented entries.
    const good = packTarSync('one.txt', Buffer.from('1'));
    const corrupt = Buffer.concat([good.subarray(0, 1024), Buffer.alloc(512, 0x41)]);
    expect(() => parseTar(corrupt)).not.toThrow();
    expect(parseTar(corrupt).length).toBeLessThanOrEqual(1);
  });

  it('returns nothing for an empty buffer rather than throwing', () => {
    expect(parseTar(Buffer.alloc(0))).toEqual([]);
  });

  it('tolerates a truncated archive', () => {
    const truncated = packTarSync('one.txt', Buffer.from('hello')).subarray(0, 700);
    expect(() => parseTar(truncated)).not.toThrow();
  });
});

describe('fileEntries', () => {
  it('keeps files and drops directories', () => {
    const entries = [
      { name: 'dir/', type: 'directory', size: 0, mode: 0o755, mtime: null, content: Buffer.alloc(0) },
      { name: 'dir/f.txt', type: 'file', size: 1, mode: 0o644, mtime: null, content: Buffer.from('x') },
      { name: '', type: 'file', size: 0, mode: 0o644, mtime: null, content: Buffer.alloc(0) },
    ];
    expect(fileEntries(entries).map((e) => e.name)).toEqual(['dir/f.txt']);
  });
});
