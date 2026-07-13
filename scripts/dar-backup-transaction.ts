import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { computeSha256, saveDarsLock, type DarsLock, type DarsLockEntry } from './dar-utils';
import type { BackupRetentionPlan } from './dar-version-policy';

export interface CandidateBackupWrite {
  lockKey: string;
  sourcePath: string;
  destPath: string;
  entry: DarsLockEntry;
  replaceExisting: boolean;
}

interface BackupTransactionOptions {
  lock: DarsLock;
  retentionPlan: BackupRetentionPlan;
  darsDir: string;
  candidateWrite?: CandidateBackupWrite;
  /** Injectable only so transaction rollback can be tested without touching the repository lock. */
  saveLock?: (lock: DarsLock) => void;
}

interface StagedFile {
  originalPath: string;
  stagedPath: string;
}

function cloneLock(lock: DarsLock): DarsLock {
  return {
    version: lock.version,
    packages: Object.fromEntries(
      Object.entries(lock.packages).map(([key, entry]) => [key, { ...entry, networks: [...entry.networks] }])
    ),
  };
}

function sortLockPackages(lock: DarsLock): void {
  const sorted: Record<string, DarsLockEntry> = {};
  for (const key of Object.keys(lock.packages).sort()) sorted[key] = lock.packages[key];
  lock.packages = sorted;
}

function resolveLockPath(darsDir: string, lockKey: string): string {
  const darsRoot = path.resolve(darsDir);
  const filePath = path.resolve(darsRoot, lockKey);
  if (!filePath.startsWith(`${darsRoot}${path.sep}`)) {
    throw new Error(`Unsafe DAR lock key: ${lockKey}`);
  }
  return filePath;
}

function removeEmptyParentDirectories(filePath: string, darsDir: string): void {
  const darsRoot = path.resolve(darsDir);
  let directory = path.dirname(filePath);
  while (directory.startsWith(`${darsRoot}${path.sep}`) && directory !== darsRoot) {
    try {
      fs.rmdirSync(directory);
      directory = path.dirname(directory);
    } catch {
      return;
    }
  }
}

function assertCandidateWrite(candidateWrite: CandidateBackupWrite, darsDir: string, lock: DarsLock): void {
  const expectedDestPath = resolveLockPath(darsDir, candidateWrite.lockKey);
  if (path.resolve(candidateWrite.destPath) !== expectedDestPath) {
    throw new Error(`Candidate destination does not match its lock key: ${candidateWrite.lockKey}`);
  }
  const sourceStats = fs.lstatSync(candidateWrite.sourcePath);
  if (!sourceStats.isFile()) {
    throw new Error(`Refusing non-regular candidate DAR: ${candidateWrite.sourcePath}`);
  }
  if (sourceStats.size !== candidateWrite.entry.size) {
    throw new Error(
      `Candidate DAR has size ${sourceStats.size}; transaction entry requires ${candidateWrite.entry.size}.`
    );
  }
  const sourceHash = computeSha256(candidateWrite.sourcePath);
  if (sourceHash !== candidateWrite.entry.sha256) {
    throw new Error(
      `Candidate DAR has SHA256 ${sourceHash}; transaction entry requires ${candidateWrite.entry.sha256}.`
    );
  }

  const hasEntry = Object.prototype.hasOwnProperty.call(lock.packages, candidateWrite.lockKey);
  const hasFile = fs.existsSync(candidateWrite.destPath);
  if (candidateWrite.replaceExisting) {
    if (!hasEntry || !hasFile) {
      throw new Error(`Cannot replace missing candidate backup: ${candidateWrite.lockKey}`);
    }
  } else if (hasEntry || hasFile) {
    throw new Error(`Cannot create candidate backup over existing state: ${candidateWrite.lockKey}`);
  }
}

function assertFileMatchesEntry(filePath: string, entry: DarsLockEntry): void {
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.size !== entry.size || computeSha256(filePath) !== entry.sha256) {
    throw new Error(`Staged candidate DAR does not match its transaction entry: ${filePath}`);
  }
}

/**
 * Apply candidate replacement, live-marker updates, pruning, and the lock update as one rollback-capable operation. The
 * lock is saved only after every new filesystem state has been installed. If that save fails, all DAR paths are
 * restored before the error escapes.
 */
export function applyBackupTransaction(options: BackupTransactionOptions): void {
  const { lock, retentionPlan, darsDir, candidateWrite, saveLock = saveDarsLock } = options;
  if (retentionPlan.freezeKeys.length === 0 && retentionPlan.pruneKeys.length === 0 && candidateWrite === undefined) {
    return;
  }

  if (candidateWrite) assertCandidateWrite(candidateWrite, darsDir, lock);
  if (candidateWrite && retentionPlan.pruneKeys.includes(candidateWrite.lockKey)) {
    throw new Error(`Cannot prune and write the same candidate backup: ${candidateWrite.lockKey}`);
  }

  for (const key of retentionPlan.freezeKeys) {
    if (!Object.prototype.hasOwnProperty.call(lock.packages, key)) {
      throw new Error(`Cannot freeze missing lock entry: ${key}`);
    }
  }
  for (const key of retentionPlan.pruneKeys) {
    if (!Object.prototype.hasOwnProperty.call(lock.packages, key)) {
      throw new Error(`Cannot prune missing lock entry: ${key}`);
    }
    const prunePath = resolveLockPath(darsDir, key);
    if (!fs.existsSync(prunePath)) throw new Error(`Cannot prune missing DAR backup: ${key}`);
  }

  const nextLock = cloneLock(lock);
  for (const key of retentionPlan.freezeKeys) {
    const { networks } = nextLock.packages[key];
    if (!networks.includes('devnet')) networks.push('devnet');
    networks.sort();
  }
  for (const key of retentionPlan.pruneKeys) delete nextLock.packages[key];
  if (candidateWrite) nextLock.packages[candidateWrite.lockKey] = candidateWrite.entry;
  sortLockPackages(nextLock);

  const transactionId = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  const stagedPrunes: StagedFile[] = [];
  let stagedCandidatePath: string | undefined;
  let previousCandidatePath: string | undefined;
  let candidateInstalled = false;

  try {
    if (candidateWrite) {
      fs.mkdirSync(path.dirname(candidateWrite.destPath), { recursive: true });
      stagedCandidatePath = `${candidateWrite.destPath}.candidate-${transactionId}`;
      fs.copyFileSync(candidateWrite.sourcePath, stagedCandidatePath, fs.constants.COPYFILE_EXCL);
      assertFileMatchesEntry(stagedCandidatePath, candidateWrite.entry);
    }

    for (const key of retentionPlan.pruneKeys) {
      const originalPath = resolveLockPath(darsDir, key);
      const stagedPath = `${originalPath}.prune-${transactionId}`;
      fs.renameSync(originalPath, stagedPath);
      stagedPrunes.push({ originalPath, stagedPath });
    }

    if (candidateWrite && stagedCandidatePath) {
      if (candidateWrite.replaceExisting) {
        previousCandidatePath = `${candidateWrite.destPath}.previous-${transactionId}`;
        fs.renameSync(candidateWrite.destPath, previousCandidatePath);
      }
      fs.renameSync(stagedCandidatePath, candidateWrite.destPath);
      stagedCandidatePath = undefined;
      candidateInstalled = true;
    }

    saveLock(nextLock);
    lock.version = nextLock.version;
    lock.packages = nextLock.packages;
  } catch (error) {
    const rollbackErrors: string[] = [];
    if (candidateInstalled && candidateWrite) {
      try {
        fs.unlinkSync(candidateWrite.destPath);
      } catch (rollbackError) {
        rollbackErrors.push(`remove candidate: ${String(rollbackError)}`);
      }
    }
    if (previousCandidatePath && candidateWrite && fs.existsSync(previousCandidatePath)) {
      try {
        fs.renameSync(previousCandidatePath, candidateWrite.destPath);
      } catch (rollbackError) {
        rollbackErrors.push(`restore candidate: ${String(rollbackError)}`);
      }
    }
    for (const { originalPath, stagedPath } of [...stagedPrunes].reverse()) {
      if (!fs.existsSync(stagedPath)) continue;
      try {
        fs.renameSync(stagedPath, originalPath);
      } catch (rollbackError) {
        rollbackErrors.push(`restore ${originalPath}: ${String(rollbackError)}`);
      }
    }
    if (stagedCandidatePath && fs.existsSync(stagedCandidatePath)) {
      try {
        fs.unlinkSync(stagedCandidatePath);
      } catch (rollbackError) {
        rollbackErrors.push(`remove staged candidate: ${String(rollbackError)}`);
      }
    }
    if (candidateWrite) removeEmptyParentDirectories(candidateWrite.destPath, darsDir);

    if (rollbackErrors.length > 0) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} Rollback also failed: ${rollbackErrors.join('; ')}`
      );
    }
    throw error;
  }

  const cleanupFiles = [
    ...stagedPrunes.map(({ originalPath, stagedPath }) => ({ originalPath, stagedPath })),
    ...(previousCandidatePath && candidateWrite
      ? [{ originalPath: candidateWrite.destPath, stagedPath: previousCandidatePath }]
      : []),
  ];
  for (const { originalPath, stagedPath } of cleanupFiles) {
    try {
      fs.unlinkSync(stagedPath);
      removeEmptyParentDirectories(originalPath, darsDir);
    } catch (error) {
      console.warn(
        `Retention transaction committed, but staged file cleanup failed for ${stagedPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
