#!/usr/bin/env node
/** Validate detached-worktree DAR paths immediately before and after explicit Git LFS materialization. */

import { assertCandidateDarPaths } from './dar-candidate-path-policy';

function main(): void {
  const rootIndex = process.argv.indexOf('--root');
  const separatorIndex = process.argv.indexOf('--');
  const candidateRoot = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;
  if (!candidateRoot || separatorIndex < 0 || separatorIndex <= rootIndex) {
    throw new Error('Usage: tsx scripts/validate-candidate-dar-paths.ts --root <candidate-root> -- [dar-path ...]');
  }
  assertCandidateDarPaths(candidateRoot, process.argv.slice(separatorIndex + 1));
}

try {
  main();
} catch (error) {
  console.error(`Candidate DAR path validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
