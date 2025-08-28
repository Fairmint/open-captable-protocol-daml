#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import { createLedgerJsonApiClient, createValidatorApiClient } from './utils';

interface ContractIdData {
  mainnet?: {
    reportsFactoryContractId: string;
    templateId: string;
  };
  devnet?: {
    reportsFactoryContractId: string;
    templateId: string;
  };
}

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

function getOutputPath(): string {
  return path.join(__dirname, '..', 'generated', 'reports-factory-contract-id.json');
}

function loadExistingContractIds(outputPath: string): ContractIdData {
  try {
    if (fs.existsSync(outputPath)) {
      const content = fs.readFileSync(outputPath, 'utf8');
      return JSON.parse(content) as ContractIdData;
    }
  } catch (err) {
    console.warn('⚠️  Failed to read existing reports factory contract id file. Proceeding to create a new one.');
  }
  return {};
}

async function main() {
  const network = getNetworkFromArgs();
  console.log(`Creating ReportsFactory contract for ${network}...`);

  // Import from the combined lib built by scripts/create-root-index.ts
  const { Fairmint } = await import('../lib');

  const client = createLedgerJsonApiClient(network, 'intellect');

  if (!Fairmint?.OpenCapTableReports?.ReportsFactory?.ReportsFactory) {
    throw new Error('Generated DAML types not found for Reports package. Please run "npm run codegen" first.');
  }

  console.log(`Template ID: ${Fairmint.OpenCapTableReports.ReportsFactory.ReportsFactory.templateId}`);

  const validatorClient = createValidatorApiClient(network, 'intellect');
  const intellectPartyId = client.getPartyId();

  console.log('Looking up existing FeaturedAppRight contract...');
  const featuredAppRight = await validatorClient.lookupFeaturedAppRight({ partyId: intellectPartyId });
  if (!featuredAppRight || !featuredAppRight.featured_app_right) {
    throw new Error(`No featured app right found for party ${intellectPartyId}`);
  }
  const featuredAppRightContractId = typeof featuredAppRight.featured_app_right === 'string'
    ? featuredAppRight.featured_app_right
    : featuredAppRight.featured_app_right.contract_id || featuredAppRight.featured_app_right;

  console.log(`✅ Found FeaturedAppRight contract: ${featuredAppRightContractId}`);

  const reportsFactoryData: any = {
    system_operator: intellectPartyId,
    featured_app_right: featuredAppRightContractId,
  };

  const createCommand = {
    templateId: Fairmint.OpenCapTableReports.ReportsFactory.ReportsFactory.templateId,
    createArguments: reportsFactoryData,
  };

  try {
    console.log('Submitting ReportsFactory contract creation transaction...');

    const response = await client.submitAndWaitForTransactionTree({
      commands: [{
        CreateCommand: createCommand,
      }],
    });

    const eventsById = response.transactionTree?.eventsById;
    if (!eventsById || Object.keys(eventsById).length === 0) {
      throw new Error('No events found in transaction response');
    }

    const firstEvent = eventsById[Object.keys(eventsById)[0]];
    const createdTreeEvent = firstEvent?.CreatedTreeEvent;
    if (!createdTreeEvent) {
      throw new Error('First event is not a CreatedTreeEvent');
    }

    const contractId = createdTreeEvent.value.contractId;
    if (!contractId) {
      throw new Error('Contract ID not found in CreatedTreeEvent');
    }

    console.log(`✅ ReportsFactory contract created with ID: ${contractId}`);

    const outputPath = getOutputPath();
    const data = loadExistingContractIds(outputPath);
    data[network as 'mainnet' | 'devnet'] = {
      reportsFactoryContractId: contractId,
      templateId: createdTreeEvent.value.templateId,
    } as any;
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`📝 Saved contract ID to ${outputPath}`);
  } catch (error) {
    console.error('❌ Failed to create ReportsFactory contract:', error);
    process.exit(1);
  }
}

main();
