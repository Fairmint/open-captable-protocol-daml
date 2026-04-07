#!/usr/bin/env tsx
/**
 * Validates the combined `lib/` after codegen: required bundled paths exist, Nft/Reference does not
 * reintroduce a circular require on root `index.js`, and Node can load `lib/index.js` (consumer smoke test).
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getErrorMessage } from './types';

const ROOT_DIR = path.join(__dirname, '..');
const LIB_DIR = path.join(ROOT_DIR, 'lib');

/** Paths that merged lib must include for Splice/Amulet + Nft bridge (regression: npm 0.2.146). */
const REQUIRED_RELATIVE_FILES = [
  'nft-api-v01-package-namespace.js',
  'nft-api-v01-package-namespace.d.ts',
  'Splice/Api/Token/MetadataV1/module.js',
  'Splice/Api/Token/HoldingV1/module.js',
  'DA/Set/Types/module.js',
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

  const badRequireSingle = "require('../../../../index.js')";
  const badRequireDouble = 'require("../../../../index.js")';
  const badFromSingle = "from '../../../../index.js'";
  const badFromDouble = 'from "../../../../index.js"';

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts')) {
        continue;
      }
      const text = fs.readFileSync(full, 'utf8');
      if (
        text.includes(badRequireSingle) ||
        text.includes(badRequireDouble) ||
        text.includes(badFromSingle) ||
        text.includes(badFromDouble)
      ) {
        throw new Error(
          `Circular import risk: ${path.relative(LIB_DIR, full)} still references root index.js; use nft-api-v01-package-namespace bridge`
        );
      }
    }
  };

  walk(refRoot);
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

function main(): void {
  console.log('🔍 Verifying merged lib/ layout and Node load...\n');

  if (!fs.existsSync(LIB_DIR)) {
    console.error('❌ lib/ not found. Run npm run codegen first.');
    process.exit(1);
  }

  try {
    assertRequiredFiles();
    assertNftReferenceDoesNotRequireRootIndex();
    assertNodeLoadsLibIndex();
    console.log('✅ Merged lib/ checks passed (files, no Nft/Reference→index cycle, Node require).');
  } catch (error) {
    console.error('❌ verify-merged-lib-runtime failed:', getErrorMessage(error));
    process.exit(1);
  }
}

main();
