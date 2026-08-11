#!/usr/bin/env tsx
/**
 * Translate OCP's historic `--network` flag into canton-dev-tools deployment preflight.
 *
 * Usage: npm run check:dar-deployment -- --network <devnet|mainnet> [--package <sourceDir|ocp>]
 */

import { checkDarVersionPolicy } from '@fairmint/canton-dev-tools/daml';
import { getPackage, parseNetworkArg, parsePackageArg, printPackageUsage } from './packages';

function main(): void {
  const network = parseNetworkArg();
  if (!network) {
    printPackageUsage('run-check-dar-deployment.ts', 'Missing --network argument');
    process.exit(1);
  }

  const packageArg = parsePackageArg() ?? 'ocp';
  const pkg = getPackage(packageArg);
  if (!pkg) {
    printPackageUsage('run-check-dar-deployment.ts', `Unknown package: ${packageArg}`);
    process.exit(1);
  }

  try {
    checkDarVersionPolicy({
      rootDir: process.cwd(),
      base: 'origin/main',
      packageKey: pkg.sourceDir,
      deployment: network,
    });
  } catch (error) {
    console.error(`❌ DAR deployment check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
