#!/usr/bin/env node

/**
 * Backup DAR script
 * Copies a DAR file from .daml/dist/ to dars/{package}/{version}/ after mainnet upload.
 * Updates dars.lock with hash and metadata.
 *
 * Usage: tsx scripts/backup-dar.ts --package OpenCapTable-v25 --version 0.0.1
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import {
  loadDarsLock,
  saveDarsLock,
  computeSha256,
  getDarsDir,
  type DarsLockEntry,
} from './dar-utils';

interface PackageConfig {
  name: string;
  darName: string;
  sourceDir: string;
  damlYamlPath: string;
}

// Known package configurations
const PACKAGE_CONFIGS: Record<string, PackageConfig> = {
  'OpenCapTable-v25': {
    name: 'OpenCapTable-v25',
    darName: 'OpenCapTable-v25',
    sourceDir: 'OpenCapTable-v25',
    damlYamlPath: 'OpenCapTable-v25/daml.yaml',
  },
  'OpenCapTableReports-v01': {
    name: 'OpenCapTableReports-v01',
    darName: 'OpenCapTableReports-v01',
    sourceDir: 'OpenCapTableReports-v01',
    damlYamlPath: 'OpenCapTableReports-v01/daml.yaml',
  },
  CantonPayments: {
    name: 'CantonPayments',
    darName: 'CantonPayments',
    sourceDir: 'CantonPayments',
    damlYamlPath: 'CantonPayments/daml.yaml',
  },
};

function parseArgs(): { package: string; version: string; network?: string } {
  const args = process.argv.slice(2);
  let packageName: string | undefined;
  let version: string | undefined;
  let network: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--package' || args[i] === '-p') && args[i + 1]) {
      packageName = args[++i];
    } else if ((args[i] === '--version' || args[i] === '-v') && args[i + 1]) {
      version = args[++i];
    } else if ((args[i] === '--network' || args[i] === '-n') && args[i + 1]) {
      network = args[++i];
    }
  }

  if (!packageName || !version) {
    console.error('❌ Usage: tsx scripts/backup-dar.ts --package <name> --version <version> [--network <network>]');
    console.error('');
    console.error('Available packages:');
    Object.keys(PACKAGE_CONFIGS).forEach(pkg => console.error(`  - ${pkg}`));
    process.exit(1);
  }

  return { package: packageName, version, network };
}

function getSdkVersion(damlYamlPath: string): string {
  const rootDir = path.join(__dirname, '..');
  const fullPath = path.join(rootDir, damlYamlPath);

  if (!fs.existsSync(fullPath)) {
    console.warn(`⚠️ Could not find daml.yaml at ${fullPath}, using "unknown" for SDK version`);
    return 'unknown';
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const parsed = yaml.parse(content);
  return parsed['sdk-version'] || 'unknown';
}

async function main() {
  const { package: packageName, version, network } = parseArgs();
  const rootDir = path.join(__dirname, '..');
  const darsDir = getDarsDir();

  // Validate package
  const config = PACKAGE_CONFIGS[packageName];
  if (!config) {
    console.error(`❌ Unknown package: ${packageName}`);
    console.error('');
    console.error('Available packages:');
    Object.keys(PACKAGE_CONFIGS).forEach(pkg => console.error(`  - ${pkg}`));
    process.exit(1);
  }

  // Build paths
  const sourceDarPath = path.join(
    rootDir,
    config.sourceDir,
    '.daml',
    'dist',
    `${config.darName}-${version}.dar`
  );

  const destDir = path.join(darsDir, config.name, version);
  const destDarPath = path.join(destDir, `${config.darName}.dar`);
  const lockKey = `${config.name}/${version}/${config.darName}.dar`;

  // Check source DAR exists
  if (!fs.existsSync(sourceDarPath)) {
    console.error(`❌ Source DAR not found: ${sourceDarPath}`);
    console.error('');
    console.error('Make sure to build the DAML package first:');
    console.error('  npm run build');
    process.exit(1);
  }

  // Load current lock file
  const lock = loadDarsLock();

  // Check if DAR already backed up
  if (lock.packages[lockKey]) {
    console.log(`ℹ️ DAR already backed up: ${lockKey}`);

    // If network specified, add to networks list if not present
    if (network) {
      const existing = lock.packages[lockKey];
      if (!existing.networks.includes(network)) {
        existing.networks.push(network);
        existing.networks.sort();
        saveDarsLock(lock);
        console.log(`✅ Added network "${network}" to ${lockKey}`);
      } else {
        console.log(`ℹ️ Network "${network}" already recorded for ${lockKey}`);
      }
    }

    // Verify existing file matches
    if (fs.existsSync(destDarPath)) {
      const existingHash = computeSha256(destDarPath);
      if (existingHash !== lock.packages[lockKey].sha256) {
        console.error(`❌ Hash mismatch! Backed up DAR has been modified.`);
        console.error(`   Expected: ${lock.packages[lockKey].sha256}`);
        console.error(`   Found:    ${existingHash}`);
        process.exit(1);
      }
      console.log(`✅ Existing backup verified: ${lockKey}`);
    }

    return;
  }

  // Check if destination already exists (shouldn't happen if lock is consistent)
  if (fs.existsSync(destDarPath)) {
    console.error(`❌ DAR file already exists but not in dars.lock: ${destDarPath}`);
    console.error('This is an inconsistent state. Please verify manually.');
    process.exit(1);
  }

  // Create destination directory
  fs.mkdirSync(destDir, { recursive: true });

  // Copy DAR file
  console.log(`📦 Copying DAR from ${sourceDarPath}`);
  fs.copyFileSync(sourceDarPath, destDarPath);

  // Compute hash and get metadata
  const hash = computeSha256(destDarPath);
  const stats = fs.statSync(destDarPath);
  const sdkVersion = getSdkVersion(config.damlYamlPath);

  // Update lock file
  lock.packages[lockKey] = {
    sha256: hash,
    size: stats.size,
    sdkVersion,
    uploadedAt: new Date().toISOString(),
    networks: network ? [network] : [],
  };

  // Sort packages alphabetically for consistent ordering
  const sortedPackages: Record<string, DarsLockEntry> = {};
  Object.keys(lock.packages)
    .sort()
    .forEach(key => {
      sortedPackages[key] = lock.packages[key];
    });
  lock.packages = sortedPackages;

  saveDarsLock(lock);

  console.log(`✅ DAR backed up successfully!`);
  console.log(`   Destination: ${destDarPath}`);
  console.log(`   SHA256: ${hash}`);
  console.log(`   Size: ${stats.size} bytes`);
  console.log(`   SDK Version: ${sdkVersion}`);
  if (network) {
    console.log(`   Network: ${network}`);
  }
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
