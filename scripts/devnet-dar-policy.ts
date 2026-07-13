import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { assertContainedRegularFile } from './candidate-path-safety';
import { assertDarArchiveSafe, DAML_UPGRADE_CHECK_TIMEOUT_MS } from './dar-archive-policy';
import type { DarsLock } from './dar-utils';
import { computeSha256 } from './dar-utils';
import { inspectDarPackageId } from './dar-package-id';
import {
  assertDevnetPreferencesConsistent,
  decideDevnetCandidateVersion,
  uniqueDevnetBaselines,
} from './dar-version-policy';
import type { DevnetPackagePreference } from './devnet-package-versions';

const MAX_DAR_SIZE_BYTES = 100 * 1024 * 1024;

export interface DevnetDarValidationResult {
  candidatePackageId: string;
  expectedVersion: string;
  highestDevnetVersion: string | null;
  compatibilityBaselines: Array<{
    packageId: string;
    packageVersion: string;
    darPath: string;
  }>;
}

export interface InspectedDarBackup {
  lockKey: string;
  darPath: string;
  packageId: string;
  packageVersion: string;
  entry: DarsLock['packages'][string];
}

interface ValidateDevnetDarOptions {
  repositoryRoot: string;
  lock: DarsLock;
  packageName: string;
  packageVersion: string;
  candidateDarPath: string;
  expectedCandidateSha256?: string;
  preferences: DevnetPackagePreference[];
  /** Mainnet uploads require the exact candidate to be preferred by both DevNet providers. */
  requireExactOnProviderCount?: number;
}

function assertRegularDar(repositoryRoot: string, filePath: string): fs.Stats {
  return assertContainedRegularFile(repositoryRoot, filePath, 'DAR', MAX_DAR_SIZE_BYTES);
}

function resolveLockDarPath(repositoryRoot: string, lockKey: string): string {
  const darsRoot = path.resolve(repositoryRoot, 'dars');
  const darPath = path.resolve(darsRoot, lockKey);
  if (!darPath.startsWith(`${darsRoot}${path.sep}`)) {
    throw new Error(`Unsafe DAR lock key: ${lockKey}`);
  }
  return darPath;
}

export function verifyLockedDar(repositoryRoot: string, lock: DarsLock, lockKey: string): string {
  if (!Object.prototype.hasOwnProperty.call(lock.packages, lockKey)) {
    throw new Error(`Missing dars.lock entry: ${lockKey}`);
  }
  const entry = lock.packages[lockKey];
  const darPath = resolveLockDarPath(repositoryRoot, lockKey);
  if (!fs.existsSync(darPath)) throw new Error(`Missing DAR backup: ${lockKey}`);
  const actualSize = assertRegularDar(repositoryRoot, darPath).size;
  if (actualSize !== entry.size) {
    throw new Error(`DAR backup ${lockKey} has size ${actualSize}; dars.lock requires ${entry.size}`);
  }
  const actualHash = computeSha256(darPath);
  if (actualHash !== entry.sha256) {
    throw new Error(`DAR backup ${lockKey} has SHA256 ${actualHash}; dars.lock requires ${entry.sha256}`);
  }
  return darPath;
}

/** Integrity-check and identify every backup for an exact package name before retention mutates anything. */
export function inspectPackageBackups(
  repositoryRoot: string,
  lock: DarsLock,
  packageName: string
): InspectedDarBackup[] {
  const backups: InspectedDarBackup[] = [];
  for (const [lockKey, entry] of Object.entries(lock.packages)) {
    const parts = lockKey.split('/');
    if (parts[0] !== packageName) continue;
    if (parts.length !== 3 || !parts[1] || !parts[2]) {
      throw new Error(`Invalid DAR lock key for ${packageName}: ${lockKey}`);
    }
    const packageVersion = parts[1];
    const darPath = verifyLockedDar(repositoryRoot, lock, lockKey);
    const packageId = inspectDarPackageId(darPath, packageName, packageVersion);
    backups.push({ lockKey, darPath, packageId, packageVersion, entry });
  }
  return backups;
}

export function findBaselineDar(
  repositoryRoot: string,
  lock: DarsLock,
  preference: DevnetPackagePreference,
  candidatePackageId: string,
  candidateDarPath: string,
  inspectPackageId: typeof inspectDarPackageId = inspectDarPackageId
): string {
  if (preference.packageId === candidatePackageId) return candidateDarPath;

  const candidateEntries = Object.keys(lock.packages).filter((lockKey) => {
    const [packageName, packageVersion] = lockKey.split('/');
    return packageName === preference.packageName && packageVersion === preference.packageVersion;
  });

  for (const lockKey of candidateEntries) {
    const darPath = verifyLockedDar(repositoryRoot, lock, lockKey);
    const packageId = inspectPackageId(darPath, preference.packageName, preference.packageVersion);
    if (packageId === preference.packageId) return darPath;
  }

  throw new Error(
    `The exact DevNet baseline ${preference.packageName} ${preference.packageVersion} (${preference.packageId}) is missing from dars/. Restore that deployed DAR before changing the package.`
  );
}

function runUpgradeCheck(oldDar: string, newDar: string, label: string): void {
  assertDarArchiveSafe(oldDar);
  assertDarArchiveSafe(newDar);
  try {
    execFileSync('dpm', ['upgrade-check', '--both', oldDar, newDar], {
      encoding: 'utf8',
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: DAML_UPGRADE_CHECK_TIMEOUT_MS,
      env: { ...process.env, PATH: `${process.env.HOME}/.dpm/bin:${process.env.PATH}` },
    });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    const output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`.trim();
    throw new Error(
      `dpm upgrade-check --both failed from ${label}.${output ? `\n${output}` : ` ${failure.message ?? ''}`}`
    );
  }
}

/** Validate one candidate against the exact preferred package on every DevNet provider. */
export function validateDevnetDarCandidate(options: ValidateDevnetDarOptions): DevnetDarValidationResult {
  const {
    repositoryRoot,
    lock,
    packageName,
    packageVersion,
    candidateDarPath,
    expectedCandidateSha256,
    preferences,
    requireExactOnProviderCount,
  } = options;

  assertRegularDar(repositoryRoot, candidateDarPath);
  if (expectedCandidateSha256) {
    const actualHash = computeSha256(candidateDarPath);
    if (actualHash !== expectedCandidateSha256) {
      throw new Error(`Candidate DAR has SHA256 ${actualHash}; dars.lock requires ${expectedCandidateSha256}.`);
    }
  }
  assertDevnetPreferencesConsistent(preferences);
  const candidatePackageId = inspectDarPackageId(candidateDarPath, packageName, packageVersion);
  const decision = decideDevnetCandidateVersion(preferences, candidatePackageId);

  if (packageVersion !== decision.expectedVersion) {
    const liveDescription =
      preferences.length === 0
        ? 'absent on both DevNet providers'
        : preferences
            .map((preference) => `${preference.provider}=${preference.packageVersion} (${preference.packageId})`)
            .join(', ');
    throw new Error(
      `${packageName} candidate ${packageVersion} (${candidatePackageId}) must use ${decision.expectedVersion}; DevNet is ${liveDescription}.`
    );
  }

  if (requireExactOnProviderCount !== undefined) {
    const exactPreferences = preferences.filter((preference) => preference.packageId === candidatePackageId);
    if (exactPreferences.length !== requireExactOnProviderCount) {
      throw new Error(
        `${packageName} ${packageVersion} must be the exact preferred package on all ${requireExactOnProviderCount} DevNet providers before a Mainnet upload.`
      );
    }
  }

  const uniquePreferences = uniqueDevnetBaselines(preferences);
  const compatibilityBaselines = uniquePreferences.map((preference) => ({
    packageId: preference.packageId,
    packageVersion: preference.packageVersion,
    darPath: findBaselineDar(repositoryRoot, lock, preference, candidatePackageId, candidateDarPath),
  }));

  for (const baseline of compatibilityBaselines) {
    if (baseline.packageId === candidatePackageId) continue;
    runUpgradeCheck(
      baseline.darPath,
      candidateDarPath,
      `${packageName} ${baseline.packageVersion} (${baseline.packageId})`
    );
  }

  return {
    candidatePackageId,
    expectedVersion: decision.expectedVersion,
    highestDevnetVersion: decision.highestDevnetVersion,
    compatibilityBaselines,
  };
}
