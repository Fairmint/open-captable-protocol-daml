#!/usr/bin/env node

import { LedgerJsonApiClient } from '@fairmint/canton-node-sdk';
import * as path from 'path';
import { createLedgerJsonApiClient } from './utils';

function getNetworkFromArgs(): string {
  const args = process.argv.slice(2);
  const networkIndex = args.findIndex(arg => arg === '--network' || arg === '-n');

  if (networkIndex === -1 || networkIndex === args.length - 1) {
    console.error('❌ Please specify a network using --network or -n (e.g., --network mainnet or --network devnet)');
    process.exit(1);
  }

  const network = args[networkIndex + 1].toLowerCase();
  if (network !== 'mainnet' && network !== 'devnet') {
    console.error('❌ Network must be either "mainnet" or "devnet"');
    process.exit(1);
  }

  return network;
}

async function main() {
  const network = getNetworkFromArgs();
  console.log(`Uploading DAR file to ${network}...`);

  const providers = ['intellect', '5n'];

  for (const provider of providers) {
    console.log(`📤 Uploading to ${provider} provider...`);

    // Create client using EnvLoader
    const client = createLedgerJsonApiClient(network, provider);

    await client.uploadDarFile({ filePath: path.join(__dirname, '..', 'OpenCapTable-v08', '.daml', 'dist', 'OpenCapTable-v08-0.0.1.dar') });

    console.log(`✅ DAR file uploaded successfully to ${provider} on ${network}`);
  }

  console.log(`🎉 DAR upload process completed for ${network}`);
}

main();
