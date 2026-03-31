#!/usr/bin/env tsx

import fs from "fs";
import path from "path";
import yaml from "yaml";

interface DamlConfig {
  dependencies?: string[];
  "data-dependencies"?: string[];
}

const ROOT_DIR = path.join(__dirname, "..");
const NFT_PACKAGE_DIR = path.join(ROOT_DIR, "OpenCapTableNft-v01");
const NFT_DAML_YAML_PATH = path.join(NFT_PACKAGE_DIR, "daml.yaml");
const NFT_DAML_SOURCE_DIR = path.join(NFT_PACKAGE_DIR, "daml");
const SPLICE_IMPORT_PATTERN = /^\s*import\s+Splice\./m;

function readDamlConfig(): DamlConfig {
  const fileContents = fs.readFileSync(NFT_DAML_YAML_PATH, "utf8");
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
    if (entry.isFile() && entry.name.endsWith(".daml")) {
      files.push(entryPath);
    }
  }

  return files;
}

function findSplicePackageDependencies(config: DamlConfig): string[] {
  const dependencies = [...(config.dependencies ?? []), ...(config["data-dependencies"] ?? [])];
  return dependencies.filter((dependency) => dependency.includes("splice-"));
}

function findSpliceImports(): string[] {
  return collectDamlFiles(NFT_DAML_SOURCE_DIR).flatMap((filePath) => {
    const fileContents = fs.readFileSync(filePath, "utf8");
    return SPLICE_IMPORT_PATTERN.test(fileContents) ? [path.relative(ROOT_DIR, filePath)] : [];
  });
}

function main(): void {
  console.log("🔍 Checking NFT core package invariants...");

  const config = readDamlConfig();
  const spliceDependencies = findSplicePackageDependencies(config);
  const spliceImports = findSpliceImports();

  if (spliceDependencies.length > 0 || spliceImports.length > 0) {
    console.error("❌ NFT core package must remain free of Splice dependencies.");

    if (spliceDependencies.length > 0) {
      console.error("\nSplice package dependencies:");
      for (const dependency of spliceDependencies) {
        console.error(`  - ${dependency}`);
      }
    }

    if (spliceImports.length > 0) {
      console.error("\nSplice imports:");
      for (const filePath of spliceImports) {
        console.error(`  - ${filePath}`);
      }
    }

    process.exit(1);
  }

  console.log("✅ NFT core package has no Splice package dependencies or imports.");
}

main();
