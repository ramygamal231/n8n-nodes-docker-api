import { Readable } from 'stream';
import * as tar from 'tar-stream';

export interface TarEntry {
  name: string;
  type: string;
  size: number;
  mode: number;
  mtime: Date | null;
  content: Buffer;
}

/**
 * Docker's file-copy endpoints speak tar in both directions, even for a single
 * file. Users think in files, so these helpers wrap and unwrap the archive.
 *
 * tar-stream is used rather than hand-rolling the format. It is already in the
 * dependency tree via dockerode and is declared explicitly here so the reliance
 * is not on a transitive dependency that could disappear. Writing a tar parser
 * by hand would mean owning PAX headers, long-name handling and padding rules —
 * precisely the kind of format edge cases that produce silent corruption.
 */
export function extractTar(stream: Readable): Promise<TarEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: TarEntry[] = [];
    const extract = tar.extract();

    extract.on('entry', (header, entryStream, next) => {
      const chunks: Buffer[] = [];
      entryStream.on('data', (c: Buffer) => chunks.push(c));
      entryStream.on('end', () => {
        entries.push({
          name: header.name,
          type: String(header.type ?? 'file'),
          size: header.size ?? 0,
          mode: header.mode ?? 0o644,
          mtime: header.mtime instanceof Date ? header.mtime : null,
          content: Buffer.concat(chunks),
        });
        next();
      });
      entryStream.on('error', reject);
      entryStream.resume();
    });

    extract.on('finish', () => resolve(entries));
    extract.on('error', reject);
    stream.pipe(extract);
  });
}

/**
 * Builds a single-file tar archive suitable for Docker's putArchive.
 * Necessarily async: tar-stream packs through a stream.
 */
export function packTar(fileName: string, content: Buffer, mode = 0o644): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pack = tar.pack();
    const chunks: Buffer[] = [];

    pack.on('data', (c: Buffer) => chunks.push(c));
    pack.on('end', () => resolve(Buffer.concat(chunks)));
    pack.on('error', reject);

    pack.entry({ name: fileName, size: content.length, mode }, content, (err) => {
      if (err) return reject(err);
      pack.finalize();
    });
  });
}

/** Only real files matter to a workflow; directory entries are structural. */
export const fileEntries = (entries: TarEntry[]): TarEntry[] =>
  entries.filter((e) => e.type === 'file' && e.name !== '' && !e.name.endsWith('/'));
