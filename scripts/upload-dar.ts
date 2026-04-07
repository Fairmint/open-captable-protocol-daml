#!/usr/bin/env node
/**
 * Upload a DAR file to devnet or mainnet.
 *
 * Requires the DAR to be backed up first. If not backed up, the script will automatically run the backup process before
 * uploading.
 *
 * Usage: tsx scripts/upload-dar.ts --package <package> --network <network>
 */

import { execSync } from 'child_process';
import { getFreshDarPath, isDarBackedUp, recordNetworkUpload, requireBackedUpDar } from './dar-utils';
import { parseNetworkArg, parsePackageArg, printPackageUsage, requireNetwork, requirePackage } from './packages';
import { createLedgerJsonApiClient } from './utils';

/** Ensure the DAR is backed up before upload. If not backed up, automatically run the backup process. */
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

  // Upload to each provider independently so one unhealthy participant (e.g. devnet Intellect with no synchronizer)
  // does not block the other.
  const providers = ['intellect', '5n'] as const;
  const failures: { provider: string; message: string }[] = [];

  for (const provider of providers) {
    console.log(`  → ${provider}...`);
    try {
      const client = createLedgerJsonApiClient(network, provider);
      await client.uploadDarFile({ filePath: darPath });
      console.log(`    ✅ Done`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`    ⚠️  Failed: ${message}`);
      failures.push({ provider, message });
    }
  }

  if (failures.length === providers.length) {
    console.error(`\n❌ Upload failed on all providers:\n`);
    for (const { provider, message } of failures) {
      console.error(`   ${provider}: ${message}\n`);
    }
    process.exit(1);
  }

  if (failures.length > 0) {
    console.warn(`\n⚠️  Partial upload: ${failures.length} provider(s) failed; succeeded on others.\n`);
  }

  recordNetworkUpload(pkg.name, pkg.version, pkg.darName, network);
  console.log(`\n🎉 Upload complete\n`);
}

void main();
