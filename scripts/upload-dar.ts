#!/usr/bin/env node

import { LedgerJsonApiClient } from '@fairmint/canton-node-sdk';
import * as path from 'path';

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
  
  const client = new LedgerJsonApiClient();
  await client.uploadDarFile({ filePath: path.join(__dirname, '..', 'OpenCapTable-v02', '.daml', 'dist', 'OpenCapTable-v02-0.0.2.dar') });

  console.log(`✅ DAR file uploaded successfully to ${network}`);
}

main(); 