#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import { createLedgerJsonApiClient, createValidatorApiClient } from './utils';

interface ContractIdData {
  mainnet?: {
    subscriptionsFactoryContractId: string;
    templateId: string;
  };
  devnet?: {
    subscriptionsFactoryContractId: string;
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
  return path.join(__dirname, '..', 'generated', 'subscriptions-factory-contract-id.json');
}

function loadExistingContractIds(outputPath: string): ContractIdData {
  try {
    if (fs.existsSync(outputPath)) {
      const content = fs.readFileSync(outputPath, 'utf8');
      return JSON.parse(content) as ContractIdData;
    }
  } catch (err) {
    console.warn('⚠️  Failed to read existing subscriptions factory contract id file. Proceeding to create a new one.');
  }
  return {};
}

async function main() {
  const network = getNetworkFromArgs();
  console.log(`Creating SubscriptionFactory contract for ${network}...`);

  // Import from the combined lib built by scripts/create-root-index.ts
  const { Fairmint } = await import('../lib');

  const client = createLedgerJsonApiClient(network, 'intellect');

  if (!Fairmint?.Subscriptions?.SubscriptionFactory?.SubscriptionFactory) {
    throw new Error('Generated DAML types not found for Subscriptions package. Please run "npm run codegen" first.');
  }

  console.log(`Template ID: ${Fairmint.Subscriptions.SubscriptionFactory.SubscriptionFactory.templateId}`);

  const validatorClient = createValidatorApiClient(network, 'intellect');
  const intellectPartyId = client.getPartyId();

  // Get DSO party ID
  console.log('Looking up DSO party...');
  const dsoPartyId = await validatorClient.getDsoPartyId();
  if (!dsoPartyId) {
    throw new Error('Could not determine DSO party ID');
  }
  console.log(`✅ DSO Party: ${dsoPartyId}`);

  const subscriptionFactoryData: any = {
    context: {
      processor: intellectPartyId,
      dso: dsoPartyId,
    },
  };

  const createCommand = {
    templateId: Fairmint.Subscriptions.SubscriptionFactory.SubscriptionFactory.templateId,
    createArguments: subscriptionFactoryData,
  };

  try {
    console.log('Submitting SubscriptionFactory contract creation transaction...');

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
    if (!firstEvent || !('CreatedTreeEvent' in firstEvent)) {
      throw new Error('First event is not a CreatedTreeEvent');
    }
    const createdTreeEvent = firstEvent.CreatedTreeEvent;

    const contractId = createdTreeEvent.value.contractId;
    if (!contractId) {
      throw new Error('Contract ID not found in CreatedTreeEvent');
    }

    console.log(`✅ SubscriptionFactory contract created with ID: ${contractId}`);

    const outputPath = getOutputPath();
    const data = loadExistingContractIds(outputPath);
    data[network as 'mainnet' | 'devnet'] = {
      subscriptionsFactoryContractId: contractId,
      templateId: createdTreeEvent.value.templateId,
    } as any;
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`📝 Saved contract ID to ${outputPath}`);
  } catch (error) {
    console.error('❌ Failed to create SubscriptionFactory contract:', error);
    process.exit(1);
  }
}

main();

