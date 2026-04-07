/** Shared types and utilities for TypeScript scripts. Eliminates need for `any` type assertions throughout the codebase. */

// Re-export SDK types for convenience
export type { ApiConfig, AuthConfig, ClientConfig, NetworkType, ProviderType } from '@fairmint/canton-node-sdk';

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
