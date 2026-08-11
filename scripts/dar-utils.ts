/**
 * Thin adapters over `@fairmint/canton-dev-tools/daml` for this repo's in-place layout (`{pkg}/.daml/dist/`, not
 * `generated/build/`).
 */

import * as path from 'node:path';
import {
  DarIntegrityError,
  computeSha256,
  findDarFiles,
  getBackedUpDarPath as sharedGetBackedUpDarPath,
  getDarLockKey,
  getDarsDir as sharedGetDarsDir,
  getFreshDarPath as sharedGetFreshDarPath,
  loadDarsLock as sharedLoadDarsLock,
  requireBackedUpDar as sharedRequireBackedUpDar,
  saveDarsLock as sharedSaveDarsLock,
  type DarsLock,
  type DarsLockEntry,
} from '@fairmint/canton-dev-tools/daml';

export { DarIntegrityError, computeSha256, findDarFiles, getDarLockKey };
export type { DarsLock, DarsLockEntry };

const ROOT_DIR = path.join(__dirname, '..');

/** Get the path to the dars directory. */
export function getDarsDir(): string {
  return sharedGetDarsDir(ROOT_DIR);
}

/** Load the dars.lock file. */
export function loadDarsLock(): DarsLock {
  return sharedLoadDarsLock(ROOT_DIR);
}

/** Save the dars.lock file. */
export function saveDarsLock(lock: DarsLock): void {
  sharedSaveDarsLock(ROOT_DIR, lock);
}

/**
 * Check if a backed-up DAR exists and return its path. Returns null if no backed-up DAR exists or file is missing.
 * Throws DarIntegrityError if the file exists but hash doesn't match.
 */
export function getBackedUpDarPath(packageName: string, version: string, darName: string): string | null {
  return sharedGetBackedUpDarPath(ROOT_DIR, packageName, version, darName);
}

/**
 * Get the path to a freshly built DAR under `{sourcePackageDir}/.daml/dist/`. `sourcePackageDir` is repo-relative (e.g.
 * `OpenCapTable-v34` or `pkg.sourceDir`).
 */
export function getFreshDarPath(sourcePackageDir: string, version: string, darName: string): string | null {
  return sharedGetFreshDarPath(ROOT_DIR, sourcePackageDir, version, darName);
}

/**
 * Require a backed-up DAR file to exist and be verified. Exits the process on integrity / missing-backup failures
 * (matches prior local script behavior for upload callers).
 */
export function requireBackedUpDar(packageName: string, version: string, darName: string): string {
  try {
    return sharedRequireBackedUpDar(ROOT_DIR, packageName, version, darName);
  } catch (error) {
    if (error instanceof DarIntegrityError) {
      console.error(`❌ ${error.message}`);
      console.error('   This is a security concern. Please investigate before proceeding.');
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ ${message}`);
    console.error(`   Run first: npm run backup-dar -- --package ${packageName} --version ${version}`);
    process.exit(1);
  }
}

/** @deprecated Prefer requireBackedUpDar. Falls back to a fresh build when no backup exists. */
export function getDarPath(packageName: string, version: string, darName: string): string {
  try {
    const backedUpPath = getBackedUpDarPath(packageName, version, darName);
    if (backedUpPath) {
      console.log(`📦 Using backed-up DAR: ${path.relative(ROOT_DIR, backedUpPath)}`);
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

  const freshPath = getFreshDarPath(packageName, version, darName);
  console.warn(`⚠️ No backed-up DAR found for ${packageName} v${version}`);
  console.warn(`   Using freshly built DAR from .daml/dist/`);
  console.warn(`   This behavior is deprecated. Please backup first.`);

  if (!freshPath) {
    console.error(`❌ DAR file not found under ${packageName}/.daml/dist/`);
    console.error('Run "npm run build" first to build the DAR.');
    process.exit(1);
  }

  return freshPath;
}
