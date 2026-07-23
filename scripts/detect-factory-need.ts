#!/usr/bin/env node
/**
 * Detect whether the current OCP package version already has recorded factory contracts.
 *
 * Usage: tsx scripts/detect-factory-need.ts --package ocp
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getBackedUpDarPath, getFreshDarPath } from './dar-utils';
import { getPackage, parsePackageArg } from './packages';
import type { ContractNetwork } from './types';

const ROOT_DIR = path.join(__dirname, '..');
const FACTORY_JSON_PATH = path.join(ROOT_DIR, 'generated', 'ocp-factory-contract-id.json');
const NETWORKS = ['devnet', 'mainnet'] as const satisfies readonly ContractNetwork[];

interface FactoryEntry {
  ocpFactoryContractId: string;
  templateId: string;
  packageName?: string;
  packageVersion?: string;
  sourceDir?: string;
  updatedAt?: string;
}

interface FactoryJson {
  devnet?: FactoryEntry;
  mainnet?: FactoryEntry;
}

interface NetworkResult {
  exists: boolean;
  match_reason: 'metadata_and_template_package_id' | 'template_package_id' | null;
  ocp_factory_contract_id?: string;
  template_id?: string;
  package_name?: string;
  package_version?: string;
}

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function readStringField(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function packageMetadataMatches(value: Record<string, unknown>, packageName: string, version: string): boolean {
  const name = readStringField(value, ['name', 'packageName', 'package_name']);
  const packageVersion = readStringField(value, ['version', 'packageVersion', 'package_version']);
  return name === packageName && (!packageVersion || packageVersion === version);
}

function findPackageIdInPackageMap(
  value: Record<string, unknown>,
  packageName: string,
  version: string
): string | null {
  const { packages } = value;
  if (!isObject(packages)) {
    return null;
  }

  const mainPackageId = readStringField(value, ['main_package_id', 'mainPackageId']);
  if (mainPackageId) {
    const mainPackage = packages[mainPackageId];
    if (isObject(mainPackage) && packageMetadataMatches(mainPackage, packageName, version)) {
      return mainPackageId;
    }
  }

  for (const [packageId, metadata] of Object.entries(packages)) {
    if (isObject(metadata) && packageMetadataMatches(metadata, packageName, version)) {
      return packageId;
    }
  }

  return null;
}

function findPackageIdInInspectJson(value: unknown, packageName: string, version: string): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPackageIdInInspectJson(item, packageName, version);
      if (found) return found;
    }
    return null;
  }

  if (!isObject(value)) {
    return null;
  }

  const packageMapMatch = findPackageIdInPackageMap(value, packageName, version);
  if (packageMapMatch) {
    return packageMapMatch;
  }

  const packageId = readStringField(value, ['packageId', 'package_id']);
  if (packageId && packageMetadataMatches(value, packageName, version)) {
    return packageId;
  }

  for (const child of Object.values(value)) {
    const found = findPackageIdInInspectJson(child, packageName, version);
    if (found) return found;
  }
  return null;
}

export function inspectDarPackageId(darPath: string, packageName: string, version: string): string {
  let raw: string;
  try {
    raw = execFileSync('dpm', ['damlc', 'inspect-dar', darPath, '--json'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to inspect DAR package id with dpm: ${message}`);
  }

  const parsed = JSON.parse(raw) as unknown;
  const packageId = findPackageIdInInspectJson(parsed, packageName, version);
  if (!packageId) {
    throw new Error(`Could not find package id for ${packageName} ${version} in ${darPath}`);
  }
  return packageId;
}

export function getDarPath(packageName: string, version: string, darName: string): string {
  return (
    getBackedUpDarPath(packageName, version, darName) ??
    getFreshDarPath(packageName, version, darName) ??
    (() => {
      throw new Error(
        `No DAR found for ${packageName} ${version}. Run npm run build or npm run upload-dar before detecting factory state.`
      );
    })()
  );
}

function analyzeNetwork(
  entry: FactoryEntry | undefined,
  packageName: string,
  version: string,
  packageId: string
): NetworkResult {
  if (!entry) {
    return { exists: false, match_reason: null };
  }

  const metadataMatches = entry.packageName === packageName && entry.packageVersion === version;
  const templateMatches = entry.templateId.startsWith(`${packageId}:`);
  const matchReason = templateMatches
    ? metadataMatches
      ? 'metadata_and_template_package_id'
      : 'template_package_id'
    : null;

  return {
    exists: matchReason !== null,
    match_reason: matchReason,
    ocp_factory_contract_id: entry.ocpFactoryContractId,
    template_id: entry.templateId,
    package_name: entry.packageName,
    package_version: entry.packageVersion,
  };
}

function main(): void {
  const packageArg = parsePackageArg() ?? 'ocp';
  const pkg = getPackage(packageArg);
  if (!pkg) {
    throw new Error(`Unknown package: ${packageArg}`);
  }

  const darPath = getDarPath(pkg.name, pkg.version, pkg.darName);
  const packageId = inspectDarPackageId(darPath, pkg.name, pkg.version);
  const factoryJson = readJsonFile<FactoryJson>(FACTORY_JSON_PATH) ?? {};
  const factories = Object.fromEntries(
    NETWORKS.map((network) => [network, analyzeNetwork(factoryJson[network], pkg.name, pkg.version, packageId)])
  ) as Record<ContractNetwork, NetworkResult>;
  const missingNetworks = NETWORKS.filter((network) => !factories[network].exists);

  process.stdout.write(
    `${JSON.stringify(
      {
        package: pkg.name,
        package_key: packageArg,
        source_dir: pkg.sourceDir,
        version: pkg.version,
        package_id: packageId,
        dar_path: path.relative(ROOT_DIR, darPath),
        factory_json: path.relative(ROOT_DIR, FACTORY_JSON_PATH),
        needs_factory: missingNetworks.length > 0,
        missing_networks: missingNetworks,
        factory_script: 'npx tsx scripts/create-ocp-factory.ts --network <network>',
        factories,
      },
      null,
      2
    )}\n`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}
