#!/usr/bin/env tsx
/**
 * Resolve repo package keys (source dir / CLI alias) and delegate to canton-dev-tools backup-dar.
 *
 * Usage: npm run backup-dar -- --package <sourceDir> --version <version>
 *
 * Package names follow multi-package.yaml source directories (e.g. OpenCapTable-v34).
 */

import { execFileSync } from 'node:child_process';
import { getPackage, parsePackageArg, parseVersionArg, printPackageUsage } from './packages';

function main(): void {
  const packageArg = parsePackageArg();
  const version = parseVersionArg();
  if (!packageArg || !version) {
    printPackageUsage('run-backup-dar.ts', 'Missing --package or --version');
    process.exit(1);
  }

  const pkg = getPackage(packageArg);
  if (!pkg) {
    printPackageUsage('run-backup-dar.ts', `Unknown package: ${packageArg}`);
    process.exit(1);
  }

  execFileSync('npx', ['canton-dev-tools', 'backup-dar', '--package', pkg.sourceDir, '--version', version], {
    stdio: 'inherit',
  });
}

main();
