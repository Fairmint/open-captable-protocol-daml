#!/usr/bin/env node

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { computeSha256, getDarLockKey, getDarsDir, loadDarsLock, type DarsLock } from './dar-utils';
import { assertHistoryRetention, assertPackagePolicy, getLockEntry, readDeploymentTags } from './dar-version-policy';
import { getAllPackages, type PackageConfig } from './packages';

const ROOT = path.join(__dirname, '..');
const OCP_SHARED_INPUTS = ['scripts/codegen/', 'libs/splice'];

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function parseMode(): { all: boolean; base?: string } {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const baseIndex = args.indexOf('--base');
  const base = baseIndex >= 0 ? args[baseIndex + 1] : undefined;
  if (all === Boolean(base) || (baseIndex >= 0 && !base)) {
    throw new Error('Use exactly one of --all or --base <git-ref>');
  }
  return { all, base };
}

function readLockAt(ref: string): DarsLock {
  git(['cat-file', '-e', `${ref}^{commit}`]);
  return JSON.parse(git(['show', `${ref}:dars/dars.lock`])) as DarsLock;
}

function changedPackages(base: string): PackageConfig[] {
  const mergeBase = git(['merge-base', base, 'HEAD']);
  const paths = git(['diff', '--name-only', mergeBase, '--']).split('\n').filter(Boolean);
  return getAllPackages().filter(
    (pkg) =>
      paths.some((file) => file.startsWith(`${pkg.sourceDir}/`) || file.startsWith(`dars/${pkg.name}/`)) ||
      paths.includes('dars/dars.lock') ||
      paths.some((file) => OCP_SHARED_INPUTS.some((input) => file.startsWith(input)))
  );
}

function checkPackage(pkg: PackageConfig, lock: DarsLock, baseLock?: DarsLock): void {
  const key = getDarLockKey(pkg.name, pkg.version, pkg.darName);
  const entry = getLockEntry(lock, key);
  const backup = path.join(getDarsDir(), key);
  const built = path.join(ROOT, pkg.sourceDir, '.daml', 'dist', `${pkg.darName}-${pkg.version}.dar`);
  if (!entry || !fs.existsSync(backup)) throw new Error(`${pkg.name}: current backup is missing (${key})`);
  const backupHash = computeSha256(backup);
  if (backupHash !== entry.sha256) throw new Error(`${pkg.name}: backup does not match dars.lock (${key})`);
  if (!fs.existsSync(built)) throw new Error(`${pkg.name}: build is missing (${path.relative(ROOT, built)})`);
  if (computeSha256(built) !== entry.sha256)
    throw new Error(`${pkg.name}: fresh build does not match committed backup`);

  const tags = readDeploymentTags(pkg, ROOT);
  if (baseLock) assertHistoryRetention(pkg, baseLock, lock, tags);
  assertPackagePolicy(pkg, lock, tags, entry.sha256);
  console.log(`✅ ${pkg.name} v${pkg.version}`);
}

function main(): void {
  const mode = parseMode();
  const lock = loadDarsLock();
  const packages = mode.all ? getAllPackages() : changedPackages(mode.base!);
  const baseLock = mode.base ? readLockAt(mode.base) : undefined;
  if (packages.length === 0) {
    console.log('✅ No deployable package inputs changed');
    return;
  }
  for (const pkg of packages) checkPackage(pkg, lock, baseLock);
}

try {
  main();
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
