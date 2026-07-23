#!/usr/bin/env tsx

import { access, mkdir, readFile, rm, symlink } from 'fs/promises';
import path from 'path';

const WORKSPACE_PACKAGE_NAME = '@fairmint/open-captable-protocol-daml-js';
const CANTON_SDK_PACKAGE_NAME = '@open-captable-protocol/canton';

async function findPackageRoot(entryPath: string, expectedName: string): Promise<string> {
  let current = path.dirname(entryPath);
  while (current !== path.dirname(current)) {
    try {
      const packageJson = JSON.parse(await readFile(path.join(current, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (packageJson.name === expectedName) return current;
    } catch {
      // Keep walking toward the filesystem root.
    }
    current = path.dirname(current);
  }
  throw new Error(`Could not locate installed package root for ${expectedName}`);
}

async function main(): Promise<void> {
  const workspaceRoot = path.resolve(__dirname, '..');
  await access(path.join(workspaceRoot, 'lib', 'index.js')).catch(() => {
    throw new Error('Branch-generated bindings are missing. Run npm run codegen before the LocalNet replay.');
  });

  const cantonSdkRoot = await findPackageRoot(require.resolve(CANTON_SDK_PACKAGE_NAME), CANTON_SDK_PACKAGE_NAME);
  const nestedPublishedBindings = path.join(cantonSdkRoot, 'node_modules', WORKSPACE_PACKAGE_NAME);
  const workspaceBindingLink = path.join(workspaceRoot, 'node_modules', WORKSPACE_PACKAGE_NAME);

  await Promise.all([
    rm(nestedPublishedBindings, { recursive: true, force: true }),
    rm(workspaceBindingLink, { recursive: true, force: true }),
  ]);
  await mkdir(path.dirname(workspaceBindingLink), { recursive: true });
  await symlink(workspaceRoot, workspaceBindingLink, 'dir');
  console.log('Configured the Canton SDK to use branch-generated OCP bindings.');
}

main().catch(() => {
  console.error('Failed to configure branch-generated OCP bindings.');
  process.exitCode = 1;
});
