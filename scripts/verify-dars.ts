#!/usr/bin/env node

/**
 * Verify DAR integrity script
 * Checks that all DAR files in dars/ match their recorded hashes in dars.lock.
 *
 * Usage: tsx scripts/verify-dars.ts [--update]
 *
 * Options:
 *   --update  Update dars.lock with current hashes (use with caution)
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadDarsLock,
  saveDarsLock,
  computeSha256,
  getDarsDir,
  findDarFiles,
  type DarsLockEntry,
} from './dar-utils';

function parseArgs(): { update: boolean } {
  const args = process.argv.slice(2);
  return {
    update: args.includes('--update'),
  };
}

async function main() {
  const { update } = parseArgs();
  const darsDir = getDarsDir();

  console.log('🔍 Verifying DAR file integrity...\n');

  const lock = loadDarsLock();
  const darFiles = findDarFiles(darsDir);

  let hasErrors = false;
  let checkedCount = 0;
  let missingCount = 0;
  let mismatchCount = 0;
  let unknownCount = 0;

  // Check each entry in dars.lock
  for (const [lockKey, entry] of Object.entries(lock.packages)) {
    const darPath = path.join(darsDir, lockKey);

    if (!fs.existsSync(darPath)) {
      console.error(`❌ Missing DAR: ${lockKey}`);
      console.error(`   Expected at: ${darPath}`);
      missingCount++;
      hasErrors = true;
      continue;
    }

    const actualHash = computeSha256(darPath);
    const actualStats = fs.statSync(darPath);

    if (actualHash !== entry.sha256) {
      console.error(`❌ Hash mismatch: ${lockKey}`);
      console.error(`   Expected: ${entry.sha256}`);
      console.error(`   Actual:   ${actualHash}`);
      mismatchCount++;
      hasErrors = true;

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
        entry.size = actualStats.size;
      }
    } else {
      console.log(`✅ ${lockKey}`);
      checkedCount++;
    }
  }

  // Check for DAR files not in dars.lock
  for (const darPath of darFiles) {
    const relativePath = path.relative(darsDir, darPath);
    if (!lock.packages[relativePath]) {
      console.warn(`⚠️ Unknown DAR (not in dars.lock): ${relativePath}`);
      unknownCount++;

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

  // Save updates if requested
  if (update && (mismatchCount > 0 || unknownCount > 0)) {
    // Sort packages alphabetically
    const sortedPackages: Record<string, DarsLockEntry> = {};
    Object.keys(lock.packages)
      .sort()
      .forEach(key => {
        sortedPackages[key] = lock.packages[key];
      });
    lock.packages = sortedPackages;

    saveDarsLock(lock);
    console.log('\n📝 dars.lock has been updated');
  }

  // Summary
  console.log('\n--- Summary ---');
  console.log(`Verified: ${checkedCount}`);
  if (missingCount > 0) console.log(`Missing:  ${missingCount}`);
  if (mismatchCount > 0) console.log(`Mismatch: ${mismatchCount}`);
  if (unknownCount > 0) console.log(`Unknown:  ${unknownCount}`);

  if (hasErrors && !update) {
    console.error('\n❌ Verification failed!');
    console.error('Run with --update to fix dars.lock (use with caution)');
    process.exit(1);
  }

  if (Object.keys(lock.packages).length === 0) {
    console.log('\nℹ️ No DAR files backed up yet.');
  } else if (!hasErrors) {
    console.log('\n✅ All DAR files verified successfully!');
  }
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
