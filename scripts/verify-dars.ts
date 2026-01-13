#!/usr/bin/env node

/**
 * Verify DAR integrity script Checks that all DAR files in dars/ match their recorded hashes in dars.lock. Used both
 * for manual verification and CI enforcement.
 *
 * Usage: tsx scripts/verify-dars.ts [--update]
 *
 * Options: --update Update dars.lock with current hashes (use with caution)
 */

import * as fs from 'fs';
import * as path from 'path';
import { computeSha256, findDarFiles, getDarsDir, loadDarsLock, saveDarsLock, type DarsLockEntry } from './dar-utils';

function parseArgs(): { update: boolean } {
  const args = process.argv.slice(2);
  return {
    update: args.includes('--update'),
  };
}

interface VerificationResult {
  verified: number;
  missing: number;
  mismatch: number;
  sizeMismatch: number;
  untracked: number;
  errors: string[];
}

function verifyDars(update: boolean): VerificationResult {
  const darsDir = getDarsDir();
  const lock = loadDarsLock();
  const darFiles = findDarFiles(darsDir);
  const checkedPaths = new Set<string>();

  const result: VerificationResult = {
    verified: 0,
    missing: 0,
    mismatch: 0,
    sizeMismatch: 0,
    untracked: 0,
    errors: [],
  };

  // Check each entry in dars.lock
  for (const [lockKey, entry] of Object.entries(lock.packages)) {
    const darPath = path.join(darsDir, lockKey);
    checkedPaths.add(darPath);

    if (!fs.existsSync(darPath)) {
      console.error(`❌ Missing DAR: ${lockKey}`);
      result.errors.push(`Missing DAR file: ${lockKey} (recorded in dars.lock but file not found)`);
      result.missing++;
      continue;
    }

    const actualHash = computeSha256(darPath);
    const actualStats = fs.statSync(darPath);

    if (actualHash !== entry.sha256) {
      console.error(`❌ Hash mismatch: ${lockKey}`);
      console.error(`   Expected: ${entry.sha256}`);
      console.error(`   Actual:   ${actualHash}`);
      result.errors.push(
        `Hash mismatch for ${lockKey}:\n` +
          `  Expected (dars.lock): ${entry.sha256}\n` +
          `  Actual (file):        ${actualHash}\n` +
          `  This DAR file has been modified without updating dars.lock!`
      );
      result.mismatch++;

      if (update) {
        console.log(`   📝 Updating hash in dars.lock`);
        entry.sha256 = actualHash;
        entry.size = actualStats.size;
      }
    } else if (actualStats.size !== entry.size) {
      console.warn(`⚠️ Size mismatch (hash matches): ${lockKey}`);
      console.warn(`   Expected: ${entry.size} bytes`);
      console.warn(`   Actual:   ${actualStats.size} bytes`);

      if (update) {
        console.log(`   📝 Updating size in dars.lock`);
        entry.size = actualStats.size;
      }
      result.sizeMismatch++;
      result.verified++;
    } else {
      console.log(`✅ ${lockKey}`);
      result.verified++;
    }
  }

  // Check for DAR files not in dars.lock
  for (const darPath of darFiles) {
    if (!checkedPaths.has(darPath)) {
      const relativePath = path.relative(darsDir, darPath).replace(/\\/g, '/');
      console.error(`❌ Untracked DAR: ${relativePath}`);
      result.errors.push(
        `Untracked DAR file: ${relativePath}\n` +
          `  This file exists in dars/ but is not recorded in dars.lock.\n` +
          `  Use 'npm run backup-dar' to properly add new DAR files.`
      );
      result.untracked++;

      if (update) {
        console.log(`   📝 Adding to dars.lock`);
        const hash = computeSha256(darPath);
        const stats = fs.statSync(darPath);
        lock.packages[relativePath] = {
          sha256: hash,
          size: stats.size,
          sdkVersion: 'unknown',
          uploadedAt: new Date().toISOString(),
          networks: [],
        };
      }
    }
  }

  // Save updates if requested and any changes were made
  if (update && (result.mismatch > 0 || result.sizeMismatch > 0 || result.untracked > 0)) {
    // Sort packages alphabetically
    const sortedPackages: Record<string, DarsLockEntry> = {};
    Object.keys(lock.packages)
      .sort()
      .forEach((key) => {
        sortedPackages[key] = lock.packages[key];
      });
    lock.packages = sortedPackages;

    saveDarsLock(lock);
    console.log('\n📝 dars.lock has been updated');
  }

  return result;
}

async function main() {
  const { update } = parseArgs();

  console.log('🔍 Verifying DAR file integrity...\n');

  const result = verifyDars(update);
  const hasErrors = result.errors.length > 0;
  const packageCount = result.verified + result.missing + result.mismatch;

  // Summary
  console.log('\n--- Summary ---');
  console.log(`Verified: ${result.verified}`);
  if (result.missing > 0) console.log(`Missing:  ${result.missing}`);
  if (result.mismatch > 0) console.log(`Mismatch: ${result.mismatch}`);
  if (result.sizeMismatch > 0) console.log(`Size fixed: ${result.sizeMismatch}`);
  if (result.untracked > 0) console.log(`Untracked: ${result.untracked}`);

  if (packageCount === 0 && !hasErrors) {
    console.log('\nℹ️ No DAR files backed up yet. This is OK for a fresh setup.');
    return;
  }

  if (hasErrors && !update) {
    console.error(`\n${'─'.repeat(60)}`);
    console.error(`\n❌ Verification failed with ${result.errors.length} error(s)\n`);
    console.error('To fix these issues:');
    console.error('  1. If changes were intentional, run: npm run backup-dar -- --package <name> --version <version>');
    console.error('  2. If changes were accidental, restore the original DAR files');
    console.error('  3. Never modify backed-up DAR files directly');
    console.error('  4. Run with --update to fix dars.lock (use with caution)\n');
    process.exit(1);
  }

  if (!hasErrors) {
    console.log('\n✅ All DAR files verified successfully!');
  }
}

main().catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
