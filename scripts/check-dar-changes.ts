#!/usr/bin/env node

/**
 * Check DAR changes script
 * CI script to detect unauthorized modifications to DAR files.
 * Fails if any DAR file was changed without a corresponding dars.lock update.
 *
 * Usage: tsx scripts/check-dar-changes.ts
 *
 * This script is designed to run in CI to prevent accidental DAR modifications.
 * It checks:
 * 1. All DAR files in dars/ have corresponding entries in dars.lock
 * 2. All hashes in dars.lock match the actual DAR files
 * 3. No DAR files are missing from the repository
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadDarsLock, computeSha256, getDarsDir, findDarFiles } from './dar-utils';

interface CheckResult {
  errors: string[];
  warnings: string[];
}

function checkDarIntegrity(): CheckResult {
  const darsDir = getDarsDir();
  const errors: string[] = [];
  const warnings: string[] = [];

  const lock = loadDarsLock();
  const darFiles = findDarFiles(darsDir);
  const checkedPaths = new Set<string>();

  // Check each entry in dars.lock exists and matches
  for (const [lockKey, entry] of Object.entries(lock.packages)) {
    const darPath = path.join(darsDir, lockKey);
    checkedPaths.add(darPath);

    if (!fs.existsSync(darPath)) {
      errors.push(`Missing DAR file: ${lockKey} (recorded in dars.lock but file not found)`);
      continue;
    }

    const actualHash = computeSha256(darPath);
    if (actualHash !== entry.sha256) {
      errors.push(
        `Hash mismatch for ${lockKey}:\n` +
          `  Expected (dars.lock): ${entry.sha256}\n` +
          `  Actual (file):        ${actualHash}\n` +
          `  This DAR file has been modified without updating dars.lock!`
      );
    }
  }

  // Check for DAR files not in dars.lock
  for (const darPath of darFiles) {
    if (!checkedPaths.has(darPath)) {
      const relativePath = path.relative(darsDir, darPath);
      errors.push(
        `Untracked DAR file: ${relativePath}\n` +
          `  This file exists in dars/ but is not recorded in dars.lock.\n` +
          `  Use 'npm run backup-dar' to properly add new DAR files.`
      );
    }
  }

  return { errors, warnings };
}

async function main() {
  console.log('🔍 Checking for unauthorized DAR changes...\n');

  const { errors, warnings } = checkDarIntegrity();

  // Print warnings
  for (const warning of warnings) {
    console.warn(`⚠️ ${warning}\n`);
  }

  // Print errors
  for (const error of errors) {
    console.error(`❌ ${error}\n`);
  }

  // Summary
  const lock = loadDarsLock();
  const packageCount = Object.keys(lock.packages).length;

  if (packageCount === 0 && errors.length === 0) {
    console.log('ℹ️ No DAR files backed up yet. This is OK for a fresh setup.\n');
  }

  if (errors.length > 0) {
    console.error('─'.repeat(60));
    console.error(`\n❌ Check failed with ${errors.length} error(s)\n`);
    console.error('To fix these issues:');
    console.error('  1. If changes were intentional, run: npm run backup-dar -- --package <name> --version <version>');
    console.error('  2. If changes were accidental, restore the original DAR files');
    console.error('  3. Never modify backed-up DAR files directly\n');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log(`\n⚠️ Check passed with ${warnings.length} warning(s)`);
  } else if (packageCount > 0) {
    console.log(`✅ All ${packageCount} DAR file(s) verified successfully!`);
  }
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
