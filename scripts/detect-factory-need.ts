#!/usr/bin/env node
/**
 * Detect whether the current OCP package version already has recorded factory contracts.
 *
 * Usage: tsx scripts/detect-factory-need.ts --package ocp
 */

import * as fs from 'fs';
import * as path from 'path';
import { inspectDarPackageId } from './dar-package-id';
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

function getDarPath(packageName: string, version: string, darName: string): string {
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

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`❌ ${message}`);
  process.exit(1);
}
