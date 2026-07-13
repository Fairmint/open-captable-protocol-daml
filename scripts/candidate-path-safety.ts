import * as fs from 'fs';
import * as path from 'path';

export const MAX_CANDIDATE_LOCK_BYTES = 5 * 1024 * 1024;
export const MAX_CANDIDATE_METADATA_BYTES = 1024 * 1024;

/** Verify an untrusted candidate file is regular, bounded, and still inside its root after resolving parent symlinks. */
export function assertContainedRegularFile(
  rootDir: string,
  filePath: string,
  label: string,
  maxBytes: number
): fs.Stats {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escapes candidate root: ${filePath}`);
  }

  const stats = fs.lstatSync(resolvedPath);
  if (!stats.isFile()) {
    throw new Error(`${label} is not a regular file: ${filePath}`);
  }
  if (stats.size > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes: ${filePath}`);
  }

  const realRoot = fs.realpathSync(resolvedRoot);
  const realPath = fs.realpathSync(resolvedPath);
  if (!realPath.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`${label} escapes candidate root through a symlink: ${filePath}`);
  }
  return stats;
}
