/**
 * Shared package configurations and CLI utilities.
 * Single source of truth for all DAML package metadata.
 */

import { isContractNetwork, type ContractNetwork } from './types';

// =============================================================================
// Package Configurations
// =============================================================================

export interface PackageConfig {
  /** Display name (e.g., 'OpenCapTable-v25') */
  name: string;
  /** DAR file name without extension (usually same as name) */
  darName: string;
  /** Current version */
  version: string;
  /** Source directory relative to repo root */
  sourceDir: string;
}

/**
 * All known DAML packages.
 * Keys are short aliases used in CLI commands.
 */
export const PACKAGES = {
  ocp: {
    name: 'OpenCapTable-v25',
    darName: 'OpenCapTable-v25',
    version: '0.0.1',
    sourceDir: 'OpenCapTable-v25',
  },
  reports: {
    name: 'OpenCapTableReports-v01',
    darName: 'OpenCapTableReports-v01',
    version: '0.0.2',
    sourceDir: 'OpenCapTableReports-v01',
  },
  paymentStreams: {
    name: 'CantonPayments',
    darName: 'CantonPayments',
    version: '0.0.30',
    sourceDir: 'CantonPayments',
  },
  couponMinter: {
    name: 'CouponMinter',
    darName: 'CouponMinter',
    version: '0.0.1',
    sourceDir: 'CouponMinter',
  },
} as const satisfies Record<string, PackageConfig>;

export type PackageKey = keyof typeof PACKAGES;

/**
 * Get package config by short key (e.g., 'ocp') or full name (e.g., 'OpenCapTable-v25').
 */
export function getPackage(keyOrName: string): PackageConfig | undefined {
  const lowerKey = keyOrName.toLowerCase();
  if (lowerKey in PACKAGES) {
    return PACKAGES[lowerKey as PackageKey];
  }
  // Also support lookup by full name
  return Object.values(PACKAGES).find(pkg => pkg.name === keyOrName);
}

/**
 * Get all package keys.
 */
export function getPackageKeys(): PackageKey[] {
  return Object.keys(PACKAGES) as PackageKey[];
}

// =============================================================================
// CLI Argument Parsing
// =============================================================================

/**
 * Parse --network or -n argument.
 */
export function parseNetworkArg(args: string[] = process.argv.slice(2)): ContractNetwork | undefined {
  const idx = args.findIndex(arg => arg === '--network' || arg === '-n');
  if (idx === -1 || idx === args.length - 1) return undefined;
  const value = args[idx + 1].toLowerCase();
  return isContractNetwork(value) ? value : undefined;
}

/**
 * Parse --package or -p argument.
 */
export function parsePackageArg(args: string[] = process.argv.slice(2)): string | undefined {
  const idx = args.findIndex(arg => arg === '--package' || arg === '-p');
  if (idx === -1 || idx === args.length - 1) return undefined;
  return args[idx + 1].toLowerCase();
}

/**
 * Parse --version or -v argument.
 */
export function parseVersionArg(args: string[] = process.argv.slice(2)): string | undefined {
  const idx = args.findIndex(arg => arg === '--version' || arg === '-v');
  if (idx === -1 || idx === args.length - 1) return undefined;
  return args[idx + 1];
}

/**
 * Require network argument or exit with error.
 */
export function requireNetwork(scriptName: string): ContractNetwork {
  const network = parseNetworkArg();
  if (!network) {
    console.error(`❌ Missing --network argument`);
    console.error(`Usage: tsx scripts/${scriptName} --network <devnet|mainnet>`);
    process.exit(1);
  }
  return network;
}

/**
 * Require package argument or exit with error.
 */
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

/**
 * Print usage with available packages.
 */
export function printPackageUsage(scriptName: string, errorMessage?: string): void {
  if (errorMessage) {
    console.error(`❌ ${errorMessage}`);
    console.error('');
  }
  console.error(`Usage: tsx scripts/${scriptName} --package <package> --network <network>`);
  console.error('');
  console.error('Packages:');
  for (const [key, pkg] of Object.entries(PACKAGES)) {
    console.error(`  ${key.padEnd(15)} → ${pkg.name} v${pkg.version}`);
  }
  console.error('');
  console.error('Networks: devnet, mainnet');
}
