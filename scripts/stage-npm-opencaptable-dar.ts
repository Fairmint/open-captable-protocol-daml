#!/usr/bin/env tsx
/**
 * Copy the built OpenCapTable DAR to a stable path for npm `exports` (`./opencaptable.dar`).
 *
 * Run automatically at the end of `npm run codegen` (after `npm run build` produces `.daml/dist`). The copied file is
 * gitignored; publish flows run codegen / package:prep so the tarball includes it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getPackage } from './packages';

const ROOT = path.join(__dirname, '..');

function main(): void {
  const pkg = getPackage('ocp');
  if (!pkg) {
    throw new Error('OpenCapTable (ocp) package config not found');
  }

  const builtDar = path.join(ROOT, pkg.sourceDir, '.daml', 'dist', `${pkg.darName}-${pkg.version}.dar`);
  const outDir = path.join(ROOT, 'published-dars');
  const outFile = path.join(outDir, 'OpenCapTable.dar');

  if (!fs.existsSync(builtDar)) {
    throw new Error(`Built DAR not found: ${builtDar}\nRun "npm run build" (or full codegen) first.`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(builtDar, outFile);
  console.log(`Staged npm DAR export: ${outFile}`);
}

main();
