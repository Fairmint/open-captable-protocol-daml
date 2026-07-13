import * as fs from 'fs';
import * as path from 'path';
import { assertSafeDarTreePath } from './dar-lfs-policy';

function assertInsideRoot(rootRealPath: string, filePath: string, label: string): void {
  const realPath = fs.realpathSync(filePath);
  if (!realPath.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new Error(`${label} resolves outside the candidate root: ${filePath}`);
  }
}

function assertDirectory(rootRealPath: string, directory: string): void {
  const stats = fs.lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Candidate DAR parent must be a non-symlink directory: ${directory}`);
  }
  assertInsideRoot(rootRealPath, directory, 'Candidate DAR parent');
}

/** Verify candidate DAR paths and every parent are real, non-symlink paths confined to the detached worktree. */
export function assertCandidateDarPaths(candidateRoot: string, darPaths: string[]): void {
  const rootStats = fs.lstatSync(candidateRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`Candidate root must be a non-symlink directory: ${candidateRoot}`);
  }
  const rootRealPath = fs.realpathSync(candidateRoot);
  const darsDirectory = path.join(candidateRoot, 'dars');
  assertDirectory(rootRealPath, darsDirectory);

  for (const darPath of darPaths) {
    assertSafeDarTreePath(darPath);
    const components = darPath.split('/');
    let currentPath = candidateRoot;
    for (const component of components.slice(0, -1)) {
      currentPath = path.join(currentPath, component);
      assertDirectory(rootRealPath, currentPath);
    }

    const absoluteDarPath = path.join(candidateRoot, ...components);
    const stats = fs.lstatSync(absoluteDarPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`Candidate DAR must be a non-symlink regular file: ${darPath}`);
    }
    assertInsideRoot(rootRealPath, absoluteDarPath, 'Candidate DAR');
  }
}
