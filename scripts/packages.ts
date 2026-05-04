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
  /** Generated JS package metadata, if this package produces a generated package. */
  generated?: GeneratedPackageMetadata;
}

export interface GeneratedPackageMetadata {
  /** Whether scripts should create standalone package index files for this generated package. */
  createIndex: boolean;
  /**
   * Published npm package suffix for generated packages.
   *
   * - `null` means publish as the root package name
   * - `string` means append `-${suffix}` to the root package name
   * - `undefined` means this generated package is not published standalone
   */
  publishNameSuffix?: string | null;
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

interface PackageDef {
  name: string;
  sourceDir: string;
  generated?: GeneratedPackageMetadata;
}

/** Package definitions - versions are loaded lazily from daml.yaml. Keys are short aliases used in CLI commands. */
const PACKAGE_DEFS = {
  ocp: {
    name: 'OpenCapTable-v34',
    sourceDir: 'OpenCapTable-v34',
    generated: { createIndex: true, publishNameSuffix: null },
  },
} as const satisfies Record<string, PackageDef>;

type PackageDefKey = keyof typeof PACKAGE_DEFS;

/** Build full package config by reading version from daml.yaml. */
function buildPackageConfig(def: PackageDef): PackageConfig {
  return {
    name: def.name,
    darName: def.name,
    version: readVersionFromDamlYaml(def.sourceDir),
    sourceDir: def.sourceDir,
    generated: def.generated ? { ...def.generated } : undefined,
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

function resolvePackageKey(key: string): PackageDefKey | undefined {
  const lowerKey = key.toLowerCase();
  return (Object.keys(PACKAGE_DEFS) as PackageDefKey[]).find(
    (candidate) => candidate.toLowerCase() === lowerKey
  );
}

/**
 * Get package config by short key (e.g., 'ocp') or full name (e.g., 'OpenCapTable-v34'). Key lookup is
 * case-insensitive.
 */
export function getPackage(keyOrName: string): PackageConfig | undefined {
  const packages = getPackages();
  const matchingKey = resolvePackageKey(keyOrName);
  if (matchingKey) {
    return packages[matchingKey];
  }
  // Also support lookup by full name (case-insensitive)
  return Object.values(packages).find((pkg) => pkg.name.toLowerCase() === keyOrName.toLowerCase());
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
  return [...(Object.keys(PACKAGE_DEFS) as PackageDefKey[])];
}

export interface GeneratedPackageConfig {
  key: PackageDefKey;
  package: PackageConfig;
  dir: string;
  publishedPackageName?: string;
}

export interface PublishableGeneratedPackageConfig extends GeneratedPackageConfig {
  publishedPackageName: string;
}

function buildPublishedPackageName(rootPackageName: string, suffix?: string | null): string | undefined {
  if (suffix === undefined) {
    return undefined;
  }
  return suffix === null ? rootPackageName : `${rootPackageName}-${suffix}`;
}

/** Resolve the generated JS output directory for a package. */
export function getGeneratedPackageDir(packageKey: string): string {
  const pkg = requirePackageConfig(packageKey);
  return path.join(ROOT_DIR, 'generated', 'js', `${pkg.name}-${pkg.version}`);
}

/** Generated packages that should receive standalone index files. */
export function getGeneratedPackages(rootPackageName?: string): GeneratedPackageConfig[] {
  const packages = getPackages();

  return (Object.keys(PACKAGE_DEFS) as PackageDefKey[])
    .map((key): GeneratedPackageConfig | null => {
      const pkg = packages[key];
      if (!pkg.generated?.createIndex) {
        return null;
      }
      return {
        key,
        package: pkg,
        dir: getGeneratedPackageDir(key),
        publishedPackageName: rootPackageName
          ? buildPublishedPackageName(rootPackageName, pkg.generated.publishNameSuffix)
          : undefined,
      };
    })
    .filter((pkg): pkg is GeneratedPackageConfig => pkg !== null);
}

/** Generated packages that are published as standalone npm packages. */
export function getPublishableGeneratedPackages(rootPackageName: string): PublishableGeneratedPackageConfig[] {
  return getGeneratedPackages(rootPackageName).filter(
    (pkg): pkg is PublishableGeneratedPackageConfig => pkg.publishedPackageName !== undefined
  );
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
