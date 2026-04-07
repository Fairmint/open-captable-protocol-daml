#!/usr/bin/env node
/**
 * Backup a DAR file after mainnet upload. Copies from .daml/dist/ to dars/{package}/{version}/ and updates dars.lock.
 *
 * **Retention:** When bumping a package version, add the new backup with this script but **do not remove** prior
 * `dars/<package>/<oldVersion>/` trees that are already in the repo—keep historical DARs for audit, re-upload, and
 * debugging. See `dars/README.md`.
 *
 * Usage: tsx scripts/backup-dar.ts --package <name> --version <version> [--network <network>]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { computeSha256, getDarsDir, loadDarsLock, saveDarsLock, type DarsLockEntry } from './dar-utils';
import { PACKAGES, getPackage, parseNetworkArg, parsePackageArg, parseVersionArg } from './packages';

function printUsage(errorMessage?: string): never {
  if (errorMessage) console.error(`❌ ${errorMessage}\n`);
  console.error('Usage: tsx scripts/backup-dar.ts --package <name> --version <version> [--network <network>]');
  console.error('\nPackages:');
  for (const [, pkg] of Object.entries(PACKAGES)) {
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

function main() {
  const packageArg = parsePackageArg();
  const version = parseVersionArg();
  const network = parseNetworkArg();

  if (!packageArg || !version) printUsage('Missing required arguments');

  const pkg = getPackage(packageArg);
  if (!pkg) printUsage(`Unknown package: ${packageArg}`);

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

  // Already backed up?
  if (lockKey in lock.packages) {
    console.log(`ℹ️  Already backed up: ${lockKey}`);

    if (!fs.existsSync(destPath)) {
      console.error(`❌ Lock entry exists but file missing: ${destPath}`);
      process.exit(1);
    }

    // Verify hash
    const hash = computeSha256(destPath);
    if (hash !== lock.packages[lockKey].sha256) {
      console.error(`❌ Hash mismatch! File may have been modified.`);
      process.exit(1);
    }

    // Add network if specified
    if (network && !lock.packages[lockKey].networks.includes(network)) {
      lock.packages[lockKey].networks.push(network);
      lock.packages[lockKey].networks.sort();
      saveDarsLock(lock);
      console.log(`✅ Added network: ${network}`);
    }
    return;
  }

  // Create backup
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(sourcePath, destPath);

  const hash = computeSha256(destPath);
  const stats = fs.statSync(destPath);

  lock.packages[lockKey] = {
    sha256: hash,
    size: stats.size,
    sdkVersion: getSdkVersion(pkg.sourceDir),
    uploadedAt: new Date().toISOString(),
    networks: network ? [network] : [],
  };

  // Sort for consistent ordering
  const sorted: Record<string, DarsLockEntry> = {};
  Object.keys(lock.packages)
    .sort()
    .forEach((k) => {
      sorted[k] = lock.packages[k];
    });
  lock.packages = sorted;

  saveDarsLock(lock);

  console.log(`✅ Backed up: ${lockKey}`);
  console.log(`   SHA256: ${hash}`);
  console.log(`   Size: ${stats.size} bytes`);
}

try {
  main();
} catch (err) {
  console.error('❌ Error:', err);
  process.exit(1);
}
