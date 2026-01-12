/**
 * Shared utilities for DAR file management.
 * Used by upload scripts and backup scripts.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface DarsLockEntry {
  sha256: string;
  size: number;
  sdkVersion: string;
  uploadedAt: string;
  networks: string[];
}

export interface DarsLock {
  version: number;
  packages: Record<string, DarsLockEntry>;
}

/**
 * Error thrown when DAR integrity verification fails.
 */
export class DarIntegrityError extends Error {
  constructor(
    message: string,
    public readonly lockKey: string,
    public readonly expectedHash: string,
    public readonly actualHash: string
  ) {
    super(message);
    this.name = 'DarIntegrityError';
  }
}

/**
 * Get the path to the dars directory.
 */
export function getDarsDir(): string {
  return path.join(__dirname, '..', 'dars');
}

/**
 * Load the dars.lock file.
 */
export function loadDarsLock(): DarsLock {
  const lockPath = path.join(getDarsDir(), 'dars.lock');

  if (!fs.existsSync(lockPath)) {
    return { version: 1, packages: {} };
  }

  const content = fs.readFileSync(lockPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Save the dars.lock file.
 */
export function saveDarsLock(lock: DarsLock): void {
  const lockPath = path.join(getDarsDir(), 'dars.lock');
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
}

/**
 * Compute SHA256 hash of a file.
 */
export function computeSha256(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256');
  hash.update(fileBuffer);
  return hash.digest('hex');
}

/**
 * Get the lock key for a DAR file.
 */
export function getDarLockKey(packageName: string, version: string, darName: string): string {
  return `${packageName}/${version}/${darName}.dar`;
}

/**
 * Find all DAR files in a directory recursively.
 */
export function findDarFiles(darsDir: string): string[] {
  const files: string[] = [];

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith('.dar')) {
        files.push(fullPath);
      }
    }
  }

  scanDir(darsDir);
  return files;
}

/**
 * Check if a backed-up DAR exists and return its path.
 * Returns null if no backed-up DAR exists or file is missing.
 * Throws DarIntegrityError if the file exists but hash doesn't match.
 */
export function getBackedUpDarPath(
  packageName: string,
  version: string,
  darName: string
): string | null {
  const lockKey = getDarLockKey(packageName, version, darName);
  const lock = loadDarsLock();

  // Check if entry exists in lock file
  if (!lock.packages[lockKey]) {
    return null;
  }

  // Check if file exists
  const darPath = path.join(getDarsDir(), lockKey);
  if (!fs.existsSync(darPath)) {
    console.warn(`⚠️ DAR recorded in dars.lock but file missing: ${lockKey}`);
    return null;
  }

  // Verify hash - throw error if mismatch (security concern)
  const actualHash = computeSha256(darPath);
  const expectedHash = lock.packages[lockKey].sha256;
  if (actualHash !== expectedHash) {
    throw new DarIntegrityError(
      `Hash mismatch for backed-up DAR: ${lockKey}. ` +
        `Expected ${expectedHash}, got ${actualHash}. ` +
        `The DAR file may have been tampered with.`,
      lockKey,
      expectedHash,
      actualHash
    );
  }

  return darPath;
}

/**
 * Print a warning when using a freshly built DAR instead of a backed-up one.
 */
export function warnIfBuildingFresh(packageName: string, version: string): void {
  console.warn(`⚠️ No backed-up DAR found for ${packageName} v${version}`);
  console.warn(`   Using freshly built DAR from .daml/dist/`);
  console.warn(`   After successful upload, run:`);
  console.warn(`   npm run backup-dar -- --package ${packageName} --version ${version}`);
}

/**
 * Record that a DAR was uploaded to a specific network.
 * Updates the networks array in dars.lock.
 */
export function recordNetworkUpload(
  packageName: string,
  version: string,
  darName: string,
  network: string
): void {
  const lockKey = getDarLockKey(packageName, version, darName);
  const lock = loadDarsLock();

  // Only update if entry exists
  if (!lock.packages[lockKey]) {
    return;
  }

  const entry = lock.packages[lockKey];
  if (!entry.networks.includes(network)) {
    entry.networks.push(network);
    entry.networks.sort();
    saveDarsLock(lock);
    console.log(`📝 Recorded ${network} upload in dars.lock`);
  }
}
