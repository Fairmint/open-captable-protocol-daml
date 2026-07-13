#!/usr/bin/env node
/** Inspect a verified PR commit and emit only safe, bounded DAR paths for `git lfs fetch --include`. */

import { execFileSync } from 'child_process';
import { validateDarLfsTree, type DarTreeBlob } from './dar-lfs-policy';

function parseCommitArg(): string {
  const index = process.argv.indexOf('--commit');
  const commit = index >= 0 ? process.argv[index + 1] : undefined;
  if (!commit || !/^[0-9a-f]{40,64}$/.test(commit)) {
    throw new Error('Usage: tsx scripts/validate-pr-dar-lfs.ts --commit <verified-commit-sha>');
  }
  return commit;
}

function readDarTree(commit: string): DarTreeBlob[] {
  const raw = execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', commit, '--', 'dars'], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const entries: DarTreeBlob[] = [];
  for (const record of raw.split('\0')) {
    if (!record) continue;
    const separator = record.indexOf('\t');
    const metadata = separator >= 0 ? record.slice(0, separator) : '';
    const treePath = separator >= 0 ? record.slice(separator + 1) : '';
    const metadataParts = metadata.split(' ');
    if (metadataParts.length !== 3 || metadataParts.some((part) => !part) || !treePath) {
      throw new Error(`Unable to parse DAR tree entry from ${commit}`);
    }
    const [mode, type, oid] = metadataParts;
    if (!treePath.endsWith('.dar')) continue;
    if (entries.length >= 250) throw new Error('PR tree contains more than 250 DARs');

    const blobSize = Number(execFileSync('git', ['cat-file', '-s', oid], { encoding: 'utf8', maxBuffer: 1024 }).trim());
    if (!Number.isSafeInteger(blobSize) || blobSize < 0 || blobSize > 512) {
      throw new Error(`DAR pointer Git blob is not small and canonical: ${treePath}`);
    }
    const blob = execFileSync('git', ['cat-file', 'blob', oid], {
      encoding: 'utf8',
      maxBuffer: 1024,
    });
    entries.push({ blob, mode, path: treePath, type });
  }
  return entries;
}

function main(): void {
  const commit = parseCommitArg();
  const pointers = validateDarLfsTree(readDarTree(commit));
  process.stderr.write(
    `Validated ${pointers.length} DAR LFS pointer(s), ${pointers.reduce((total, item) => total + item.size, 0)} bytes declared.\n`
  );
  process.stdout.write(pointers.map(({ path }) => path).join(','));
}

try {
  main();
} catch (error) {
  console.error(`DAR LFS validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
