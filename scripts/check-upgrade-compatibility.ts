/**
 * CI backwards compatibility checker.
 *
 * Validates that DAML package changes are backwards compatible using `dpm upgrade-check`. Compares the current build
 * against the most recent backup for each package. Fails CI if:
 *
 * - Breaking changes are introduced without a major version bump
 * - A built DAR does not match its mutable candidate backup
 *
 * Usage: npx tsx scripts/check-upgrade-compatibility.ts
 *
 * Any source change can yield a different LF package id. Before the current version reaches a network, refresh that
 * version's candidate backup in place. Live DevNet policy checks select the version separately.
 *
 * Every deployable package must have its **current** `daml.yaml` version recorded under `dars/` (lock entry + file on
 * disk) with a SHA256 matching the committed backup. After building, run `npx tsx scripts/backup-dar.ts --package <key>
 * --version <ver>` (see `scripts/packages.ts` keys) and commit `dars/` + `dars.lock`. CI then verifies the built DAR
 * matches that backup and runs `upgrade-check` from the latest **older semver** backup **of the same package name**
 * when one exists. (Cross-major OpenCapTable-* lines are not compared: both DARs can embed the same dependency
 * name/version with different package ids, which `upgrade-check` rejects.)
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { assertDarArchiveSafe, DAML_UPGRADE_CHECK_TIMEOUT_MS } from './dar-archive-policy';
import { computeSha256, getDarLockKey, getDarsDir, loadDarsLock } from './dar-utils';
import { compareSemver, isDeployed } from './dar-version-policy';

const ROOT_DIR = path.join(__dirname, '..');

/**
 * Package names (exact `name` from daml.yaml) for which we **do not** run `dpm upgrade-check` from the latest older
 * backup. We still require the built DAR to match `dars/` + `dars.lock`.
 */
const SKIP_LINEAGE_UPGRADE_CHECK = new Set<string>([]);

/**
 * Extract the base name and major version from a package name. E.g., "OpenCapTable-v34" => { baseName: "OpenCapTable",
 * majorVersion: 32 }
 */
function parsePackageName(name: string): { baseName: string; majorVersion: number | null } {
  const match = name.match(/^(.+)-v(\d+)$/);
  if (match) {
    return { baseName: match[1], majorVersion: parseInt(match[2], 10) };
  }
  return { baseName: name, majorVersion: null };
}

/** Get DevNet-marked packages from dars.lock, grouped by exact package name (file must exist on disk). */
function getBackedUpPackages(): Map<string, Array<{ packageName: string; version: string; darPath: string }>> {
  const lock = loadDarsLock();
  const darsDir = getDarsDir();

  // Group by exact package name (e.g., "OpenCapTable-v34")
  const byPackageName = new Map<string, Array<{ packageName: string; version: string; darPath: string }>>();

  for (const [lockKey, entry] of Object.entries(lock.packages)) {
    if (!entry.networks.includes('devnet')) continue;
    // lockKey format: "OpenCapTable-v34/0.0.1/OpenCapTable-v34.dar"
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

/** Sort backups by semver descending. */
function sortBackupsDesc(
  backups: Array<{ packageName: string; version: string; darPath: string }>
): Array<{ packageName: string; version: string; darPath: string }> {
  return [...backups].sort((a, b) => compareSemver(b.version, a.version));
}

/** Latest backup strictly older than `currentVersion` (for upgrade-check baseline). */
function getMostRecentOlderBackup(
  backups: Array<{ packageName: string; version: string; darPath: string }>,
  currentVersion: string
): { packageName: string; version: string; darPath: string } | null {
  const older = backups.filter((b) => compareSemver(currentVersion, b.version) > 0);
  if (older.length === 0) return null;
  return sortBackupsDesc(older)[0];
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
  console.error('   Upgrade check output (full log):');
  const lines = output.split('\n');
  const indent = (s: string) => console.error(`   ${s}`);
  const maxLines = 100;
  if (lines.length <= maxLines) {
    for (const line of lines) indent(line);
  } else {
    indent(`(${lines.length} lines; showing first ${maxLines / 2} and last ${maxLines / 2})`);
    for (const line of lines.slice(0, maxLines / 2)) indent(line);
    indent('...');
    for (const line of lines.slice(-(maxLines / 2))) indent(line);
  }
  console.error('');
  console.error('   Fix the source or dependency change if this was expected to be backwards compatible.');
  console.error('   To introduce breaking changes, bump the major version:');
  console.error(`   npm run upgrade-package -- --package ${baseName} --type major\n`);
}

/** Run dpm upgrade-check and return success/failure. */
function runUpgradeCheck(oldDar: string, newDar: string): { success: boolean; output: string } {
  assertDarArchiveSafe(oldDar);
  assertDarArchiveSafe(newDar);
  try {
    const output = execFileSync('dpm', ['upgrade-check', '--both', oldDar, newDar], {
      encoding: 'utf8',
      killSignal: 'SIGKILL',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: DAML_UPGRADE_CHECK_TIMEOUT_MS,
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
    const { baseName } = parsePackageName(currentPackageName);

    const lock = loadDarsLock();
    const darsDir = getDarsDir();
    const currentLockKey = getDarLockKey(currentPackageName, currentDar.version, currentPackageName);
    const committedBackupPath = path.join(darsDir, currentLockKey);
    if (!(currentLockKey in lock.packages)) {
      console.error(`❌ ${currentPackageName}: No dars.lock entry for the current release.\n`);
      console.error(`   Expected key: ${currentLockKey}`);
      console.error('   Build the package, then run:');
      console.error(`   npx tsx scripts/backup-dar.ts --package <key> --version ${currentDar.version}`);
      console.error('   (see scripts/packages.ts for package keys), then commit dars/ and dars.lock.\n');
      hasFailures = true;
      checkedCount++;
      continue;
    }

    const lockEntry = lock.packages[currentLockKey];

    if (!fs.existsSync(committedBackupPath)) {
      console.error(`❌ ${currentPackageName}: dars.lock lists ${currentLockKey} but the file is missing on disk.\n`);
      console.error(`   Expected file: ${committedBackupPath}`);
      console.error('   Restore from git or re-run backup-dar and commit.\n');
      hasFailures = true;
      checkedCount++;
      continue;
    }

    const builtHash = computeSha256(currentDar.darPath);
    if (builtHash !== lockEntry.sha256) {
      console.error(`❌ ${currentPackageName}: Built DAR does not match the committed backup in dars/.\n`);
      console.error(`   Lock key: ${currentLockKey}`);
      console.error(`   Expected (dars.lock): ${lockEntry.sha256}`);
      console.error(`   Actual (build):       ${builtHash}`);
      console.error('');
      if (isDeployed(lockEntry)) {
        console.error('   This exact backup is recorded on a network and is immutable.');
        console.error(`   Run npm run upgrade-package -- --package ${currentPackageName} --type minor.\n`);
      } else {
        console.error('   This version is still an undeployed PR candidate; keep the version.');
        console.error(
          `   Refresh it with npm run backup-dar -- --package ${currentPackageName} --version ${currentDar.version}, then commit dars/.\n`
        );
      }
      hasFailures = true;
      checkedCount++;
      continue;
    }

    console.log(
      `✅ ${currentPackageName} v${currentDar.version}: Built DAR matches committed backup (${currentLockKey})`
    );

    const backupsForPackage = backedUpByPackageName.get(currentPackageName) ?? [];
    const upgradeBaseline = getMostRecentOlderBackup(backupsForPackage, currentDar.version);

    if (upgradeBaseline) {
      if (SKIP_LINEAGE_UPGRADE_CHECK.has(currentPackageName)) {
        console.log(
          `⏭️  ${currentPackageName}: Skipping lineage upgrade-check v${upgradeBaseline.version} → v${currentDar.version} (not a valid Daml upgrade path; see SKIP_LINEAGE_UPGRADE_CHECK in this script).\n`
        );
      } else {
        console.log(
          `🔄 Running upgrade-check: v${upgradeBaseline.version} (backup) → v${currentDar.version} (current build)...`
        );
        const result = runUpgradeCheck(upgradeBaseline.darPath, currentDar.darPath);
        if (!result.success) {
          reportUpgradeFailure(currentPackageName, baseName, result.output);
          hasFailures = true;
          checkedCount++;
          continue;
        }
        console.log(
          `✅ ${currentPackageName}: upgrade-check OK (v${upgradeBaseline.version} → v${currentDar.version})\n`
        );
      }
    } else {
      console.log(
        `✅ ${currentPackageName}: No older deployed version to upgrade-check (first release in this line)\n`
      );
    }

    checkedCount++;
  }

  console.log('---');
  console.log(`📊 Summary: ${checkedCount} checked, ${skippedCount} skipped`);

  if (hasFailures) {
    console.error('\n❌ Upgrade compatibility check failed!');
    console.error('   Fix the issues above; use a major package line only for breaking changes.');
    process.exit(1);
  }

  console.log('\n✅ All packages are backwards compatible.');
}

try {
  main();
} catch (error) {
  console.error('Fatal error:', error);
  process.exit(1);
}
