/**
 * CI backwards compatibility checker.
 *
 * Validates that DAML package changes are backwards compatible using `dpm upgrade-check`. Compares the current build
 * against the most recent backup for each package. Fails CI if:
 *
 * - Breaking changes are introduced without a major version bump
 * - Compatible changes are made without bumping the minor version
 *
 * Usage: npx tsx scripts/check-upgrade-compatibility.ts
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { computeSha256, getDarsDir, loadDarsLock } from './dar-utils';

const ROOT_DIR = path.join(__dirname, '..');

/**
 * Extract the base name and major version from a package name. E.g., "OpenCapTable-v29" => { baseName: "OpenCapTable",
 * majorVersion: 29 }
 */
function parsePackageName(name: string): { baseName: string; majorVersion: number | null } {
  const match = name.match(/^(.+)-v(\d+)$/);
  if (match) {
    return { baseName: match[1], majorVersion: parseInt(match[2], 10) };
  }
  return { baseName: name, majorVersion: null };
}

/** Get all backed-up packages from dars.lock, grouped by exact package name. */
function getBackedUpPackages(): Map<string, Array<{ packageName: string; version: string; darPath: string }>> {
  const lock = loadDarsLock();
  const darsDir = getDarsDir();

  // Group by exact package name (e.g., "OpenCapTable-v29")
  const byPackageName = new Map<string, Array<{ packageName: string; version: string; darPath: string }>>();

  for (const [lockKey, _entry] of Object.entries(lock.packages)) {
    // lockKey format: "OpenCapTable-v29/0.0.1/OpenCapTable-v29.dar"
    const parts = lockKey.split('/');
    if (parts.length !== 3) continue;

    const [packageName, version, _darFile] = parts;
    const darPath = path.join(darsDir, lockKey);

    if (!fs.existsSync(darPath)) continue;

    if (!byPackageName.has(packageName)) {
      byPackageName.set(packageName, []);
    }
    byPackageName.get(packageName)!.push({ packageName, version, darPath });
  }

  return byPackageName;
}

/** Find the most recent backed-up version for a package. */
function getMostRecentBackup(
  backups: Array<{ packageName: string; version: string; darPath: string }>
): { packageName: string; version: string; darPath: string } | null {
  if (backups.length === 0) return null;

  // Sort by semver descending to find most recent
  const sorted = [...backups].sort((a, b) => {
    const aVer = a.version.split('.').map(Number);
    const bVer = b.version.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((aVer[i] || 0) !== (bVer[i] || 0)) {
        return (bVer[i] || 0) - (aVer[i] || 0);
      }
    }
    return 0;
  });

  return sorted[0];
}

/** Get all backed-up packages grouped by base name (for finding previous major versions). */
function getBackedUpPackagesByBaseName(): Map<
  string,
  Array<{ packageName: string; version: string; darPath: string }>
> {
  const lock = loadDarsLock();
  const darsDir = getDarsDir();

  const byBaseName = new Map<string, Array<{ packageName: string; version: string; darPath: string }>>();

  for (const [lockKey, _entry] of Object.entries(lock.packages)) {
    const parts = lockKey.split('/');
    if (parts.length !== 3) continue;

    const [packageName, version, _darFile] = parts;
    const { baseName } = parsePackageName(packageName);
    const darPath = path.join(darsDir, lockKey);

    if (!fs.existsSync(darPath)) continue;

    if (!byBaseName.has(baseName)) {
      byBaseName.set(baseName, []);
    }
    byBaseName.get(baseName)!.push({ packageName, version, darPath });
  }

  return byBaseName;
}

/** Find the current DAR for a package directory. */
function getCurrentDar(packageDir: string): { darPath: string; version: string } | null {
  const damlYamlPath = path.join(ROOT_DIR, packageDir, 'daml.yaml');
  if (!fs.existsSync(damlYamlPath)) return null;

  const content = fs.readFileSync(damlYamlPath, 'utf8');
  const nameMatch = content.match(/^name:\s*(.+)$/m);
  const versionMatch = content.match(/^version:\s*(.+)$/m);

  if (!nameMatch || !versionMatch) return null;

  const name = nameMatch[1].trim();
  const version = versionMatch[1].trim();
  const darPath = path.join(ROOT_DIR, packageDir, '.daml', 'dist', `${name}-${version}.dar`);

  if (!fs.existsSync(darPath)) return null;

  return { darPath, version };
}

/** Find all current package directories in the workspace. */
function findCurrentPackages(): string[] {
  const entries = fs.readdirSync(ROOT_DIR, { withFileTypes: true });
  const packages: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const damlYamlPath = path.join(ROOT_DIR, entry.name, 'daml.yaml');
    if (fs.existsSync(damlYamlPath)) {
      packages.push(entry.name);
    }
  }

  return packages;
}

/** Report an upgrade compatibility failure with helpful output. */
function reportUpgradeFailure(packageName: string, baseName: string, output: string): void {
  console.error(`❌ ${packageName}: NOT backwards compatible!\n`);
  console.error('   Upgrade check output:');
  const lines = output.split('\n').filter((line) => line.includes('ERROR') || line.includes('WARN'));
  for (const line of lines.slice(0, 10)) {
    console.error(`   ${line}`);
  }
  if (lines.length > 10) {
    console.error(`   ... and ${lines.length - 10} more issues`);
  }
  console.error('');
  console.error('   To introduce breaking changes, bump the major version:');
  console.error(`   npm run upgrade-package -- --package ${baseName} --type major\n`);
}

/** Run dpm upgrade-check and return success/failure. */
function runUpgradeCheck(oldDar: string, newDar: string): { success: boolean; output: string } {
  try {
    const output = execSync(`dpm upgrade-check --both "${oldDar}" "${newDar}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${process.env.HOME}/.dpm/bin:${process.env.PATH}` },
    });
    return { success: true, output };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string };
    return {
      success: false,
      output: (execError.stdout ?? '') + (execError.stderr ?? ''),
    };
  }
}

/** Main function to check upgrade compatibility. */
function main(): void {
  console.log('🔍 Checking DAML package upgrade compatibility...\n');

  const backedUpByPackageName = getBackedUpPackages();
  const backedUpByBaseName = getBackedUpPackagesByBaseName();
  const currentPackages = findCurrentPackages();

  let hasFailures = false;
  let checkedCount = 0;
  let skippedCount = 0;

  for (const packageDir of currentPackages) {
    // Skip Test package - it's not deployed
    if (packageDir === 'Test') {
      console.log(`⏭️  Skipping ${packageDir} (test package)`);
      skippedCount++;
      continue;
    }

    const currentDar = getCurrentDar(packageDir);
    if (!currentDar) {
      console.log(`⏭️  Skipping ${packageDir} (no built DAR found)`);
      skippedCount++;
      continue;
    }

    // Get package metadata
    const damlYamlPath = path.join(ROOT_DIR, packageDir, 'daml.yaml');
    const content = fs.readFileSync(damlYamlPath, 'utf8');
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    if (!nameMatch) continue;

    const currentPackageName = nameMatch[1].trim();
    const { baseName, majorVersion: currentMajor } = parsePackageName(currentPackageName);

    // Find backed-up versions for this exact package name
    const backupsForPackage = backedUpByPackageName.get(currentPackageName) ?? [];
    const mostRecentBackup = getMostRecentBackup(backupsForPackage);

    if (mostRecentBackup) {
      // Compare against the most recent backup of the same package
      console.log(
        `🔄 Checking ${currentPackageName} v${currentDar.version} against backup v${mostRecentBackup.version}...`
      );

      const result = runUpgradeCheck(mostRecentBackup.darPath, currentDar.darPath);

      if (result.success) {
        // Upgrade check passed - verify version was bumped if there are actual changes
        if (currentDar.version === mostRecentBackup.version) {
          // Same version - check if DAR contents actually changed
          const currentHash = computeSha256(currentDar.darPath);
          const backupHash = computeSha256(mostRecentBackup.darPath);

          if (currentHash !== backupHash) {
            // DAR changed but version wasn't bumped - fail CI
            console.error(`❌ ${currentPackageName}: Compatible changes detected but version not bumped!\n`);
            console.error(`   Current DAR hash:  ${currentHash.slice(0, 16)}...`);
            console.error(`   Backup DAR hash:   ${backupHash.slice(0, 16)}...`);
            console.error('');
            console.error('   To fix, bump the minor version:');
            console.error(`   npm run upgrade-package -- --package ${baseName} --type minor\n`);
            hasFailures = true;
            checkedCount++;
            continue;
          }
          // DAR is identical - no actual changes
          console.log(`✅ ${currentPackageName} v${currentDar.version}: No changes from backup\n`);
        } else {
          // Version was bumped and upgrade-check passed - proper workflow
          console.log(
            `✅ ${currentPackageName}: Backwards compatible (v${mostRecentBackup.version} → v${currentDar.version})\n`
          );
        }
        checkedCount++;
        continue;
      }

      // Upgrade check failed - this is only OK if it's a new major version
      // But since we're comparing against the same package name, a failure here means
      // breaking changes without a major version bump
      reportUpgradeFailure(currentPackageName, baseName, result.output);
      hasFailures = true;
      checkedCount++;
      continue;
    }

    // No backup for this exact package name - check if there's a previous major version
    const allBackupsForBase = backedUpByBaseName.get(baseName) ?? [];
    const previousMajorBackup = getMostRecentBackupForPreviousMajor(allBackupsForBase, currentMajor);

    if (previousMajorBackup) {
      // This is a new major version - compare against previous major to show what changed
      console.log(
        `✅ ${currentPackageName}: New major version (previous was ${previousMajorBackup.packageName} v${previousMajorBackup.version})`
      );
      checkedCount++;
      continue;
    }

    // Truly new package with no backups at all
    console.log(`✅ ${currentPackageName}: No previous backup (new package)`);
    checkedCount++;
  }

  console.log('---');
  console.log(`📊 Summary: ${checkedCount} checked, ${skippedCount} skipped`);

  if (hasFailures) {
    console.error('\n❌ Upgrade compatibility check failed!');
    console.error('   Fix the issues above or bump the major version for breaking changes.');
    process.exit(1);
  }

  console.log('\n✅ All packages are backwards compatible.');
}

/** Find the most recent backup for a previous major version. */
function getMostRecentBackupForPreviousMajor(
  backups: Array<{ packageName: string; version: string; darPath: string }>,
  currentMajor: number | null
): { packageName: string; version: string; darPath: string } | null {
  if (currentMajor === null) return null;

  // Filter to only previous major versions
  const previousMajorBackups = backups.filter((b) => {
    const { majorVersion } = parsePackageName(b.packageName);
    return majorVersion !== null && majorVersion < currentMajor;
  });

  if (previousMajorBackups.length === 0) return null;

  // Sort by major version descending, then by semver descending
  const sorted = [...previousMajorBackups].sort((a, b) => {
    const aMajor = parsePackageName(a.packageName).majorVersion ?? 0;
    const bMajor = parsePackageName(b.packageName).majorVersion ?? 0;
    if (aMajor !== bMajor) return bMajor - aMajor;

    const aVer = a.version.split('.').map(Number);
    const bVer = b.version.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((aVer[i] || 0) !== (bVer[i] || 0)) {
        return (bVer[i] || 0) - (aVer[i] || 0);
      }
    }
    return 0;
  });

  return sorted[0];
}

try {
  main();
} catch (error) {
  console.error('Fatal error:', error);
  process.exit(1);
}
