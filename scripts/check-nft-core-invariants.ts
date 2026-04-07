#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

interface DamlConfig {
  dependencies?: string[];
  'data-dependencies'?: string[];
}

interface NftCorePackage {
  name: string;
  damlYamlPath: string;
  damlSourceDir: string;
}

const ROOT_DIR = path.join(__dirname, '..');
const NFT_CORE_PACKAGES: NftCorePackage[] = [
  {
    name: 'NftApi-v01',
    damlYamlPath: path.join(ROOT_DIR, 'NftApi-v01', 'daml.yaml'),
    damlSourceDir: path.join(ROOT_DIR, 'NftApi-v01', 'daml'),
  },
  {
    name: 'NftReference-v01',
    damlYamlPath: path.join(ROOT_DIR, 'NftReference-v01', 'daml.yaml'),
    damlSourceDir: path.join(ROOT_DIR, 'NftReference-v01', 'daml'),
  },
] as const;
const SPLICE_IMPORT_PATTERN = /^\s*import\b[^\n]*\bSplice\.[A-Za-z0-9_.']+/m;

function readDamlConfig(corePackage: NftCorePackage): DamlConfig {
  const fileContents = fs.readFileSync(corePackage.damlYamlPath, 'utf8');
  return yaml.parse(fileContents) as DamlConfig;
}

function collectDamlFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDamlFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.daml')) {
      files.push(entryPath);
    }
  }

  return files;
}

function findSplicePackageDependencies(config: DamlConfig): string[] {
  const dependencies = [...(config.dependencies ?? []), ...(config['data-dependencies'] ?? [])];
  return dependencies.filter((dependency) => dependency.includes('splice-'));
}

function findSpliceImports(corePackage: NftCorePackage): string[] {
  return collectDamlFiles(corePackage.damlSourceDir).flatMap((filePath) => {
    const fileContents = fs.readFileSync(filePath, 'utf8');
    return SPLICE_IMPORT_PATTERN.test(fileContents) ? [path.relative(ROOT_DIR, filePath)] : [];
  });
}

function main(): void {
  console.log('🔍 Checking NFT API/reference package invariants...');

  let hasViolation = false;

  for (const corePackage of NFT_CORE_PACKAGES) {
    const config = readDamlConfig(corePackage);
    const spliceDependencies = findSplicePackageDependencies(config);
    const spliceImports = findSpliceImports(corePackage);

    if (spliceDependencies.length === 0 && spliceImports.length === 0) {
      continue;
    }

    hasViolation = true;
    console.error(`❌ ${corePackage.name} must remain free of Splice dependencies.`);

    if (spliceDependencies.length > 0) {
      console.error('\nSplice package dependencies:');
      for (const dependency of spliceDependencies) {
        console.error(`  - ${dependency}`);
      }
    }

    if (spliceImports.length > 0) {
      console.error('\nSplice imports:');
      for (const filePath of spliceImports) {
        console.error(`  - ${filePath}`);
      }
    }
  }

  if (hasViolation) {
    process.exit(1);
  }

  console.log('✅ NFT API/reference packages have no Splice package dependencies or imports.');
}

if (require.main === module) {
  main();
}

export { NFT_CORE_PACKAGES, collectDamlFiles, findSpliceImports, findSplicePackageDependencies, main, readDamlConfig };
