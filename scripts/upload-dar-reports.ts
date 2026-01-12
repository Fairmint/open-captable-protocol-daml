#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import { createLedgerJsonApiClient } from './utils';
import { isContractNetwork, type ContractNetwork } from './types';
import {
  getBackedUpDarPath,
  warnIfBuildingFresh,
  recordNetworkUpload,
  DarIntegrityError,
} from './dar-utils';

const PACKAGE_NAME = 'OpenCapTableReports-v01';
const DAR_NAME = 'OpenCapTableReports-v01';
const DAR_VERSION = '0.0.2';

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

function getDarPath(): string {
  const rootDir = path.join(__dirname, '..');

  // First, check if we have a backed-up DAR (throws DarIntegrityError if tampered)
  try {
    const backedUpPath = getBackedUpDarPath(PACKAGE_NAME, DAR_VERSION, DAR_NAME);
    if (backedUpPath) {
      console.log(`📦 Using backed-up DAR: ${path.relative(rootDir, backedUpPath)}`);
      return backedUpPath;
    }
  } catch (error) {
    if (error instanceof DarIntegrityError) {
      console.error(`❌ ${error.message}`);
      console.error('   This is a security concern. Please investigate before proceeding.');
      process.exit(1);
    }
    throw error;
  }

  // Fall back to freshly built DAR
  const freshPath = path.join(rootDir, PACKAGE_NAME, '.daml', 'dist', `${DAR_NAME}-${DAR_VERSION}.dar`);
  warnIfBuildingFresh(PACKAGE_NAME, DAR_VERSION);

  if (!fs.existsSync(freshPath)) {
    console.error(`❌ DAR file not found: ${freshPath}`);
    console.error('Run "npm run build" first to build the DAR.');
    process.exit(1);
  }

  return freshPath;
}

async function main() {
  const network = getNetworkFromArgs();
  console.log(`Uploading Reports DAR file to ${network}...`);

  const darPath = getDarPath();
  const providers = ['intellect', '5n'];

  for (const provider of providers) {
    console.log(`📤 Uploading to ${provider} provider...`);

    const client = createLedgerJsonApiClient(network, provider);

    await client.uploadDarFile({ filePath: darPath });

    console.log(`✅ Reports DAR file uploaded successfully to ${provider} on ${network}`);
  }

  // Record the network upload in dars.lock if using backed-up DAR
  recordNetworkUpload(PACKAGE_NAME, DAR_VERSION, DAR_NAME, network);

  console.log(`🎉 Reports DAR upload process completed for ${network}`);
}

main();
