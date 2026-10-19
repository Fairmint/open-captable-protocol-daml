#!/usr/bin/env node
/**
 * Detect whether the current OCP package version already has recorded factory identities.
 *
 * A network "has" a factory when generated/ocp-factory-contract-id.json records an identity (`templateId`,
 * `system_operator`, `factory_id`) whose template belongs to this package's DAR. The v35 factory is consumed by each
 * authorization, so no contract ID is recorded or checked. An identity recorded by an older version of the package
 * counts as missing: create-ocp-factory.ts then recovers that live factory (it matches across package versions) and
 * records the current template ID, rather than creating a second factory with the same `factory_id`.
 *
 * Networks default to DevNet: MainNet is out of scope for OpenCapTable-v35 (ADR-040). `--networks devnet,mainnet`
 * restores the MainNet check once a MainNet rollout is decided.
 *
 * Usage: tsx scripts/detect-factory-need.ts --package ocp [--networks devnet[,mainnet]]
 */

import { getBackedUpDarPath, getFreshDarPath } from '@fairmint/canton-dev-tools/daml';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getPackage, parsePackageArg } from './packages';
import { isContractNetwork, type ContractNetwork } from './types';

const ROOT_DIR = path.join(__dirname, '..');
const FACTORY_JSON_PATH = path.join(ROOT_DIR, 'generated', 'ocp-factory-contract-id.json');
const DEFAULT_NETWORKS: readonly ContractNetwork[] = ['devnet'];

interface FactoryEntry {
  templateId: string;
  system_operator: string;
  factory_id: string;
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
  template_id?: string;
  system_operator?: string;
  factory_id?: string;
  package_name?: string;
  package_version?: string;
}

/** Parse `--networks devnet,mainnet` (default: DevNet only). */
export function parseNetworksArg(args: string[] = process.argv.slice(2)): ContractNetwork[] {
  const idx = args.indexOf('--networks');
  if (idx === -1) {
    return [...DEFAULT_NETWORKS];
  }
  const networks = (args[idx + 1] ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  if (networks.length === 0 || !networks.every(isContractNetwork)) {
    throw new Error(`--networks must list devnet and/or mainnet, got ${JSON.stringify(args[idx + 1] ?? '')}`);
  }
  return [...new Set(networks)];
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

export function getDarPath(packageName: string, version: string, darName: string, buildDir: string): string {
  return (
    getBackedUpDarPath(ROOT_DIR, packageName, version, darName) ??
    getFreshDarPath(ROOT_DIR, buildDir, version, darName) ??
    (() => {
      throw new Error(
        `No DAR found for ${packageName} ${version}. Run npm run build or npm run upload-dar before detecting factory state.`
      );
    })()
  );
}

export function analyzeNetwork(
  entry: Partial<FactoryEntry> | undefined,
  packageName: string,
  version: string,
  packageId: string
): NetworkResult {
  if (!entry || typeof entry.templateId !== 'string' || !entry.system_operator || !entry.factory_id) {
    // Absent, or an entry in the old v34 shape (a contract ID, no factory identity).
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
    template_id: entry.templateId,
    system_operator: entry.system_operator,
    factory_id: entry.factory_id,
    package_name: entry.packageName,
    package_version: entry.packageVersion,
  };
}

function main(): void {
  const networks = parseNetworksArg();
  const packageArg = parsePackageArg() ?? 'ocp';
  const pkg = getPackage(packageArg);
  if (!pkg) {
    throw new Error(`Unknown package: ${packageArg}`);
  }

  const darPath = getDarPath(pkg.name, pkg.version, pkg.darName, pkg.buildDir);
  const packageId = inspectDarPackageId(darPath, pkg.name, pkg.version);
  const factoryJson = readJsonFile<FactoryJson>(FACTORY_JSON_PATH) ?? {};
  const factories = Object.fromEntries(
    networks.map((network) => [network, analyzeNetwork(factoryJson[network], pkg.name, pkg.version, packageId)])
  ) as Partial<Record<ContractNetwork, NetworkResult>>;
  const missingNetworks = networks.filter((network) => !factories[network]?.exists);

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
        networks,
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
