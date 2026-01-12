/**
 * Shared utilities for DAR file management.
 * Used by upload scripts and backup scripts.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface DarsLockEntry {
  sha256: string;
  size: number;
  sdkVersion: string;
  uploadedAt: string;
  networks: string[];
}

interface DarsLock {
  version: number;
  packages: Record<string, DarsLockEntry>;
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
 * Check if a backed-up DAR exists and return its path.
 * Returns null if no backed-up DAR exists.
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

  // Verify hash
  const actualHash = computeSha256(darPath);
  const expectedHash = lock.packages[lockKey].sha256;
  if (actualHash !== expectedHash) {
    console.error(`❌ Hash mismatch for backed-up DAR: ${lockKey}`);
    console.error(`   Expected: ${expectedHash}`);
    console.error(`   Actual:   ${actualHash}`);
    console.error('   Falling back to fresh build.');
    return null;
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
