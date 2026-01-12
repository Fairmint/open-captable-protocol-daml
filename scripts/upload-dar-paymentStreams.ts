#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import { createLedgerJsonApiClient } from './utils';
import { isContractNetwork, type ContractNetwork } from './types';
import {
  getDarPath,
  recordNetworkUpload,
} from './dar-utils';

const PACKAGE_NAME = 'CantonPayments';
const DAR_NAME = 'CantonPayments';
const DAR_VERSION = '0.0.30';

function getNetworkFromArgs(): ContractNetwork {
  const args = process.argv.slice(2);
  const networkIndex = args.findIndex(arg => arg === '--network' || arg === '-n');

  if (networkIndex === -1 || networkIndex === args.length - 1) {
    console.error('❌ Please specify a network using --network or -n (e.g., --network mainnet or --network devnet)');
    process.exit(1);
  }

  const network = args[networkIndex + 1].toLowerCase();
  if (!isContractNetwork(network)) {
    console.error('❌ Network must be either "mainnet" or "devnet"');
    process.exit(1);
  }

  return network;
}

function getPaymentsDarPath(): string {
  return getDarPath(PACKAGE_NAME, DAR_VERSION, DAR_NAME);
}

async function main() {
  const network = getNetworkFromArgs();
  console.log(`Uploading CantonPayments DAR file to ${network}...`);

  const darPath = getPaymentsDarPath();
  const providers = ['intellect', '5n'];

  for (const provider of providers) {
    console.log(`📤 Uploading to ${provider} provider...`);

    const client = createLedgerJsonApiClient(network, provider);

    await client.uploadDarFile({ filePath: darPath });

    console.log(`✅ CantonPayments DAR file uploaded successfully to ${provider} on ${network}`);
  }

  // Record the network upload in dars.lock if using backed-up DAR
  recordNetworkUpload(PACKAGE_NAME, DAR_VERSION, DAR_NAME, network);

  console.log(`🎉 CantonPayments DAR upload process completed for ${network}`);
}

main();
