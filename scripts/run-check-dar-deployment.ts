#!/usr/bin/env tsx
/**
 * Translate OCP's historic `--network` flag into canton-dev-tools deployment preflight.
 *
 * Usage: npm run check:dar-deployment -- --network <devnet|mainnet> [--package <sourceDir|ocp>]
 */

import { execFileSync } from 'node:child_process';
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

  execFileSync(
    'npx',
    ['canton-dev-tools', 'check-dar-version-policy', '--package', pkg.sourceDir, '--deployment', network],
    { stdio: 'inherit' }
  );
}

main();
