#!/usr/bin/env node
/**
 * Upload a DAR file to devnet or mainnet.
 *
 * Usage: tsx scripts/upload-dar.ts --package <package> --network <network>
 */

import { createLedgerJsonApiClient } from './utils';
import { getDarPath, recordNetworkUpload } from './dar-utils';
import { requireNetwork, requirePackage, printPackageUsage, parseNetworkArg, parsePackageArg } from './packages';

async function main() {
  // Validate args (show help if missing)
  if (!parsePackageArg() || !parseNetworkArg()) {
    printPackageUsage('upload-dar.ts');
    process.exit(1);
  }

  const pkg = requirePackage('upload-dar.ts');
  const network = requireNetwork('upload-dar.ts');

  console.log(`\n📦 Uploading ${pkg.name} v${pkg.version} to ${network}\n`);

  const darPath = getDarPath(pkg.name, pkg.version, pkg.darName);

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
