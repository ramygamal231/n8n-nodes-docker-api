import { Readable } from 'stream';

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
 * This is a hand-written implementation rather than a dependency, because
 * verified n8n community nodes may not ship runtime dependencies at all. That
 * makes the format edge cases ours to own — so the pieces that actually bite are
 * handled explicitly and tested: PAX extended headers, GNU long names, the
 * prefix field, base-256 numeric fields, and the header checksum. Anything
 * unrecognised is skipped by its declared size rather than guessed at, so an
 * unusual entry cannot desynchronise the parse and silently corrupt every entry
 * after it.
 *
 * Reference: POSIX.1-1988 (ustar) and POSIX.1-2001 (pax).
 */

const BLOCK = 512;

/** Offsets and widths of the ustar header fields, in bytes. */
const F = {
  name: [0, 100],
  mode: [100, 8],
  uid: [108, 8],
  gid: [116, 8],
  size: [124, 12],
  mtime: [136, 12],
  chksum: [148, 8],
  typeflag: [156, 1],
  magic: [257, 6],
  prefix: [345, 155],
} as const;

type Field = readonly [number, number];

const str = (block: Buffer, [off, len]: Field): string => {
  const raw = block.subarray(off, off + len);
  const end = raw.indexOf(0);
  return raw
    .subarray(0, end === -1 ? raw.length : end)
    .toString('utf8')
    .trim();
};

/**
 * Numeric fields are octal text, but GNU writes values too large for the field
 * as base-256 with the high bit of the first byte set. Reading one of those as
 * octal yields nonsense — and for a size field, nonsense means reading the wrong
 * number of bytes and losing every entry that follows.
 */
function num(block: Buffer, field: Field): number {
  const [off, len] = field;
  const raw = block.subarray(off, off + len);
  if (raw.length > 0 && (raw[0] & 0x80) !== 0) {
    // Plain arithmetic rather than BigInt: this encoding only appears for sizes
    // an octal field cannot hold (about 8 GB), and precision is only lost past
    // 9 PB — beyond anything that could be copied out of a container in one go.
    let value = raw[0] & 0x7f;
    for (let i = 1; i < raw.length; i++) value = value * 256 + raw[i];
    return value;
  }
  const text = str(block, field).replace(/[^0-7]/g, '');
  return text === '' ? 0 : parseInt(text, 8);
}

/** A block of nothing but zeroes marks the end of the archive. */
function isZeroBlock(b: Buffer): boolean {
  for (let i = 0; i < b.length; i++) if (b[i] !== 0) return false;
  return true;
}

/**
 * The header checksum, computed with the checksum field itself read as spaces.
 * Verifying it is what distinguishes a real header from file data that happens
 * to land on a block boundary.
 */
function checksumMatches(block: Buffer): boolean {
  const stated = num(block, F.chksum);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    sum += i >= F.chksum[0] && i < F.chksum[0] + F.chksum[1] ? 0x20 : block[i];
  }
  return sum === stated;
}

const TYPE_NAMES: Record<string, string> = {
  '0': 'file',
  '\0': 'file',
  '1': 'link',
  '2': 'symlink',
  '3': 'character-device',
  '4': 'block-device',
  '5': 'directory',
  '6': 'fifo',
  '7': 'contiguous-file',
};

/** `key=value` records, each prefixed by its own total length: `30 mtime=1234\n`. */
function parsePax(content: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < content.length) {
    const space = content.indexOf(0x20, pos);
    if (space === -1) break;
    const len = parseInt(content.subarray(pos, space).toString('ascii'), 10);
    if (!Number.isFinite(len) || len <= 0 || pos + len > content.length) break;
    const record = content
      .subarray(space + 1, pos + len)
      .toString('utf8')
      .replace(/\n$/, '');
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    pos += len;
  }
  return out;
}

/** Parses a complete tar archive held in memory. */
export function parseTar(buffer: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  // Carried from a PAX or GNU header onto the entry that follows it.
  let pendingName: string | null = null;
  let pendingSize: number | null = null;

  while (offset + BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK);

    if (isZeroBlock(header)) break;
    if (!checksumMatches(header)) break;

    offset += BLOCK;

    const typeflag = header.subarray(F.typeflag[0], F.typeflag[0] + 1).toString('binary');
    const size = Math.max(0, pendingSize ?? num(header, F.size));
    const data = buffer.subarray(offset, offset + size);
    // Entry data is padded out to a whole number of blocks.
    offset += Math.ceil(size / BLOCK) * BLOCK;

    // 'x' applies to the next entry, 'g' is archive-global. Both carry metadata
    // rather than a file.
    if (typeflag === 'x' || typeflag === 'g') {
      const pax = parsePax(data);
      if (pax.path) pendingName = pax.path;
      if (pax.size) pendingSize = Number(pax.size);
      continue;
    }

    // GNU's answer to names longer than 100 bytes: the name IS the entry data.
    if (typeflag === 'L') {
      pendingName = data.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    // GNU long link target. Irrelevant here, but it must be consumed rather than
    // treated as a file, or it surfaces as a bogus entry.
    if (typeflag === 'K') continue;

    const prefix = str(header, F.prefix);
    const rawName = str(header, F.name);
    const name = pendingName ?? (prefix ? `${prefix}/${rawName}` : rawName);
    const mtimeSec = num(header, F.mtime);

    entries.push({
      name,
      type: TYPE_NAMES[typeflag] ?? 'file',
      size,
      mode: num(header, F.mode),
      mtime: mtimeSec > 0 ? new Date(mtimeSec * 1000) : null,
      // Copied rather than referenced: a subarray would keep the whole archive
      // alive in memory for as long as any single entry is held.
      content: Buffer.from(data),
    });

    pendingName = null;
    pendingSize = null;
  }

  return entries;
}

/** Collects a stream, then parses it. */
export function extractTar(stream: Readable): Promise<TarEntry[]> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on('end', () => {
      try {
        resolve(parseTar(Buffer.concat(chunks)));
      } catch (error) {
        reject(error);
      }
    });
    stream.on('error', reject);
  });
}

function writeOctal(block: Buffer, [off, len]: Field, value: number): void {
  // One byte is reserved for the NUL terminator.
  block.write(Math.floor(value).toString(8).padStart(len - 1, '0') + '\0', off, 'ascii');
}

function padToBlock(data: Buffer): Buffer {
  const remainder = data.length % BLOCK;
  if (remainder === 0) return data;
  return Buffer.concat([data, Buffer.alloc(BLOCK - remainder)]);
}

function buildHeader(name: string, size: number, mode: number, typeflag: string): Buffer {
  const block = Buffer.alloc(BLOCK);

  block.write(name.slice(0, 100), F.name[0], 'utf8');
  writeOctal(block, F.mode, mode & 0o7777);
  writeOctal(block, F.uid, 0);
  writeOctal(block, F.gid, 0);
  writeOctal(block, F.size, size);
  writeOctal(block, F.mtime, Math.floor(Date.now() / 1000));
  block.write(typeflag, F.typeflag[0], 'ascii');
  block.write('ustar\0', F.magic[0], 'binary');
  block.write('00', 263, 'binary');

  // The checksum is computed with its own field read as spaces, then written in.
  block.write('        ', F.chksum[0], 'ascii');
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += block[i];
  block.write(sum.toString(8).padStart(6, '0') + '\0 ', F.chksum[0], 'ascii');

  return block;
}

export function packTarSync(fileName: string, content: Buffer, mode = 0o644): Buffer {
  const name = fileName.replace(/^\/+/, '');
  const blocks: Buffer[] = [];

  // A name too long for the 100-byte field needs a PAX header carrying the real
  // path. Writing it into the field regardless would silently truncate it, and a
  // truncated path is a file written to the wrong place.
  if (Buffer.byteLength(name, 'utf8') > 100) {
    const record = `path=${name}\n`;
    // The length prefix counts itself, so it has to be solved for. Two passes
    // settle it for any realistic path.
    let len = Buffer.byteLength(record, 'utf8') + 2;
    len = Buffer.byteLength(`${len} ${record}`, 'utf8');
    len = Buffer.byteLength(`${len} ${record}`, 'utf8');
    const pax = Buffer.from(`${len} ${record}`, 'utf8');
    blocks.push(buildHeader('PaxHeaders/0', pax.length, 0o644, 'x'), padToBlock(pax));
  }

  blocks.push(buildHeader(name, content.length, mode, '0'), padToBlock(content));
  // Two zero blocks close the archive.
  blocks.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(blocks);
}

/**
 * Builds a single-file tar archive suitable for Docker's putArchive.
 *
 * Async only to keep the signature its callers already use.
 */
export function packTar(fileName: string, content: Buffer, mode = 0o644): Promise<Buffer> {
  return Promise.resolve(packTarSync(fileName, content, mode));
}

/** Only real files matter to a workflow; directory entries are structural. */
export const fileEntries = (entries: TarEntry[]): TarEntry[] =>
  entries.filter((e) => e.type === 'file' && e.name !== '' && !e.name.endsWith('/'));
