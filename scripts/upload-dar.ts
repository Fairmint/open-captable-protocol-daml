#!/usr/bin/env node
/**
 * Upload a DAR file to devnet or mainnet.
 *
 * Requires the DAR to be backed up first. If not backed up, the script will
 * automatically run the backup process before uploading.
 *
 * Usage: tsx scripts/upload-dar.ts --package <package> --network <network>
 */

import { createLedgerJsonApiClient } from './utils';
import { isDarBackedUp, requireBackedUpDar, getFreshDarPath, recordNetworkUpload } from './dar-utils';
import { requireNetwork, requirePackage, printPackageUsage, parseNetworkArg, parsePackageArg } from './packages';
import { execSync } from 'child_process';

/**
 * Ensure the DAR is backed up before upload.
 * If not backed up, automatically run the backup process.
 */
function ensureDarBackedUp(packageName: string, version: string, darName: string): void {
  if (isDarBackedUp(packageName, version, darName)) {
    return;
  }

  // Check if fresh DAR exists to backup
  const freshPath = getFreshDarPath(packageName, version, darName);
  if (!freshPath) {
    console.error(`❌ No DAR found to backup`);
    console.error(`   Expected: ${packageName}/.daml/dist/${darName}-${version}.dar`);
    console.error(`   Run "npm run build" first to build the DAR.`);
    process.exit(1);
  }

  console.log(`📋 DAR not backed up yet, backing up first...\n`);

  try {
    execSync(`npm run backup-dar -- --package ${packageName} --version ${version}`, {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    console.log('');
  } catch {
    console.error(`\n❌ Failed to backup DAR`);
    process.exit(1);
  }
}

async function main() {
  // Validate args (show help if missing)
  if (!parsePackageArg() || !parseNetworkArg()) {
    printPackageUsage('upload-dar.ts');
    process.exit(1);
  }

  const pkg = requirePackage('upload-dar.ts');
  const network = requireNetwork('upload-dar.ts');

  console.log(`\n📦 Uploading ${pkg.name} v${pkg.version} to ${network}\n`);

  // Ensure DAR is backed up first (auto-backup if needed)
  ensureDarBackedUp(pkg.name, pkg.version, pkg.darName);

  // Now require the backed-up DAR (this verifies integrity)
  const darPath = requireBackedUpDar(pkg.name, pkg.version, pkg.darName);

  // Upload to both providers
  for (const provider of ['intellect', '5n'] as const) {
    console.log(`  → ${provider}...`);
    const client = createLedgerJsonApiClient(network, provider);
    await client.uploadDarFile({ filePath: darPath });
    console.log(`    ✅ Done`);
  }

  recordNetworkUpload(pkg.name, pkg.version, pkg.darName, network);
  console.log(`\n🎉 Upload complete\n`);
}

main();
