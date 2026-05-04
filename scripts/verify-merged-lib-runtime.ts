#!/usr/bin/env tsx
/**
 * Validates the combined `lib/` after codegen: required bundled paths exist, Nft/Reference does not reintroduce a
 * circular require on root `index.js`, and Node can load `lib/index.js` (consumer smoke test).
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { findNftReferenceFilesRequiringPackageRootIndex } from './nft-reference-bridge-rewrite';
import { getErrorMessage } from './types';

const ROOT_DIR = path.join(__dirname, '..');
const LIB_DIR = path.join(ROOT_DIR, 'lib');

/** Paths that merged lib must include for Splice/Amulet (OpenCapTable-v34 + inlined Shared). */
const REQUIRED_RELATIVE_FILES = [
  'Splice/Api/Token/MetadataV1/module.js',
  'Splice/Api/Token/HoldingV1/module.js',
  'DA/Set/Types/module.js',
  'openCapTableDarPath.js',
];

function assertRequiredFiles(): void {
  for (const rel of REQUIRED_RELATIVE_FILES) {
    const abs = path.join(LIB_DIR, rel);
    if (!fs.existsSync(abs)) {
      throw new Error(`Missing required file in merged lib: ${rel}`);
    }
  }
}

function assertNftReferenceDoesNotRequireRootIndex(): void {
  const refRoot = path.join(LIB_DIR, 'Nft', 'Reference');
  if (!fs.existsSync(refRoot)) {
    return;
  }
  const filesRequiringRootIndex = findNftReferenceFilesRequiringPackageRootIndex(refRoot);
  const firstBadFile = filesRequiringRootIndex[0];
  if (firstBadFile) {
    throw new Error(
      `Circular import risk: ${path.relative(LIB_DIR, firstBadFile)} still references root index.js; use nft-api-v01-package-namespace bridge`
    );
  }
}

function assertNodeLoadsLibIndex(): void {
  const result = spawnSync(process.execPath, ['-e', "require('./lib/index.js')"], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`Node could not require ./lib/index.js (exit ${result.status})\n${detail}`);
  }
}

/** Ensures `openCapTableDarPath` exists and root `index.js` does not pull `fs` (browser-safe entry). */
function assertOpenCapTableDarSubpathAndRootSeparation(): void {
  const snippet = `
    const m = require('./lib/openCapTableDarPath');
    if (typeof m.resolveOpenCapTableDarPath !== 'function') process.exit(2);
    if (typeof m.getOpenCapTableDarPath !== 'function') process.exit(3);
    if (m.OPEN_CAP_TABLE_DAR_PATH_ENV !== 'OPEN_CAP_TABLE_DAR_PATH') process.exit(4);
    const idx = require('./lib/index.js');
    if (typeof idx.resolveOpenCapTableDarPath !== 'undefined') process.exit(5);
    if (typeof idx.getOpenCapTableDarPath !== 'undefined') process.exit(6);
    if (!idx.OCP_TEMPLATES || !idx.OCP_TEMPLATES.capTable) process.exit(7);
    if (typeof idx.Nft !== 'undefined') process.exit(8);
    if (typeof idx.CantonPayments !== 'undefined') process.exit(9);
  `;
  const result = spawnSync(process.execPath, ['-e', snippet], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(
      `openCapTableDarPath / root index separation check failed (exit ${result.status})\nExpected lib/openCapTableDarPath.js; root index must omit DAR helpers (no fs in browser bundles).\n${detail}`
    );
  }
}

function main(): void {
  console.log('🔍 Verifying merged lib/ layout and Node load...\n');

  if (!fs.existsSync(LIB_DIR)) {
    console.error('❌ lib/ not found. Run npm run codegen first.');
    process.exit(1);
  }

  try {
    assertRequiredFiles();
    assertNftReferenceDoesNotRequireRootIndex();
    assertOpenCapTableDarSubpathAndRootSeparation();
    assertNodeLoadsLibIndex();
    console.log(
      '✅ Merged lib/ checks passed (files, no Nft/Reference→index cycle, DAR subpath vs root separation, Node require).'
    );
  } catch (error) {
    console.error('❌ verify-merged-lib-runtime failed:', getErrorMessage(error));
    process.exit(1);
  }
}

main();
