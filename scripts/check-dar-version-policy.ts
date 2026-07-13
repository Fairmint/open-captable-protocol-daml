#!/usr/bin/env node

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { computeSha256, getDarLockKey, getDarsDir, loadDarsLock, type DarsLock } from './dar-utils';
import { assertHistoryRetention, assertPackagePolicy, getLockEntry, readDeploymentState } from './dar-version-policy';
import { requirePackageConfig } from './packages';

const ROOT = path.join(__dirname, '..');
const pkg = requirePackageConfig('ocp');

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function parseBase(): string | null {
  const args = process.argv.slice(2);
  if (args.length === 0) return null;
  if (args.length !== 2 || args[0] !== '--base')
    throw new Error('Usage: check-dar-version-policy.ts [--base <git-ref>]');
  return args[1];
}

function readLockAt(ref: string): DarsLock {
  git(['cat-file', '-e', `${ref}^{commit}`]);
  return JSON.parse(git(['show', `${ref}:dars/dars.lock`])) as DarsLock;
}

function packageInputsChanged(comparisonRef: string): boolean {
  const paths = git(['diff', '--name-only', comparisonRef, 'HEAD', '--']).split('\n').filter(Boolean);
  return paths.some(
    (file) =>
      file.startsWith(`${pkg.sourceDir}/`) ||
      file.startsWith(`dars/${pkg.name}/`) ||
      file === 'dars/dars.lock' ||
      file.startsWith('scripts/codegen/') ||
      file.startsWith('libs/splice/')
  );
}

function main(): void {
  const base = parseBase();
  const comparisonRef = base ? git(['merge-base', base, 'HEAD']) : null;
  if (comparisonRef && !packageInputsChanged(comparisonRef)) {
    console.log('✅ No deployable package inputs changed');
    return;
  }

  const lock = loadDarsLock();
  const key = getDarLockKey(pkg.name, pkg.version, pkg.darName);
  const entry = getLockEntry(lock, key);
  const backup = path.join(getDarsDir(), key);
  const built = path.join(ROOT, pkg.sourceDir, '.daml', 'dist', `${pkg.darName}-${pkg.version}.dar`);
  if (!entry || !fs.existsSync(backup)) throw new Error(`Current backup is missing (${key})`);
  if (fs.statSync(backup).size !== entry.size || computeSha256(backup) !== entry.sha256) {
    throw new Error(`Current backup does not match dars.lock (${key})`);
  }
  if (!fs.existsSync(built)) throw new Error(`Fresh build is missing (${path.relative(ROOT, built)})`);
  if (computeSha256(built) !== entry.sha256) throw new Error('Fresh build does not match committed backup');

  const state = readDeploymentState(ROOT);
  if (comparisonRef) assertHistoryRetention(readLockAt(comparisonRef), lock, state);
  assertPackagePolicy(lock, state, entry.sha256);
  console.log(`✅ ${pkg.name} v${pkg.version}`);
}

try {
  main();
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
