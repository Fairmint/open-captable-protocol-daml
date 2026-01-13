#!/usr/bin/env node

import { createLedgerJsonApiClient } from './utils';
import { isContractNetwork, type ContractNetwork } from './types';
import { getDarPath, recordNetworkUpload } from './dar-utils';

interface PackageConfig {
  packageName: string;
  darName: string;
  version: string;
}

// Known package configurations
const PACKAGE_CONFIGS: Record<string, PackageConfig> = {
  ocp: {
    packageName: 'OpenCapTable-v25',
    darName: 'OpenCapTable-v25',
    version: '0.0.1',
  },
  reports: {
    packageName: 'OpenCapTableReports-v01',
    darName: 'OpenCapTableReports-v01',
    version: '0.0.2',
  },
  paymentStreams: {
    packageName: 'CantonPayments',
    darName: 'CantonPayments',
    version: '0.0.30',
  },
  couponMinter: {
    packageName: 'CouponMinter',
    darName: 'CouponMinter',
    version: '0.0.1',
  },
};

type PackageKey = keyof typeof PACKAGE_CONFIGS;

function parseArgs(): { network: ContractNetwork; package: PackageKey } {
  const args = process.argv.slice(2);

  // Parse network
  const networkIndex = args.findIndex(arg => arg === '--network' || arg === '-n');
  if (networkIndex === -1 || networkIndex === args.length - 1) {
    printUsageAndExit('Please specify a network using --network or -n');
  }
  const network = args[networkIndex + 1].toLowerCase();
  if (!isContractNetwork(network)) {
    printUsageAndExit('Network must be either "mainnet" or "devnet"');
  }

  // Parse package
  const packageIndex = args.findIndex(arg => arg === '--package' || arg === '-p');
  if (packageIndex === -1 || packageIndex === args.length - 1) {
    printUsageAndExit('Please specify a package using --package or -p');
  }
  const packageKey = args[packageIndex + 1].toLowerCase();
  if (!(packageKey in PACKAGE_CONFIGS)) {
    printUsageAndExit(`Unknown package: ${packageKey}`);
  }

  return { network, package: packageKey as PackageKey };
}

function printUsageAndExit(message: string): never {
  console.error(`❌ ${message}`);
  console.error('');
  console.error('Usage: tsx scripts/upload-dar.ts --package <package> --network <network>');
  console.error('');
  console.error('Available packages:');
  Object.entries(PACKAGE_CONFIGS).forEach(([key, config]) => {
    console.error(`  ${key.padEnd(15)} → ${config.packageName} v${config.version}`);
  });
  console.error('');
  console.error('Networks: devnet, mainnet');
  process.exit(1);
}

async function main() {
  const { network, package: packageKey } = parseArgs();
  const config = PACKAGE_CONFIGS[packageKey];

  console.log(`Uploading ${config.packageName} v${config.version} DAR to ${network}...`);

  const darPath = getDarPath(config.packageName, config.version, config.darName);
  const providers = ['intellect', '5n'] as const;

  for (const provider of providers) {
    console.log(`📤 Uploading to ${provider} provider...`);

    const client = createLedgerJsonApiClient(network, provider);
    await client.uploadDarFile({ filePath: darPath });

    console.log(`✅ DAR uploaded successfully to ${provider} on ${network}`);
  }

  // Record the network upload in dars.lock if using backed-up DAR
  recordNetworkUpload(config.packageName, config.version, config.darName, network);

  console.log(`🎉 ${config.packageName} DAR upload completed for ${network}`);
}

main();
