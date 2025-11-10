#!/usr/bin/env ts-node
/**
 * Script to upgrade DAML package versions.
 * Supports both major and minor version upgrades.
 *
 * Usage:
 *   npm run upgrade-package -- --package <name> --type <major|minor>
 *
 * Example:
 *   npm run upgrade-package -- --package Subscriptions --type major
 *   npm run upgrade-package -- --package Subscriptions --type minor
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as yaml from 'yaml';

interface UpgradeOptions {
  packageName: string;
  upgradeType: 'major' | 'minor';
}

interface PackageInfo {
  currentFolder: string;
  currentMajorVersion: string;
  currentFullVersion: string;
  newFolder?: string;
  newMajorVersion?: string;
  newFullVersion: string;
}

const ROOT_DIR = path.join(__dirname, '..');

/**
 * Parse command line arguments
 */
function parseArgs(): UpgradeOptions {
  const args = process.argv.slice(2);
  let packageName = '';
  let upgradeType: 'major' | 'minor' = 'minor';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--package' && i + 1 < args.length) {
      packageName = args[i + 1];
      i++;
    } else if (args[i] === '--type' && i + 1 < args.length) {
      const type = args[i + 1].toLowerCase();
      if (type !== 'major' && type !== 'minor') {
        throw new Error(`Invalid upgrade type: ${type}. Must be 'major' or 'minor'.`);
      }
      upgradeType = type;
      i++;
    }
  }

  if (!packageName) {
    throw new Error('Package name is required. Use --package <name>');
  }

  return { packageName, upgradeType };
}

/**
 * Find the package folder that matches the given package name
 */
function findPackageFolder(packageName: string): string {
  const entries = fs.readdirSync(ROOT_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Match patterns like "OpenCapTable-v25", "Subscriptions-v05", etc.
      const match = entry.name.match(new RegExp(`^${packageName}-(v\\d+)$`, 'i'));
      if (match) {
        return entry.name;
      }
      // Also match exact name without version suffix (e.g., "CantonPayments")
      if (entry.name === packageName) {
        return entry.name;
      }
    }
  }

  throw new Error(`Package folder not found for: ${packageName}`);
}

/**
 * Read the daml.yaml file and extract version information
 */
function readDamlYaml(folderPath: string): { name: string; version: string } {
  const yamlPath = path.join(ROOT_DIR, folderPath, 'daml.yaml');
  const content = fs.readFileSync(yamlPath, 'utf8');
  const parsed = yaml.parse(content);

  return {
    name: parsed.name,
    version: parsed.version,
  };
}

/**
 * Get package information for upgrade
 */
function getPackageInfo(packageName: string, upgradeType: 'major' | 'minor'): PackageInfo {
  const currentFolder = findPackageFolder(packageName);
  const match = currentFolder.match(/^(.+)-(v(\d+))$/);

  // Check if package has version suffix
  const hasVersionSuffix = match !== null;

  if (!hasVersionSuffix) {
    // Package doesn't have version suffix (e.g., "CantonPayments")
    if (upgradeType === 'major') {
      throw new Error(`Package ${currentFolder} does not have a version suffix and does not support major upgrades. Only minor upgrades are supported.`);
    }

    const { version: currentFullVersion } = readDamlYaml(currentFolder);

    // Minor upgrade - increment patch version
    const versionParts = currentFullVersion.split('.');
    if (versionParts.length !== 3) {
      throw new Error(`Invalid version format: ${currentFullVersion}`);
    }
    versionParts[2] = (parseInt(versionParts[2], 10) + 1).toString();

    return {
      currentFolder,
      currentMajorVersion: '', // No major version for packages without suffix
      currentFullVersion,
      newFullVersion: versionParts.join('.'),
    };
  }

  const baseName = match[1];
  const currentMajorVersion = match[2]; // e.g., "v07"
  const majorVersionNum = parseInt(match[3], 10); // e.g., 7

  const { version: currentFullVersion } = readDamlYaml(currentFolder);

  const info: PackageInfo = {
    currentFolder,
    currentMajorVersion,
    currentFullVersion,
    newFullVersion: currentFullVersion,
  };

  if (upgradeType === 'major') {
    const newMajorVersionNum = majorVersionNum + 1;
    info.newMajorVersion = `v${newMajorVersionNum.toString().padStart(2, '0')}`;
    info.newFolder = `${baseName}-${info.newMajorVersion}`;
    info.newFullVersion = '0.0.1';
  } else {
    // Minor upgrade - increment patch version
    const versionParts = currentFullVersion.split('.');
    if (versionParts.length !== 3) {
      throw new Error(`Invalid version format: ${currentFullVersion}`);
    }
    versionParts[2] = (parseInt(versionParts[2], 10) + 1).toString();
    info.newFullVersion = versionParts.join('.');
  }

  return info;
}

/**
 * Update daml.yaml file with new version
 */
function updateDamlYaml(folderPath: string, newVersion: string, newName?: string): void {
  const yamlPath = path.join(ROOT_DIR, folderPath, 'daml.yaml');
  const content = fs.readFileSync(yamlPath, 'utf8');
  const parsed = yaml.parse(content);

  parsed.version = newVersion;
  if (newName) {
    parsed.name = newName;
  }

  fs.writeFileSync(yamlPath, yaml.stringify(parsed), 'utf8');
  console.log(`✓ Updated ${yamlPath}`);
}

/**
 * Recursively search and replace in files
 */
function searchAndReplaceInFiles(directory: string, oldText: string, newText: string, fileExtensions: string[] = ['.yaml', '.ts', '.md', '.json', '.daml']): number {
  let replacementCount = 0;

  function processDirectory(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip node_modules, .daml, and other build directories
      if (entry.isDirectory()) {
        if (['node_modules', '.daml', 'lib', 'generated'].includes(entry.name)) {
          continue;
        }
        processDirectory(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (fileExtensions.includes(ext)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.includes(oldText)) {
            const newContent = content.replace(new RegExp(escapeRegExp(oldText), 'g'), newText);
            fs.writeFileSync(fullPath, newContent, 'utf8');
            replacementCount++;
            console.log(`  ✓ Updated ${path.relative(ROOT_DIR, fullPath)}`);
          }
        }
      }
    }
  }

  processDirectory(directory);
  return replacementCount;
}

/**
 * Escape special characters for regex
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Perform major upgrade
 */
function performMajorUpgrade(info: PackageInfo): void {
  console.log('\n🚀 Performing MAJOR upgrade...\n');
  console.log(`Package: ${info.currentFolder}`);
  console.log(`Current version: ${info.currentMajorVersion} (${info.currentFullVersion})`);
  console.log(`New version: ${info.newMajorVersion} (${info.newFullVersion})`);
  console.log();

  // Step 1: Rename folder
  const oldPath = path.join(ROOT_DIR, info.currentFolder);
  const newPath = path.join(ROOT_DIR, info.newFolder!);

  if (fs.existsSync(newPath)) {
    throw new Error(`Target folder already exists: ${info.newFolder}`);
  }

  fs.renameSync(oldPath, newPath);
  console.log(`✓ Renamed folder: ${info.currentFolder} → ${info.newFolder}\n`);

  // Step 2: Update daml.yaml in the renamed folder
  const newPackageName = info.currentFolder.replace(info.currentMajorVersion, info.newMajorVersion!);
  updateDamlYaml(info.newFolder!, info.newFullVersion, newPackageName);
  console.log();

  // Step 3: Search and replace version strings
  console.log('Updating references across the repository...\n');

  // Replace full version strings (e.g., "CantonPayments-0.2.3" → "CantonPayments-0.0.23")
  const oldFullVersionString = `${info.currentFolder}-${info.currentFullVersion}`;
  const newFullVersionString = `${info.newFolder}-${info.newFullVersion}`;
  console.log(`Replacing: ${oldFullVersionString} → ${newFullVersionString}`);
  searchAndReplaceInFiles(ROOT_DIR, oldFullVersionString, newFullVersionString);

  // Replace major version strings (e.g., "CantonPayments" → "CantonPayments")
  console.log(`\nReplacing: ${info.currentFolder} → ${info.newFolder}`);
  searchAndReplaceInFiles(ROOT_DIR, info.currentFolder, info.newFolder!);

  console.log('\n✅ Major upgrade completed successfully!');
  console.log(`\nNext steps:`);
  console.log(`1. Review changes: git diff`);
  console.log(`2. Build the package: cd ${info.newFolder} && daml build`);
  console.log(`3. Test the changes`);
  console.log(`4. Commit: git add -A && git commit -m "Upgrade ${info.newFolder} to ${info.newFullVersion}"`);
}

/**
 * Perform minor upgrade
 */
function performMinorUpgrade(info: PackageInfo): void {
  console.log('\n🔄 Performing MINOR upgrade...\n');
  console.log(`Package: ${info.currentFolder}`);
  console.log(`Current version: ${info.currentFullVersion}`);
  console.log(`New version: ${info.newFullVersion}`);
  console.log();

  // Step 1: Update daml.yaml
  updateDamlYaml(info.currentFolder, info.newFullVersion);
  console.log();

  // Step 2: Search and replace version strings
  console.log('Updating references across the repository...\n');

  const oldFullVersionString = `${info.currentFolder}-${info.currentFullVersion}`;
  const newFullVersionString = `${info.currentFolder}-${info.newFullVersion}`;
  console.log(`Replacing: ${oldFullVersionString} → ${newFullVersionString}`);
  const count = searchAndReplaceInFiles(ROOT_DIR, oldFullVersionString, newFullVersionString);

  if (count === 0) {
    console.log('  (No references found in other files)');
  }

  console.log('\n✅ Minor upgrade completed successfully!');
  console.log(`\nNext steps:`);
  console.log(`1. Review changes: git diff`);
  console.log(`2. Build the package: cd ${info.currentFolder} && daml build`);
  console.log(`3. Test the changes`);
  console.log(`4. Commit: git add -A && git commit -m "Upgrade ${info.currentFolder} to ${info.newFullVersion}"`);
}

/**
 * Main function
 */
function main(): void {
  try {
    const options = parseArgs();
    const info = getPackageInfo(options.packageName, options.upgradeType);

    if (options.upgradeType === 'major') {
      performMajorUpgrade(info);
    } else {
      performMinorUpgrade(info);
    }
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    console.error('\nUsage:');
    console.error('  npm run upgrade-package -- --package <name> --type <major|minor>');
    console.error('\nExample:');
    console.error('  npm run upgrade-package -- --package Subscriptions --type major');
    console.error('  npm run upgrade-package -- --package Subscriptions --type minor');
    process.exit(1);
  }
}

main();
