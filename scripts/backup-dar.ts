#!/usr/bin/env node
/** Replace the one undeployed candidate backup while preserving every deployed DAR. */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

import { computeSha256, getDarLockKey, getDarsDir, loadDarsLock, saveDarsLock } from './dar-utils';
import { planCandidateBackup, readDeploymentState } from './dar-version-policy';
import { getAllPackages, getPackage, parsePackageArg, parseVersionArg } from './packages';

function usage(message?: string): never {
  if (message) console.error(`❌ ${message}\n`);
  console.error('Usage: tsx scripts/backup-dar.ts --package <name> --version <version>');
  console.error(
    `Packages: ${getAllPackages()
      .map((pkg) => pkg.name)
      .join(', ')}`
  );
  process.exit(1);
}

function sdkVersion(sourceDir: string): string {
  const parsed = yaml.parse(fs.readFileSync(path.join(__dirname, '..', sourceDir, 'daml.yaml'), 'utf8')) as {
    'sdk-version'?: string;
  };
  return parsed['sdk-version'] ?? 'unknown';
}

/** Restore a missing/corrupt backup atomically, then verify both its hash and size. */
export function ensureBackupFile(source: string, destination: string, sha256: string, size: number): boolean {
  const valid =
    fs.existsSync(destination) && fs.statSync(destination).size === size && computeSha256(destination) === sha256;
  if (!valid) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.tmp-${process.pid}`;
    try {
      fs.copyFileSync(source, temporary);
      if (fs.statSync(temporary).size !== size || computeSha256(temporary) !== sha256) {
        throw new Error('Temporary DAR copy failed integrity verification');
      }
      fs.renameSync(temporary, destination);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  if (fs.statSync(destination).size !== size || computeSha256(destination) !== sha256) {
    throw new Error('Backed-up DAR failed integrity verification');
  }
  return !valid;
}

function main(): void {
  const packageArg = parsePackageArg();
  const version = parseVersionArg();
  if (!packageArg || !version) usage('Missing required arguments');
  const pkg = getPackage(packageArg);
  if (!pkg) usage(`Unknown package: ${packageArg}`);
  if (version !== pkg.version) usage(`daml.yaml is v${pkg.version}, not v${version}`);

  const root = path.join(__dirname, '..');
  const source = path.join(root, pkg.sourceDir, '.daml', 'dist', `${pkg.darName}-${version}.dar`);
  if (!fs.existsSync(source)) usage(`Source DAR not found: ${source}. Run npm run build first.`);

  const sha256 = computeSha256(source);
  const { size } = fs.statSync(source);
  const lock = loadDarsLock();
  const plan = planCandidateBackup(lock, readDeploymentState(root), sha256, size);
  const key = getDarLockKey(pkg.name, version, pkg.darName);
  const destination = path.join(getDarsDir(), key);
  const restored = ensureBackupFile(source, destination, sha256, size);

  if (plan.replace) {
    lock.packages[key] = {
      sha256,
      size,
      sdkVersion: sdkVersion(pkg.sourceDir),
      uploadedAt: new Date().toISOString(),
      networks: [],
    };
  }

  lock.packages = Object.fromEntries(
    Object.entries(lock.packages).sort(([left], [right]) => left.localeCompare(right))
  );
  saveDarsLock(lock);
  console.log(`${plan.replace || restored ? '✅ Backed up' : '✅ Verified'}: ${key}`);
  console.log(`   SHA256: ${sha256}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
