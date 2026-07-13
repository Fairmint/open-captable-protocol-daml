#!/usr/bin/env node
/**
 * Synchronize a built DAR into dars/{package}/{version}/ and update dars.lock.
 *
 * Undeployed versions are mutable PR candidates. Live DevNet is the version authority, any recorded or exact-live DAR
 * is immutable, and superseded undeployed backups are pruned only after integrity and live-ID checks.
 *
 * Usage: tsx scripts/backup-dar.ts --package <name> --version <version>
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { applyBackupTransaction } from './dar-backup-transaction';
import { computeSha256, getDarsDir, loadDarsLock, type DarsLockEntry } from './dar-utils';
import { candidateDevnetNetworks, decideBackupMutation, planBackupRetention } from './dar-version-policy';
import { inspectPackageBackups, validateDevnetDarCandidate } from './devnet-dar-policy';
import { queryDevnetPackagePreferences } from './devnet-package-versions';
import { getAllPackages, getPackage, parsePackageArg, parseVersionArg } from './packages';

function printUsage(errorMessage?: string): never {
  if (errorMessage) console.error(`❌ ${errorMessage}\n`);
  console.error('Usage: tsx scripts/backup-dar.ts --package <name> --version <version>');
  console.error('\nPackages:');
  for (const pkg of getAllPackages()) {
    console.error(`  ${pkg.name}`);
  }
  process.exit(1);
}

function getSdkVersion(sourceDir: string): string {
  const damlYamlPath = path.join(__dirname, '..', sourceDir, 'daml.yaml');
  if (!fs.existsSync(damlYamlPath)) return 'unknown';

  try {
    const content = fs.readFileSync(damlYamlPath, 'utf-8');
    const parsed = yaml.parse(content);
    return parsed?.['sdk-version'] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function frozenVersionError(packageName: string, version: string): Error {
  return new Error(
    `${packageName} ${version} is immutable because its exact DAR is recorded on a network. ` +
      `Run npm run upgrade-package -- --package ${packageName} --type minor to select the live DevNet candidate version.`
  );
}

async function main(): Promise<void> {
  const packageArg = parsePackageArg();
  const version = parseVersionArg();

  if (!packageArg || !version) printUsage('Missing required arguments');

  const pkg = getPackage(packageArg);
  if (!pkg) printUsage(`Unknown package: ${packageArg}`);
  if (version !== pkg.version) {
    printUsage(`Requested version ${version} does not match ${pkg.name}/daml.yaml (${pkg.version})`);
  }

  const rootDir = path.join(__dirname, '..');
  const darsDir = getDarsDir();

  // Build paths
  const sourcePath = path.join(rootDir, pkg.sourceDir, '.daml', 'dist', `${pkg.darName}-${version}.dar`);
  const destDir = path.join(darsDir, pkg.name, version);
  const destPath = path.join(destDir, `${pkg.darName}.dar`);
  const lockKey = `${pkg.name}/${version}/${pkg.darName}.dar`;

  // Check source exists
  if (!fs.existsSync(sourcePath)) {
    console.error(`❌ Source DAR not found: ${sourcePath}`);
    console.error('   Run "npm run build" first');
    process.exit(1);
  }

  const lock = loadDarsLock();
  const sourceHash = computeSha256(sourcePath);
  const existed = Object.prototype.hasOwnProperty.call(lock.packages, lockKey);
  const existingEntry: DarsLockEntry | undefined = existed ? lock.packages[lockKey] : undefined;

  // Verify an existing backup before deciding whether it can be replaced.
  if (existingEntry) {
    if (!fs.existsSync(destPath)) {
      console.error(`❌ Lock entry exists but file missing: ${destPath}`);
      process.exit(1);
    }

    // Verify hash
    const storedHash = computeSha256(destPath);
    if (storedHash !== existingEntry.sha256) {
      console.error(`❌ Hash mismatch! File may have been modified.`);
      process.exit(1);
    }
  }

  // Query and validate even when the backup bytes already match. This turns unrecorded exact-live backups into durable
  // DevNet history and prevents a later branch from pruning or replacing them.
  const preferences = await queryDevnetPackagePreferences(pkg.name);
  const inspectedBackups = inspectPackageBackups(rootDir, lock, pkg.name);
  const validation = validateDevnetDarCandidate({
    repositoryRoot: rootDir,
    lock,
    packageName: pkg.name,
    packageVersion: version,
    candidateDarPath: sourcePath,
    preferences,
  });
  console.log(
    `✅ Live DevNet preflight passed for ${validation.candidatePackageId} (${validation.compatibilityBaselines.length} baseline(s))`
  );

  const retentionPlan = planBackupRetention(inspectedBackups, lockKey, preferences);
  const inspectedCurrent = inspectedBackups.find((backup) => backup.lockKey === lockKey);
  const currentIsExactLive = Boolean(
    inspectedCurrent &&
    candidateDevnetNetworks(preferences, inspectedCurrent.packageVersion, inspectedCurrent.packageId).length > 0
  );
  const effectiveExistingEntry =
    existingEntry && currentIsExactLive
      ? { ...existingEntry, networks: [...new Set([...existingEntry.networks, 'devnet'])] }
      : existingEntry;

  let mutation: ReturnType<typeof decideBackupMutation>;
  try {
    mutation = decideBackupMutation(effectiveExistingEntry, sourceHash);
  } catch {
    throw frozenVersionError(pkg.name, version);
  }

  let candidateWrite;
  if (mutation !== 'no-op') {
    const sourceStats = fs.statSync(sourcePath);
    candidateWrite = {
      lockKey,
      sourcePath,
      destPath,
      replaceExisting: mutation === 'replace',
      entry: {
        sha256: sourceHash,
        size: sourceStats.size,
        sdkVersion: getSdkVersion(pkg.sourceDir),
        uploadedAt: new Date().toISOString(),
        networks: candidateDevnetNetworks(preferences, version, validation.candidatePackageId),
      },
    };
  }

  applyBackupTransaction({ lock, retentionPlan, darsDir, candidateWrite });
  for (const key of retentionPlan.freezeKeys) console.log(`🔒 Recorded exact live DevNet backup: ${key}`);
  for (const key of retentionPlan.pruneKeys) console.log(`🧹 Pruned superseded undeployed backup: ${key}`);
  if (mutation === 'no-op') {
    console.log(`ℹ️  Backup already matches current build: ${lockKey}`);
    return;
  }

  console.log(`${existed ? '✅ Synchronized' : '✅ Backed up'}: ${lockKey}`);
  console.log(`   SHA256: ${sourceHash}`);
  console.log(`   Size: ${candidateWrite?.entry.size ?? 0} bytes`);
}

void main().catch((err: unknown) => {
  console.error('❌ Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
