import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInflateRaw } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_ARCHIVE_PATH_BYTES = 1_024;
const MAX_COMPRESSION_RATIO = 200;

export interface ZipExtractionLimits {
  maxFileCount: number;
  maxSingleFileBytes: number;
  maxTotalUnpackedBytes: number;
}

interface ZipEntry {
  archivePath: string;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  crc32: number;
  localHeaderOffset: number;
  archiveDataEnd: number;
  directory: boolean;
}

interface ExtractionState {
  fileCount: number;
  remainingTotalBytes: number;
  limits: ZipExtractionLimits;
}

export class ZipArchiveError extends Error {}

function fail(message: string): never {
  throw new ZipArchiveError(message);
}

function requireRange(buffer: Buffer, offset: number, length: number): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > buffer.length
  ) {
    fail('The ZIP archive is truncated or malformed.');
  }
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }
  return fail('The uploaded file is not a supported ZIP archive.');
}

function decodeArchivePath(bytes: Buffer, utf8: boolean): string {
  if (bytes.length === 0 || bytes.length > MAX_ARCHIVE_PATH_BYTES) {
    return fail('The ZIP archive contains an invalid file path.');
  }

  try {
    if (utf8) {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    if (bytes.some((byte) => byte >= 0x80)) {
      return fail('Non-UTF-8 ZIP file names are not supported.');
    }
    return bytes.toString('ascii');
  } catch {
    return fail('The ZIP archive contains an invalid UTF-8 file path.');
  }
}

function normalizeArchivePath(rawPath: string): {
  archivePath: string;
  directory: boolean;
} {
  if (
    rawPath.includes('\0') ||
    rawPath.includes('\\') ||
    path.posix.isAbsolute(rawPath) ||
    path.win32.isAbsolute(rawPath)
  ) {
    return fail('The ZIP archive contains an unsafe absolute file path.');
  }

  const directory = rawPath.endsWith('/');
  const withoutTrailingSlash = directory ? rawPath.slice(0, -1) : rawPath;
  const segments = withoutTrailingSlash.split('/');
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        segment.includes('\0'),
    )
  ) {
    return fail('The ZIP archive contains an unsafe traversal path.');
  }

  return { archivePath: segments.join('/'), directory };
}

function isUnixSymlink(versionMadeBy: number, externalAttributes: number): boolean {
  const platform = (versionMadeBy >>> 8) & 0xff;
  if (platform !== 3) return false;
  const mode = externalAttributes >>> 16;
  return (mode & 0o170000) === 0o120000;
}

function hasTrustedUncompressedSize(flags: number, uncompressedSize: number): boolean {
  return (flags & 0x0008) === 0 && uncompressedSize > 0;
}

function parseCentralDirectory(buffer: Buffer, limits: ZipExtractionLimits): ZipEntry[] {
  const endOffset = findEndOfCentralDirectory(buffer);
  requireRange(buffer, endOffset, 22);

  const diskNumber = buffer.readUInt16LE(endOffset + 4);
  const centralDirectoryDisk = buffer.readUInt16LE(endOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(endOffset + 8);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);
  const commentLength = buffer.readUInt16LE(endOffset + 20);

  if (endOffset + 22 + commentLength !== buffer.length) {
    return fail('The ZIP archive contains unsupported trailing data.');
  }
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    return fail('Multi-disk ZIP archives are not supported.');
  }
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    return fail('ZIP64 archives are not supported.');
  }
  if (entryCount === 0 || entryCount > limits.maxFileCount) {
    return fail('Extension archive contains too many files.');
  }
  if (centralDirectoryOffset + centralDirectorySize !== endOffset) {
    return fail('The ZIP central directory is malformed.');
  }

  const entries: ZipEntry[] = [];
  const seenPaths = new Set<string>();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    requireRange(buffer, offset, 46);
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_HEADER) {
      return fail('The ZIP central directory is malformed.');
    }

    const versionMadeBy = buffer.readUInt16LE(offset + 4);
    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const expectedCrc32 = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentSize = buffer.readUInt16LE(offset + 32);
    const diskStart = buffer.readUInt16LE(offset + 34);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const recordLength = 46 + fileNameLength + extraLength + commentSize;
    requireRange(buffer, offset, recordLength);

    if (diskStart !== 0) {
      return fail('Multi-disk ZIP archives are not supported.');
    }
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) {
      return fail('Encrypted ZIP entries are not supported.');
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      return fail('The ZIP archive uses an unsupported compression method.');
    }
    if (
      compressionMethod === 0 &&
      hasTrustedUncompressedSize(flags, uncompressedSize) &&
      compressedSize !== uncompressedSize
    ) {
      return fail('A stored ZIP entry has inconsistent compressed and extracted sizes.');
    }
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      return fail('ZIP64 entries are not supported.');
    }
    if (isUnixSymlink(versionMadeBy, externalAttributes)) {
      return fail('Symbolic links are not allowed in extension ZIP archives.');
    }

    const rawPath = decodeArchivePath(
      buffer.subarray(offset + 46, offset + 46 + fileNameLength),
      (flags & 0x0800) !== 0,
    );
    const normalized = normalizeArchivePath(rawPath);
    const collisionKey = normalized.archivePath.toLocaleLowerCase('en-US');
    if (seenPaths.has(collisionKey)) {
      return fail('The ZIP archive contains duplicate file paths.');
    }
    seenPaths.add(collisionKey);

    if (normalized.directory) {
      if (
        hasTrustedUncompressedSize(flags, uncompressedSize) &&
        (uncompressedSize !== 0 || compressedSize !== 0)
      ) {
        return fail('The ZIP archive contains a malformed directory entry.');
      }
    } else if (hasTrustedUncompressedSize(flags, uncompressedSize)) {
      if (uncompressedSize > limits.maxSingleFileBytes) {
        return fail('Extension file exceeds maximum unpacked size.');
      }
      if (
        compressionMethod === 8 &&
        uncompressedSize > 1024 * 1024 &&
        (compressedSize === 0 || uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO)
      ) {
        return fail('The ZIP archive exceeds the allowed compression ratio.');
      }
    }

    entries.push({
      archivePath: normalized.archivePath,
      flags,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      crc32: expectedCrc32,
      localHeaderOffset,
      archiveDataEnd: centralDirectoryOffset,
      directory: normalized.directory,
    });
    offset += recordLength;
  }

  if (offset !== endOffset) {
    return fail('The ZIP central directory has an unexpected size.');
  }

  const filePaths = new Set(
    entries
      .filter((entry) => !entry.directory)
      .map((entry) => entry.archivePath.toLocaleLowerCase('en-US')),
  );
  for (const entry of entries) {
    const parts = entry.archivePath.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join('/').toLocaleLowerCase('en-US');
      if (filePaths.has(parent)) {
        return fail('The ZIP archive contains conflicting file and directory paths.');
      }
    }
  }

  return entries;
}

function resolveExtractionPath(root: string, archivePath: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...archivePath.split('/'));
  const relative = path.relative(resolvedRoot, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return fail('The ZIP archive contains a path outside the extraction directory.');
  }
  return target;
}

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  crcTable = table;
  return table;
}

function calculateCrc32(buffer: Buffer): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of buffer) {
    const tableValue = table[(crc ^ byte) & 0xff];
    if (tableValue === undefined) {
      return fail('Unable to validate the ZIP entry checksum.');
    }
    crc = tableValue ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertOutputWithinLimits(
  outputBytes: number,
  state: ExtractionState,
): void {
  if (outputBytes > state.limits.maxSingleFileBytes) {
    fail('Extension file exceeds maximum unpacked size.');
  }
  if (outputBytes > state.remainingTotalBytes) {
    fail('Extension archive exceeds maximum unpacked size.');
  }
}

function inflateRawCounted(compressed: Buffer, state: ExtractionState): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    const inflater = createInflateRaw();
    let settled = false;

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      inflater.destroy();
      reject(error);
    };

    inflater.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      try {
        assertOutputWithinLimits(outputBytes, state);
      } catch (error) {
        rejectOnce(error instanceof ZipArchiveError ? error : new ZipArchiveError(String(error)));
        return;
      }
      chunks.push(chunk);
    });
    inflater.on('error', () => {
      rejectOnce(new ZipArchiveError('A compressed ZIP entry could not be decompressed.'));
    });
    inflater.on('end', () => {
      if (settled) return;
      settled = true;
      state.remainingTotalBytes -= outputBytes;
      resolve(Buffer.concat(chunks));
    });

    inflater.end(compressed);
  });
}

async function readEntryData(
  buffer: Buffer,
  entry: ZipEntry,
  state: ExtractionState,
): Promise<Buffer> {
  requireRange(buffer, entry.localHeaderOffset, 30);
  if (buffer.readUInt32LE(entry.localHeaderOffset) !== LOCAL_FILE_HEADER) {
    return fail('The ZIP archive contains an invalid local file header.');
  }

  const localFlags = buffer.readUInt16LE(entry.localHeaderOffset + 6);
  const localMethod = buffer.readUInt16LE(entry.localHeaderOffset + 8);
  const localCrc32 = buffer.readUInt32LE(entry.localHeaderOffset + 14);
  const localCompressedSize = buffer.readUInt32LE(entry.localHeaderOffset + 18);
  const localUncompressedSize = buffer.readUInt32LE(entry.localHeaderOffset + 22);
  const localNameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const localExtraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  if (localFlags !== entry.flags || localMethod !== entry.compressionMethod) {
    return fail('The ZIP archive contains inconsistent entry metadata.');
  }
  if ((localFlags & 0x0001) !== 0 || (localFlags & 0x0040) !== 0) {
    return fail('Encrypted ZIP entries are not supported.');
  }
  if (
    (localFlags & 0x0008) === 0 &&
    (localCrc32 !== entry.crc32 ||
      localCompressedSize !== entry.compressedSize ||
      localUncompressedSize !== entry.uncompressedSize)
  ) {
    return fail('The ZIP archive contains inconsistent local entry sizes.');
  }

  requireRange(buffer, entry.localHeaderOffset + 30, localNameLength + localExtraLength);
  const localRawPath = decodeArchivePath(
    buffer.subarray(
      entry.localHeaderOffset + 30,
      entry.localHeaderOffset + 30 + localNameLength,
    ),
    (localFlags & 0x0800) !== 0,
  );
  const localPath = normalizeArchivePath(localRawPath);
  if (
    localPath.archivePath !== entry.archivePath ||
    localPath.directory !== entry.directory
  ) {
    return fail('The ZIP archive contains inconsistent local and central file paths.');
  }

  const dataOffset = entry.localHeaderOffset + 30 + localNameLength + localExtraLength;
  requireRange(buffer, dataOffset, entry.compressedSize);
  if (dataOffset + entry.compressedSize > entry.archiveDataEnd) {
    return fail('A ZIP entry overlaps the central directory.');
  }
  const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);

  let data: Buffer;
  if (entry.compressionMethod === 0) {
    assertOutputWithinLimits(compressed.length, state);
    state.remainingTotalBytes -= compressed.length;
    data = Buffer.from(compressed);
  } else {
    try {
      data = await inflateRawCounted(compressed, state);
    } catch (error) {
      if (error instanceof ZipArchiveError) throw error;
      return fail('A compressed ZIP entry could not be decompressed.');
    }
  }

  if (
    hasTrustedUncompressedSize(entry.flags, entry.uncompressedSize) &&
    data.length !== entry.uncompressedSize
  ) {
    return fail('A ZIP entry does not match its declared extracted size.');
  }
  if (entry.crc32 !== 0 && calculateCrc32(data) !== entry.crc32) {
    return fail('A ZIP entry failed its CRC32 integrity check.');
  }
  return data;
}

export async function extractZipArchive(
  buffer: Buffer,
  destination: string,
  limits: ZipExtractionLimits,
): Promise<void> {
  const entries = parseCentralDirectory(buffer, limits);
  const state: ExtractionState = {
    fileCount: 0,
    remainingTotalBytes: limits.maxTotalUnpackedBytes,
    limits,
  };

  await mkdir(destination, { recursive: false });

  try {
    for (const entry of entries) {
      const target = resolveExtractionPath(destination, entry.archivePath);
      if (entry.directory) {
        await mkdir(target, { recursive: true });
        continue;
      }

      state.fileCount += 1;
      if (state.fileCount > limits.maxFileCount) {
        fail('Extension archive contains too many files.');
      }

      const data = await readEntryData(buffer, entry, state);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data, { flag: 'wx' });
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}
