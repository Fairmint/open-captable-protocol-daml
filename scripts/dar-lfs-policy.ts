const MAX_DAR_COUNT = 250;
const MAX_DAR_SIZE_BYTES = 100n * 1024n * 1024n;
const MAX_TOTAL_DAR_BYTES = 1024n * 1024n * 1024n;
const MAX_POINTER_BLOB_BYTES = 512;

const SAFE_DAR_PATH =
  /^dars\/[A-Za-z0-9][A-Za-z0-9._-]*\/(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\/[A-Za-z0-9][A-Za-z0-9._-]*\.dar$/;
const CANONICAL_LFS_POINTER =
  /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (0|[1-9]\d*)\n$/;

export interface DarTreeBlob {
  blob: string;
  mode: string;
  path: string;
  type: string;
}

export interface ValidatedDarLfsPointer {
  oid: string;
  path: string;
  size: number;
}

export function assertSafeDarTreePath(darPath: string): void {
  if (!SAFE_DAR_PATH.test(darPath)) throw new Error(`Unsafe DAR tree path: ${darPath}`);
}

/** Validate one PR-tree DAR as a canonical, bounded Git LFS pointer before any LFS object download. */
export function validateDarLfsPointer(entry: DarTreeBlob): ValidatedDarLfsPointer {
  assertSafeDarTreePath(entry.path);
  if (entry.mode !== '100644' || entry.type !== 'blob') {
    throw new Error(`DAR tree path must be a non-executable regular blob: ${entry.path}`);
  }
  if (Buffer.byteLength(entry.blob, 'utf8') > MAX_POINTER_BLOB_BYTES) {
    throw new Error(`DAR pointer blob is larger than ${MAX_POINTER_BLOB_BYTES} bytes: ${entry.path}`);
  }
  const match = CANONICAL_LFS_POINTER.exec(entry.blob);
  if (!match) throw new Error(`DAR is not a canonical Git LFS pointer: ${entry.path}`);

  const size = BigInt(match[2]);
  if (size > MAX_DAR_SIZE_BYTES) {
    throw new Error(`DAR LFS object exceeds 100 MiB: ${entry.path} declares ${size} bytes`);
  }
  return { oid: match[1], path: entry.path, size: Number(size) };
}

/** Apply count and aggregate-size limits to every validated DAR path in the PR tree. */
export function validateDarLfsTree(entries: DarTreeBlob[]): ValidatedDarLfsPointer[] {
  if (entries.length > MAX_DAR_COUNT) {
    throw new Error(`PR tree contains ${entries.length} DARs; maximum is ${MAX_DAR_COUNT}`);
  }
  const pointers = entries.map(validateDarLfsPointer);
  const totalSize = pointers.reduce((total, pointer) => total + BigInt(pointer.size), 0n);
  if (totalSize > MAX_TOTAL_DAR_BYTES) {
    throw new Error(`PR tree DARs declare ${totalSize} bytes total; maximum is 1 GiB`);
  }
  return pointers;
}
