/**
 * Shared package configurations and CLI utilities. Single source of truth: daml.yaml files. Versions are read
 * dynamically from each package's daml.yaml.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { isContractNetwork, type ContractNetwork } from './types';

// =============================================================================
// Package Configurations
// =============================================================================

export interface PackageConfig {
  /** Display name (e.g., 'OpenCapTable-v34') */
  name: string;
  /** DAR file name without extension (usually same as name) */
  darName: string;
  /** Current version (read from daml.yaml) */
  version: string;
  /** Source directory relative to repo root */
  sourceDir: string;
}

const ROOT_DIR = path.join(__dirname, '..');

/** Read version from a package's daml.yaml file. This ensures daml.yaml is the single source of truth. */
function readVersionFromDamlYaml(sourceDir: string): string {
  const yamlPath = path.join(ROOT_DIR, sourceDir, 'daml.yaml');
  if (!fs.existsSync(yamlPath)) {
    throw new Error(`daml.yaml not found: ${yamlPath}`);
  }
  const content = fs.readFileSync(yamlPath, 'utf8');
  const parsed = yaml.parse(content) as { version: string };
  return parsed.version;
}

/** Package definitions - versions are loaded lazily from daml.yaml. Keys are short aliases used in CLI commands. */
const PACKAGE_DEFS = {
  shared: { name: 'Shared', sourceDir: 'Shared' },
  ocp: { name: 'OpenCapTable-v34', sourceDir: 'OpenCapTable-v34' },
  reports: { name: 'OpenCapTableReports-v01', sourceDir: 'OpenCapTableReports-v01' },
  nft: { name: 'OpenCapTableNft-v01', sourceDir: 'OpenCapTableNft-v01' },
  nftIface: { name: 'OpenCapTableNftIface-v01', sourceDir: 'OpenCapTableNftIface-v01' },
  proof: { name: 'OpenCapTableProofOfOwnership-v01', sourceDir: 'OpenCapTableProofOfOwnership-v01' },
  paymentStreams: { name: 'CantonPayments', sourceDir: 'CantonPayments' },
  couponMinter: { name: 'CouponMinter', sourceDir: 'CouponMinter' },
} as const;

type PackageDefKey = keyof typeof PACKAGE_DEFS;

/** Build full package config by reading version from daml.yaml. */
function buildPackageConfig(def: { name: string; sourceDir: string }): PackageConfig {
  return {
    name: def.name,
    darName: def.name,
    version: readVersionFromDamlYaml(def.sourceDir),
    sourceDir: def.sourceDir,
  };
}

/** All known DAML packages with versions read from daml.yaml. Computed lazily on first access. */
let _packagesCache: Record<PackageDefKey, PackageConfig> | null = null;

function getPackages(): Record<PackageDefKey, PackageConfig> {
  if (!_packagesCache) {
    _packagesCache = {} as Record<PackageDefKey, PackageConfig>;
    for (const [key, def] of Object.entries(PACKAGE_DEFS)) {
      _packagesCache[key as PackageDefKey] = buildPackageConfig(def);
    }
  }
  return _packagesCache;
}

/** All package configs (one entry per CLI alias). */
export function getAllPackages(): PackageConfig[] {
  return Object.values(getPackages());
}

export type PackageKey = PackageDefKey;

/**
 * Get package config by short key (e.g., 'ocp') or full name (e.g., 'OpenCapTable-v34'). Key lookup is
 * case-insensitive.
 */
export function getPackage(keyOrName: string): PackageConfig | undefined {
  const packages = getPackages();
  const lowerKey = keyOrName.toLowerCase();
  // Case-insensitive key lookup
  const matchingKey = Object.keys(packages).find((k) => k.toLowerCase() === lowerKey);
  if (matchingKey) {
    return packages[matchingKey as PackageKey];
  }
  // Also support lookup by full name (case-insensitive)
  return Object.values(packages).find((pkg) => pkg.name.toLowerCase() === lowerKey);
}

/**
 * Get package config or throw an error if not found. Use this when a package is required and failure should be an
 * exception (e.g., in scripts that need a package to exist).
 */
export function requirePackageConfig(packageKey: string): PackageConfig {
  const pkg = getPackage(packageKey);
  if (!pkg) {
    throw new Error(`Unknown package key: ${packageKey}`);
  }
  return pkg;
}

/** Get all package keys. */
export function getPackageKeys(): PackageKey[] {
  return Object.keys(PACKAGE_DEFS) as PackageKey[];
}

// =============================================================================
// CLI Argument Parsing
// =============================================================================

/** Parse --network or -n argument. */
export function parseNetworkArg(args: string[] = process.argv.slice(2)): ContractNetwork | undefined {
  const idx = args.findIndex((arg) => arg === '--network' || arg === '-n');
  if (idx === -1 || idx === args.length - 1) return undefined;
  const value = args[idx + 1].toLowerCase();
  return isContractNetwork(value) ? value : undefined;
}

/** Parse --package or -p argument. */
export function parsePackageArg(args: string[] = process.argv.slice(2)): string | undefined {
  const idx = args.findIndex((arg) => arg === '--package' || arg === '-p');
  if (idx === -1 || idx === args.length - 1) return undefined;
  return args[idx + 1].toLowerCase();
}

/** Parse --version or -v argument. */
export function parseVersionArg(args: string[] = process.argv.slice(2)): string | undefined {
  const idx = args.findIndex((arg) => arg === '--version' || arg === '-v');
  if (idx === -1 || idx === args.length - 1) return undefined;
  return args[idx + 1];
}

/** Require network argument or exit with error. */
export function requireNetwork(scriptName: string): ContractNetwork {
  const network = parseNetworkArg();
  if (!network) {
    console.error(`❌ Missing --network argument`);
    console.error(`Usage: tsx scripts/${scriptName} --network <devnet|mainnet>`);
    process.exit(1);
  }
  return network;
}

/** Require package argument or exit with error. */
export function requirePackage(scriptName: string): PackageConfig {
  const packageKey = parsePackageArg();
  if (!packageKey) {
    printPackageUsage(scriptName, 'Missing --package argument');
    process.exit(1);
  }
  const pkg = getPackage(packageKey);
  if (!pkg) {
    printPackageUsage(scriptName, `Unknown package: ${packageKey}`);
    process.exit(1);
  }
  return pkg;
}

// =============================================================================
// Usage Helpers
// =============================================================================

/** Print usage with available packages. */
export function printPackageUsage(scriptName: string, errorMessage?: string): void {
  if (errorMessage) {
    console.error(`❌ ${errorMessage}`);
    console.error('');
  }
  console.error(`Usage: tsx scripts/${scriptName} --package <package> --network <network>`);
  console.error('');
  console.error('Packages:');
  const packages = getPackages();
  for (const [key, pkg] of Object.entries(packages)) {
    console.error(`  ${key.padEnd(15)} → ${pkg.name} v${pkg.version}`);
  }
  console.error('');
  console.error('Networks: devnet, mainnet');
}

// =============================================================================
// Template ID Utilities
// =============================================================================

/**
 * Build a DAML template ID dynamically from package config. Format: #<package-name>:<module>:<template>
 *
 * This ensures we always use the correct package version from daml.yaml (single source of truth), avoiding hardcoded
 * version references that become stale after upgrades.
 *
 * @param packageKey - Package key (e.g., 'ocp') or full name (e.g., 'OpenCapTable-v34')
 * @param module - Full module path (e.g., 'Fairmint.OpenCapTable.OcpFactory')
 * @param template - Template name (e.g., 'OcpFactory')
 */
export function buildTemplateId(packageKey: string, module: string, template: string): string {
  const pkg = getPackage(packageKey);
  if (!pkg) {
    throw new Error(`Unknown package: ${packageKey}. Valid keys: ${getPackageKeys().join(', ')}`);
  }
  return `#${pkg.name}:${module}:${template}`;
}
