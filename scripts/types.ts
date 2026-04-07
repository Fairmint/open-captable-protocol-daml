/** Shared types and utilities for TypeScript scripts. Eliminates need for `any` type assertions throughout the codebase. */

// Re-export SDK types for convenience
export type { ApiConfig, AuthConfig, ClientConfig, NetworkType, ProviderType } from '@fairmint/canton-node-sdk';

/** Networks this repo’s scripts treat as valid (no staging). */
export const VALID_NETWORKS = ['devnet', 'testnet', 'mainnet', 'localnet'] as const;

export type FairmintScriptNetwork = (typeof VALID_NETWORKS)[number];

/** Type guard for script-level network strings (subset of Canton SDK networks). */
export function isValidNetwork(value: string): value is FairmintScriptNetwork {
  return (VALID_NETWORKS as readonly string[]).includes(value);
}

/** Asserts a script-level network string; throws if not in {@link VALID_NETWORKS}. */
export function assertValidNetwork(value: string): FairmintScriptNetwork {
  if (!isValidNetwork(value)) {
    throw new Error(`Invalid network: "${value}". Must be one of: ${VALID_NETWORKS.join(', ')}`);
  }
  return value;
}

/** Extracts an error message from an unknown error value. Use this in catch blocks instead of typing error as `any`. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

/** Package.json structure with optional fields. */
export interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  'peer-dependencies'?: Record<string, string>;
  publishConfig?: { access?: string };
  [key: string]: unknown;
}

/** Network-specific contract ID data. */
export interface NetworkContractData {
  contractId?: string;
  templateId?: string;
  [key: string]: unknown;
}

/** Contract ID JSON file structure (mainnet / devnet). */
export interface ContractIdJson {
  mainnet?: NetworkContractData;
  devnet?: NetworkContractData;
}

/** Valid network keys for contract ID files and factory scripts. */
export type ContractNetwork = 'mainnet' | 'devnet';

/** Type guard for ContractNetwork. */
export function isContractNetwork(value: string): value is ContractNetwork {
  return value === 'mainnet' || value === 'devnet';
}
