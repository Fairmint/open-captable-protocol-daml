#!/usr/bin/env tsx
/**
 * Copy the built OpenCapTable DARs to stable paths for npm `exports`: OpenCapTable-v35 to `./opencaptable.dar`, and the
 * two packages it data-depends on to `./opencaptable-api.dar` and `./opencaptable-delivery-proof.dar`.
 *
 * Run automatically at the end of `npm run codegen` (after `npm run build` produces
 * `generated/build/<pkg>/.daml/dist`). The copied files are gitignored; publish flows run codegen / package:prep so the
 * tarball includes them.
 */

import * as fs from 'fs';
import * as path from 'path';
import { requirePackageConfig } from './packages';

const ROOT = path.join(__dirname, '..');

/** Package key (scripts/packages.ts) → file name under `published-dars/`, as package.json `exports` lists them. */
const STAGED_DARS: Array<[string, string]> = [
  ['ocp', 'OpenCapTable.dar'],
  ['api', 'OpenCapTableApi.dar'],
  ['deliveryProof', 'OpenCapTableDeliveryProof.dar'],
];

function main(): void {
  const outDir = path.join(ROOT, 'published-dars');
  fs.mkdirSync(outDir, { recursive: true });

  for (const [key, fileName] of STAGED_DARS) {
    const pkg = requirePackageConfig(key);
    const builtDar = path.join(ROOT, pkg.buildDir, '.daml', 'dist', `${pkg.darName}-${pkg.version}.dar`);
    if (!fs.existsSync(builtDar)) {
      throw new Error(`Built DAR not found: ${builtDar}\nRun "npm run build" (or full codegen) first.`);
    }
    const outFile = path.join(outDir, fileName);
    fs.copyFileSync(builtDar, outFile);
    console.log(`Staged npm DAR export: ${path.relative(ROOT, outFile)} (${pkg.name} ${pkg.version})`);
  }
}

main();
