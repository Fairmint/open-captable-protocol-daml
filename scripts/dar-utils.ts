/** Shared utilities for DAR file management. Used by upload scripts and backup scripts. */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

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

/** Error thrown when DAR integrity verification fails. */
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

/** Get the path to the dars directory. */
export function getDarsDir(): string {
  return path.join(__dirname, '..', 'dars');
}

/** Load the dars.lock file. */
export function loadDarsLock(): DarsLock {
  const lockPath = path.join(getDarsDir(), 'dars.lock');

  if (!fs.existsSync(lockPath)) {
    return { version: 1, packages: {} };
  }

  const content = fs.readFileSync(lockPath, 'utf-8');

  try {
    const parsed = JSON.parse(content);

    // Validate basic structure
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.version !== 'number' ||
      typeof parsed.packages !== 'object' ||
      parsed.packages === null
    ) {
      throw new Error(`Invalid dars.lock format at ${lockPath}`);
    }

    return parsed as DarsLock;
  } catch (err: any) {
    console.error(`❌ Failed to parse dars.lock at ${lockPath}: ${err?.message ?? String(err)}`);
    throw new Error(`Corrupted dars.lock file. Please restore from backup or delete to reset.`);
  }
}

/** Save the dars.lock file. */
export function saveDarsLock(lock: DarsLock): void {
  const lockPath = path.join(getDarsDir(), 'dars.lock');
  const lockDir = path.dirname(lockPath);
  const tempPath = path.join(lockDir, `dars.lock.tmp-${process.pid}-${Date.now()}`);
  const data = `${JSON.stringify(lock, null, 2)}\n`;

  try {
    // Write to a temporary file first to avoid partial writes to the lock file
    fs.writeFileSync(tempPath, data);
    // Atomically replace the lock file with the temporary file
    fs.renameSync(tempPath, lockPath);
  } finally {
    // Best-effort cleanup if something went wrong before rename
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/** Compute SHA256 hash of a file. */
export function computeSha256(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256');
  hash.update(fileBuffer);
  return hash.digest('hex');
}

/** Get the lock key for a DAR file. Always uses forward slashes for consistency across platforms. */
export function getDarLockKey(packageName: string, version: string, darName: string): string {
  const key = path.join(packageName, version, `${darName}.dar`);
  return key.replace(/\\/g, '/');
}

/** Find all DAR files in a directory recursively. */
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
 * Check if a backed-up DAR exists and return its path. Returns null if no backed-up DAR exists or file is missing.
 * Throws DarIntegrityError if the file exists but hash doesn't match.
 */
export function getBackedUpDarPath(packageName: string, version: string, darName: string): string | null {
  const lockKey = getDarLockKey(packageName, version, darName);
  const lock = loadDarsLock();

  // Check if entry exists in lock file
  if (!(lockKey in lock.packages)) {
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

/** Get the path to a freshly built DAR file (from .daml/dist/). Returns the path if it exists, null otherwise. */
export function getFreshDarPath(packageName: string, version: string, darName: string): string | null {
  const rootDir = path.join(__dirname, '..');
  const freshPath = path.join(rootDir, packageName, '.daml', 'dist', `${darName}-${version}.dar`);
  return fs.existsSync(freshPath) ? freshPath : null;
}

/**
 * Require a backed-up DAR file to exist and be verified. This is the strict mode - it will NOT fall back to fresh
 * builds. Use this when you want to ensure the DAR has been properly backed up before proceeding.
 *
 * @throws Error if no backup exists
 * @throws DarIntegrityError if backup exists but hash doesn't match
 */
export function requireBackedUpDar(packageName: string, version: string, darName: string): string {
  const rootDir = path.join(__dirname, '..');

  try {
    const backedUpPath = getBackedUpDarPath(packageName, version, darName);
    if (backedUpPath) {
      console.log(`📦 Using backed-up DAR: ${path.relative(rootDir, backedUpPath)}`);
      return backedUpPath;
    }
  } catch (error) {
    if (error instanceof DarIntegrityError) {
      console.error(`❌ ${error.message}`);
      console.error('   This is a security concern. Please investigate before proceeding.');
      process.exit(1);
    }
    throw error;
  }

  // No backup found - fail with clear instructions
  console.error(`❌ DAR not backed up: ${packageName} v${version}`);
  console.error(`   Backups are required before upload to ensure reproducibility.`);
  console.error(`   Run first: npm run backup-dar -- --package ${packageName} --version ${version}`);
  process.exit(1);
}

/** Check if a DAR has been backed up. */
export function isDarBackedUp(packageName: string, version: string, darName: string): boolean {
  const lockKey = getDarLockKey(packageName, version, darName);
  const lock = loadDarsLock();
  if (!(lockKey in lock.packages)) return false;

  const darPath = path.join(getDarsDir(), lockKey);
  return fs.existsSync(darPath);
}

/**
 * @deprecated Use requireBackedUpDar instead to ensure backups are mandatory. Get the path to a DAR file, preferring
 *   backed-up version over fresh build. Returns the backed-up DAR path if available and verified, otherwise falls back
 *   to fresh build.
 */
export function getDarPath(packageName: string, version: string, darName: string): string {
  const rootDir = path.join(__dirname, '..');

  try {
    const backedUpPath = getBackedUpDarPath(packageName, version, darName);
    if (backedUpPath) {
      console.log(`📦 Using backed-up DAR: ${path.relative(rootDir, backedUpPath)}`);
      return backedUpPath;
    }
  } catch (error) {
    if (error instanceof DarIntegrityError) {
      console.error(`❌ ${error.message}`);
      console.error('   This is a security concern. Please investigate before proceeding.');
      process.exit(1);
    }
    throw error;
  }

  // Fall back to freshly built DAR (deprecated behavior)
  const freshPath = path.join(rootDir, packageName, '.daml', 'dist', `${darName}-${version}.dar`);
  console.warn(`⚠️ No backed-up DAR found for ${packageName} v${version}`);
  console.warn(`   Using freshly built DAR from .daml/dist/`);
  console.warn(`   This behavior is deprecated. Please backup first.`);

  if (!fs.existsSync(freshPath)) {
    console.error(`❌ DAR file not found: ${freshPath}`);
    console.error('Run "npm run build" first to build the DAR.');
    process.exit(1);
  }

  return freshPath;
}

/** Record that a DAR was uploaded to a specific network. Updates the networks array in dars.lock. */
export function recordNetworkUpload(packageName: string, version: string, darName: string, network: string): void {
  const lockKey = getDarLockKey(packageName, version, darName);
  const lock = loadDarsLock();

  // Only update if entry exists
  if (!(lockKey in lock.packages)) {
    console.log(`ℹ️ DAR not backed up yet, skipping network record for ${lockKey} (${network})`);
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
