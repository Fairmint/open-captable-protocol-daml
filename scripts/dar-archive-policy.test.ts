import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { assertDarArchiveSafe, MAX_DAR_ARCHIVE_ENTRIES, MAX_DAR_ENTRY_UNCOMPRESSED_BYTES } from './dar-archive-policy';

interface SyntheticEntry {
  advertisedCrc32?: number;
  centralExtra?: Buffer;
  compressedSize?: number;
  data?: Buffer;
  externalAttributes?: number;
  flags?: number;
  localExtra?: Buffer;
  method?: number;
  name: string;
  uncompressedSize?: number;
}

const CRC32_TABLE = new Uint32Array(256);
for (let value = 0; value < CRC32_TABLE.length; value++) {
  let remainder = value;
  for (let bit = 0; bit < 8; bit++) {
    remainder = (remainder & 1) !== 0 ? 0xedb88320 ^ (remainder >>> 1) : remainder >>> 1;
  }
  CRC32_TABLE[value] = remainder >>> 0;
}

function crc32(bytes: Buffer): number {
  let checksum = 0xffffffff;
  for (const byte of bytes) checksum = CRC32_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
}

function makeZip(entries: SyntheticEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const data = entry.data ?? Buffer.from('x');
    const rawName = Buffer.from(entry.name, 'ascii');
    const flags = entry.flags ?? 0;
    const method = entry.method ?? 0;
    const compressedData = method === 8 ? deflateRawSync(data, { level: 1 }) : data;
    const compressedSize = entry.compressedSize ?? compressedData.length;
    const uncompressedSize = entry.uncompressedSize ?? data.length;
    const advertisedCrc32 = entry.advertisedCrc32 ?? crc32(data);
    const localExtra = entry.localExtra ?? Buffer.alloc(0);
    const centralExtra = entry.centralExtra ?? Buffer.alloc(0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(advertisedCrc32, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(rawName.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    localParts.push(local, rawName, localExtra, compressedData);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(advertisedCrc32, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(rawName.length, 28);
    central.writeUInt16LE(centralExtra.length, 30);
    central.writeUInt32LE(entry.externalAttributes ?? (0x81a0 << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, rawName, centralExtra);
    localOffset += local.length + rawName.length + localExtra.length + compressedData.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function withArchive(bytes: Buffer, callback: (darPath: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dar-archive-policy-'));
  try {
    const darPath = path.join(root, 'candidate.dar');
    fs.writeFileSync(darPath, bytes);
    callback(darPath);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
}

function zip64Extra(payloadBytes = 8): Buffer {
  const extra = Buffer.alloc(4 + payloadBytes);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(payloadBytes, 2);
  return extra;
}

void describe('hostile DAR archive policy', () => {
  void it('accepts a bounded ordinary ZIP and a real repository DAR when materialized', () => {
    withArchive(makeZip([{ name: 'META-INF/MANIFEST.MF' }]), (darPath) => {
      assert.deepEqual(assertDarArchiveSafe(darPath), { entryCount: 1, totalUncompressedBytes: 1 });
    });

    const repositoryDar = path.join(__dirname, '..', 'dars', 'OpenCapTable-v34', '0.0.1', 'OpenCapTable-v34.dar');
    if (fs.existsSync(repositoryDar)) {
      const result = assertDarArchiveSafe(repositoryDar);
      assert.ok(result.entryCount > 0);
      assert.ok(result.totalUncompressedBytes > 0);
    }
  });

  void it('rejects malformed EOCD and local bounds', () => {
    withArchive(Buffer.from('not a zip'), (darPath) => {
      assert.throws(() => assertDarArchiveSafe(darPath), /EOCD|too small/);
    });
    const malformed = makeZip([{ name: 'safe.dalf' }]);
    const eocdOffset = malformed.length - 22;
    const centralOffset = malformed.readUInt32LE(eocdOffset + 16);
    malformed.writeUInt32LE(centralOffset, centralOffset + 42);
    withArchive(malformed, (darPath) => {
      assert.throws(() => assertDarArchiveSafe(darPath), /local header.*outside archive bounds/);
    });
  });

  void it('rejects traversal, encrypted entries, and Unix symlinks', () => {
    withArchive(makeZip([{ name: '../escape.dalf' }]), (darPath) => {
      assert.throws(() => assertDarArchiveSafe(darPath), /traversal path/);
    });
    withArchive(makeZip([{ flags: 0x0001, name: 'encrypted.dalf' }]), (darPath) => {
      assert.throws(() => assertDarArchiveSafe(darPath), /encrypted entry/);
    });
    withArchive(makeZip([{ externalAttributes: (0xa000 << 16) >>> 0, name: 'symlink.dalf' }]), (darPath) => {
      assert.throws(() => assertDarArchiveSafe(darPath), /symlink entry/);
    });
  });

  void it('rejects ZIP64 metadata while permitting only DAMLC no-op size echoes', () => {
    withArchive(makeZip([{ centralExtra: zip64Extra(), name: 'zip64.dalf' }]), (darPath) => {
      assert.throws(() => assertDarArchiveSafe(darPath), /ZIP64 is not permitted/);
    });

    const localEcho = zip64Extra(16);
    localEcho.writeBigUInt64LE(1n, 4);
    localEcho.writeBigUInt64LE(1n, 12);
    withArchive(
      makeZip([{ centralExtra: zip64Extra(0), localExtra: localEcho, name: 'damlc-compatible.dalf' }]),
      (darPath) => assert.doesNotThrow(() => assertDarArchiveSafe(darPath))
    );
  });

  void it('bounds entry count plus per-entry and aggregate uncompressed sizes', () => {
    const tooMany = Array.from({ length: MAX_DAR_ARCHIVE_ENTRIES + 1 }, (_, index) => ({ name: `e${index}` }));
    withArchive(makeZip(tooMany), (darPath) => {
      assert.throws(() => assertDarArchiveSafe(darPath), /entry count.*exceeds allowed range/);
    });
    withArchive(
      makeZip([
        {
          data: Buffer.from('x'),
          method: 8,
          name: 'large.dalf',
          uncompressedSize: MAX_DAR_ENTRY_UNCOMPRESSED_BYTES + 1,
        },
      ]),
      (darPath) => assert.throws(() => assertDarArchiveSafe(darPath), /declares.*uncompressed bytes/)
    );
    withArchive(
      makeZip(
        Array.from({ length: 5 }, (_, index) => ({
          data: Buffer.from('x'),
          method: 8,
          name: `aggregate-${index}.dalf`,
          uncompressedSize: MAX_DAR_ENTRY_UNCOMPRESSED_BYTES,
        }))
      ),
      (darPath) => assert.throws(() => assertDarArchiveSafe(darPath), /aggregate uncompressed size exceeds/)
    );
  });

  void it('bounds actual inflation even when a deflated entry advertises a tiny size', () => {
    withArchive(
      makeZip([
        {
          data: Buffer.alloc(MAX_DAR_ENTRY_UNCOMPRESSED_BYTES + 1),
          method: 8,
          name: 'forged-small-size.dalf',
          uncompressedSize: 1,
        },
      ]),
      (darPath) => assert.throws(() => assertDarArchiveSafe(darPath), /actual expansion exceeds/)
    );
  });

  void it('verifies actual uncompressed size and CRC-32', () => {
    withArchive(
      makeZip([
        {
          data: Buffer.from('larger than advertised'),
          method: 8,
          name: 'wrong-size.dalf',
          uncompressedSize: 1,
        },
      ]),
      (darPath) => assert.throws(() => assertDarArchiveSafe(darPath), /actual uncompressed size/)
    );
    withArchive(makeZip([{ advertisedCrc32: 0, data: Buffer.from('nonempty'), name: 'wrong-crc.dalf' }]), (darPath) =>
      assert.throws(() => assertDarArchiveSafe(darPath), /CRC-32 mismatch/)
    );
  });
});
