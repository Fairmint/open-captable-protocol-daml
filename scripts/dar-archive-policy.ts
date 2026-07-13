import * as fs from 'fs';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const ZIP64_UINT16 = 0xffff;
const ZIP64_UINT32 = 0xffffffff;
const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_SYMLINK_TYPE = 0xa000;

export const MAX_DAR_ARCHIVE_BYTES = 100 * 1024 * 1024;
export const MAX_DAR_ARCHIVE_ENTRIES = 4096;
export const MAX_DAR_ENTRY_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
export const MAX_DAR_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
export const MAX_DAR_ENTRY_NAME_BYTES = 4096;
export const DAML_INSPECT_TIMEOUT_MS = 60_000;
export const DAML_UPGRADE_CHECK_TIMEOUT_MS = 5 * 60_000;

const MAX_EOCD_SEARCH_BYTES = 22 + 0xffff;
const MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024;
const ALLOWED_GENERAL_PURPOSE_FLAGS = 0x0008 | 0x0800;
const ALLOWED_COMPRESSION_METHODS = new Set([0, 8]);

export interface DarArchiveSummary {
  entryCount: number;
  totalUncompressedBytes: number;
}

interface ArchiveInterval {
  end: number;
  name: string;
  start: number;
}

function readExactly(fd: number, length: number, position: number, label: string): Buffer {
  const buffer = Buffer.alloc(length);
  const bytesRead = fs.readSync(fd, buffer, 0, length, position);
  if (bytesRead !== length) throw new Error(`Malformed DAR ZIP: truncated ${label}`);
  return buffer;
}

function assertRange(start: number, length: number, limit: number, label: string): void {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(length) ||
    start < 0 ||
    length < 0 ||
    start + length > limit
  ) {
    throw new Error(`Malformed DAR ZIP: ${label} is outside archive bounds`);
  }
}

function assertNoZip64Extra(
  extra: Buffer,
  label: string,
  localSizeEcho?: { compressedSize: number; uncompressedSize: number }
): void {
  let cursor = 0;
  while (cursor < extra.length) {
    if (cursor + 4 > extra.length) throw new Error(`Malformed DAR ZIP: truncated ${label} extra field`);
    const fieldId = extra.readUInt16LE(cursor);
    const fieldSize = extra.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + fieldSize > extra.length) throw new Error(`Malformed DAR ZIP: truncated ${label} extra value`);
    if (fieldId === ZIP64_EXTRA_FIELD_ID) {
      // DAMLC emits two redundant ZIP64 encodings on otherwise ordinary ZIP32 archives: an empty central field, and a
      // 16-byte local field that exactly repeats the authoritative 32-bit uncompressed/compressed sizes. Permit only
      // those no-op encodings; any sentinel, extra payload, or mismatch is genuine/ambiguous ZIP64 and is rejected.
      const isEmptyPlaceholder = fieldSize === 0;
      const isExactLocalSizeEcho =
        localSizeEcho !== undefined &&
        fieldSize === 16 &&
        extra.readBigUInt64LE(cursor) === BigInt(localSizeEcho.uncompressedSize) &&
        extra.readBigUInt64LE(cursor + 8) === BigInt(localSizeEcho.compressedSize);
      if (!isEmptyPlaceholder && !isExactLocalSizeEcho) {
        throw new Error(`Unsafe DAR ZIP: ZIP64 is not permitted (${label})`);
      }
    }
    cursor += fieldSize;
  }
}

function decodeAndValidateEntryName(rawName: Buffer): string {
  if (rawName.length === 0 || rawName.length > MAX_DAR_ENTRY_NAME_BYTES) {
    throw new Error(`Unsafe DAR ZIP: entry name must be 1-${MAX_DAR_ENTRY_NAME_BYTES} bytes`);
  }
  for (const byte of rawName) {
    if (byte < 0x20 || byte > 0x7e) {
      throw new Error('Unsafe DAR ZIP: entry names must contain printable ASCII only');
    }
  }
  const name = rawName.toString('ascii');
  if (name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name) || name.includes('\\')) {
    throw new Error(`Unsafe DAR ZIP path: ${name}`);
  }
  const segments = name.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe DAR ZIP traversal path: ${name}`);
  }
  return name;
}

function findEocd(fd: number, archiveSize: number): { offset: number; record: Buffer } {
  if (archiveSize < 22) throw new Error('Malformed DAR ZIP: archive is too small for EOCD');
  const tailLength = Math.min(archiveSize, MAX_EOCD_SEARCH_BYTES);
  const tailOffset = archiveSize - tailLength;
  const tail = readExactly(fd, tailLength, tailOffset, 'EOCD search window');
  for (let index = tail.length - 22; index >= 0; index--) {
    if (tail.readUInt32LE(index) !== EOCD_SIGNATURE) continue;
    const commentLength = tail.readUInt16LE(index + 20);
    if (index + 22 + commentLength !== tail.length) continue;
    return { offset: tailOffset + index, record: tail.subarray(index, index + 22) };
  }
  throw new Error('Malformed DAR ZIP: EOCD record not found');
}

function assertSafeFlags(flags: number, name: string): void {
  if ((flags & ~ALLOWED_GENERAL_PURPOSE_FLAGS) !== 0) {
    if ((flags & (0x0001 | 0x0040 | 0x2000)) !== 0) {
      throw new Error(`Unsafe DAR ZIP: encrypted entry is not permitted: ${name}`);
    }
    throw new Error(`Unsafe DAR ZIP: unsupported general-purpose flags 0x${flags.toString(16)}: ${name}`);
  }
}

/**
 * Validate a DAR as a conservative, bounded ZIP before any external DAML tool parses it. This reads only ZIP metadata;
 * it never inflates candidate-controlled entries.
 */
export function assertDarArchiveSafe(darPath: string): DarArchiveSummary {
  const stats = fs.lstatSync(darPath);
  if (!stats.isFile()) throw new Error(`DAR must be a regular file: ${darPath}`);
  if (stats.size > MAX_DAR_ARCHIVE_BYTES) {
    throw new Error(`Unsafe DAR ZIP: archive exceeds ${MAX_DAR_ARCHIVE_BYTES} bytes: ${darPath}`);
  }

  const fd = fs.openSync(darPath, 'r');
  try {
    const { offset: eocdOffset, record: eocd } = findEocd(fd, stats.size);
    const diskNumber = eocd.readUInt16LE(4);
    const centralDirectoryDisk = eocd.readUInt16LE(6);
    const entriesOnDisk = eocd.readUInt16LE(8);
    const totalEntries = eocd.readUInt16LE(10);
    const centralDirectorySize = eocd.readUInt32LE(12);
    const centralDirectoryOffset = eocd.readUInt32LE(16);

    if (
      diskNumber !== 0 ||
      centralDirectoryDisk !== 0 ||
      entriesOnDisk !== totalEntries ||
      entriesOnDisk === ZIP64_UINT16 ||
      totalEntries === ZIP64_UINT16 ||
      centralDirectorySize === ZIP64_UINT32 ||
      centralDirectoryOffset === ZIP64_UINT32
    ) {
      throw new Error('Unsafe DAR ZIP: multidisk and ZIP64 archives are not permitted');
    }
    if (totalEntries === 0 || totalEntries > MAX_DAR_ARCHIVE_ENTRIES) {
      throw new Error(`Unsafe DAR ZIP: entry count ${totalEntries} exceeds allowed range 1-${MAX_DAR_ARCHIVE_ENTRIES}`);
    }
    if (centralDirectorySize > MAX_CENTRAL_DIRECTORY_BYTES) {
      throw new Error(`Unsafe DAR ZIP: central directory exceeds ${MAX_CENTRAL_DIRECTORY_BYTES} bytes`);
    }
    assertRange(centralDirectoryOffset, centralDirectorySize, eocdOffset, 'central directory');
    if (centralDirectoryOffset + centralDirectorySize !== eocdOffset) {
      throw new Error('Malformed DAR ZIP: central directory does not end at EOCD');
    }

    const central = readExactly(fd, centralDirectorySize, centralDirectoryOffset, 'central directory');
    const names = new Set<string>();
    const localOffsets = new Set<number>();
    const intervals: ArchiveInterval[] = [];
    let cursor = 0;
    let totalUncompressedBytes = 0;

    for (let entryIndex = 0; entryIndex < totalEntries; entryIndex++) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== CENTRAL_FILE_SIGNATURE) {
        throw new Error(`Malformed DAR ZIP: invalid central header at entry ${entryIndex + 1}`);
      }
      const versionNeeded = central.readUInt16LE(cursor + 6);
      const flags = central.readUInt16LE(cursor + 8);
      const method = central.readUInt16LE(cursor + 10);
      const compressedSize = central.readUInt32LE(cursor + 20);
      const uncompressedSize = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);
      const startDisk = central.readUInt16LE(cursor + 34);
      const externalAttributes = central.readUInt32LE(cursor + 38);
      const localOffset = central.readUInt32LE(cursor + 42);
      const headerLength = 46 + nameLength + extraLength + commentLength;
      if (cursor + headerLength > central.length) {
        throw new Error(`Malformed DAR ZIP: central entry ${entryIndex + 1} exceeds directory bounds`);
      }
      if (
        (versionNeeded & 0xff) >= 45 ||
        compressedSize === ZIP64_UINT32 ||
        uncompressedSize === ZIP64_UINT32 ||
        localOffset === ZIP64_UINT32 ||
        startDisk === ZIP64_UINT16
      ) {
        throw new Error(`Unsafe DAR ZIP: ZIP64 metadata is not permitted at entry ${entryIndex + 1}`);
      }

      const rawName = central.subarray(cursor + 46, cursor + 46 + nameLength);
      const name = decodeAndValidateEntryName(rawName);
      assertSafeFlags(flags, name);
      if (!ALLOWED_COMPRESSION_METHODS.has(method)) {
        throw new Error(`Unsafe DAR ZIP: unsupported compression method ${method}: ${name}`);
      }
      if (method === 0 && compressedSize !== uncompressedSize) {
        throw new Error(`Malformed DAR ZIP: stored entry size mismatch: ${name}`);
      }
      const extra = central.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength);
      assertNoZip64Extra(extra, `central entry ${name}`);
      const unixMode = externalAttributes >>> 16;
      if ((unixMode & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK_TYPE) {
        throw new Error(`Unsafe DAR ZIP: symlink entry is not permitted: ${name}`);
      }
      if (names.has(name)) throw new Error(`Unsafe DAR ZIP: duplicate entry path: ${name}`);
      if (localOffsets.has(localOffset))
        throw new Error(`Unsafe DAR ZIP: duplicate local header offset: ${localOffset}`);
      names.add(name);
      localOffsets.add(localOffset);
      if (uncompressedSize > MAX_DAR_ENTRY_UNCOMPRESSED_BYTES) {
        throw new Error(
          `Unsafe DAR ZIP: ${name} declares ${uncompressedSize} uncompressed bytes; maximum is ${MAX_DAR_ENTRY_UNCOMPRESSED_BYTES}`
        );
      }
      totalUncompressedBytes += uncompressedSize;
      if (totalUncompressedBytes > MAX_DAR_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error(
          `Unsafe DAR ZIP: aggregate uncompressed size exceeds ${MAX_DAR_TOTAL_UNCOMPRESSED_BYTES} bytes`
        );
      }

      assertRange(localOffset, 30, centralDirectoryOffset, `local header for ${name}`);
      const local = readExactly(fd, 30, localOffset, `local header for ${name}`);
      if (local.readUInt32LE(0) !== LOCAL_FILE_SIGNATURE) {
        throw new Error(`Malformed DAR ZIP: invalid local header signature: ${name}`);
      }
      const localVersionNeeded = local.readUInt16LE(4);
      const localFlags = local.readUInt16LE(6);
      const localMethod = local.readUInt16LE(8);
      const localCompressedSize = local.readUInt32LE(18);
      const localUncompressedSize = local.readUInt32LE(22);
      const localNameLength = local.readUInt16LE(26);
      const localExtraLength = local.readUInt16LE(28);
      if (
        (localVersionNeeded & 0xff) >= 45 ||
        localCompressedSize === ZIP64_UINT32 ||
        localUncompressedSize === ZIP64_UINT32
      ) {
        throw new Error(`Unsafe DAR ZIP: ZIP64 local metadata is not permitted: ${name}`);
      }
      if (localFlags !== flags || localMethod !== method) {
        throw new Error(`Malformed DAR ZIP: local/central metadata mismatch: ${name}`);
      }
      const localVariableLength = localNameLength + localExtraLength;
      assertRange(localOffset + 30, localVariableLength, centralDirectoryOffset, `local metadata for ${name}`);
      const localVariable = readExactly(fd, localVariableLength, localOffset + 30, `local metadata for ${name}`);
      const localName = localVariable.subarray(0, localNameLength);
      if (!localName.equals(rawName)) throw new Error(`Malformed DAR ZIP: local/central filename mismatch: ${name}`);
      assertNoZip64Extra(localVariable.subarray(localNameLength), `local entry ${name}`, {
        compressedSize,
        uncompressedSize,
      });
      if (
        (flags & 0x0008) === 0 &&
        (localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize)
      ) {
        throw new Error(`Malformed DAR ZIP: local/central size mismatch: ${name}`);
      }
      const dataStart = localOffset + 30 + localVariableLength;
      assertRange(dataStart, compressedSize, centralDirectoryOffset, `compressed data for ${name}`);
      intervals.push({ end: dataStart + compressedSize, name, start: localOffset });
      cursor += headerLength;
    }

    if (cursor !== central.length) throw new Error('Malformed DAR ZIP: unparsed central-directory bytes remain');
    intervals.sort((left, right) => left.start - right.start);
    for (let index = 1; index < intervals.length; index++) {
      const previous = intervals[index - 1];
      const current = intervals[index];
      if (current.start < previous.end) {
        throw new Error(`Malformed DAR ZIP: local entries overlap: ${previous.name} and ${current.name}`);
      }
    }

    return { entryCount: totalEntries, totalUncompressedBytes };
  } finally {
    fs.closeSync(fd);
  }
}
