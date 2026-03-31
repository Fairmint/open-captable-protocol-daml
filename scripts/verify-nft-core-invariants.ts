#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import * as yaml from 'yaml';

interface DamlConfig {
  dependencies?: string[];
  ['data-dependencies']?: string[];
}

const NFT_CORE_DAML_YAML = path.join(__dirname, '..', 'OpenCapTableNft-v01', 'daml.yaml');
const BLOCKED_DEPENDENCY_PATTERNS = [/splice-api-token-/i, /splice-amulet/i];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function collectBlockedDependencies(config: DamlConfig): string[] {
  const declaredDependencies = [...(config.dependencies ?? []), ...(config['data-dependencies'] ?? [])];

  return declaredDependencies.filter((dependency) =>
    BLOCKED_DEPENDENCY_PATTERNS.some((pattern) => pattern.test(dependency))
  );
}

function main(): void {
  console.log('🔍 Verifying NFT core package invariants...');

  try {
    const config = yaml.parse(fs.readFileSync(NFT_CORE_DAML_YAML, 'utf8')) as DamlConfig;
    const blockedDependencies = collectBlockedDependencies(config);

    if (blockedDependencies.length > 0) {
      throw new Error(
        `OpenCapTableNft-v01 must remain independent from Splice token packages. Found: ${blockedDependencies.join(
          ', '
        )}`
      );
    }

    console.log('✅ NFT core package has no Splice token package dependencies.');
  } catch (error) {
    console.error('❌ NFT core invariant failed:', getErrorMessage(error));
    process.exit(1);
  }
}

main();
