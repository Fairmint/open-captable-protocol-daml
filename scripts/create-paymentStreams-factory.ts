#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import { createLedgerJsonApiClient, createValidatorApiClient } from './utils';
import type { DisclosedContract } from '@fairmint/canton-node-sdk/build/src/clients/ledger-json-api/schemas/api/commands';
import { isContractNetwork, type ContractNetwork } from './types';

interface PaymentStreamsFactoryContractData {
  paymentStreamsFactoryContractId: string;
  templateId: string;
  disclosedContract: DisclosedContract;
}

interface ContractIdData {
  mainnet?: PaymentStreamsFactoryContractData;
  devnet?: PaymentStreamsFactoryContractData;
}

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

function getOutputPath(): string {
  return path.join(__dirname, '..', 'generated', 'paymentStreams-factory-contract-id.json');
}

function loadExistingContractIds(outputPath: string): ContractIdData {
  try {
    if (fs.existsSync(outputPath)) {
      const content = fs.readFileSync(outputPath, 'utf8');
      return JSON.parse(content) as ContractIdData;
    }
  } catch (err) {
    console.warn('⚠️  Failed to read existing paymentStreams factory contract id file. Proceeding to create a new one.');
  }
  return {};
}

async function main() {
  const network = getNetworkFromArgs();
  console.log(`Creating PaymentStreamFactory contract for ${network}...`);

  // Import from the combined lib built by scripts/create-root-index.ts
  const { CantonPayments } = await import('../lib');

  const client = createLedgerJsonApiClient(network, '5n');

  if (!CantonPayments?.PaymentStream?.PaymentStreamFactory?.PaymentStreamFactory) {
    throw new Error('Generated DAML types not found for CantonPayments package. Please run "npm run codegen" first.');
  }

  console.log(`Template ID: ${CantonPayments.PaymentStream.PaymentStreamFactory.PaymentStreamFactory.templateId}`);

  const validatorClient = createValidatorApiClient(network, '5n');
  const clientPartyId = client.getPartyId();

  // Get DSO party ID
  console.log('Looking up DSO party...');
  const dsoResponse = await validatorClient.getDsoPartyId();
  if (!dsoResponse || !dsoResponse.dso_party_id) {
    throw new Error('Could not determine DSO party ID');
  }
  const dsoPartyId = dsoResponse.dso_party_id;
  console.log(`✅ DSO Party: ${dsoPartyId}`);

  const paymentStreamFactoryData = {
    processorContext: {
      processor: network === 'devnet' ? 'test-subscription-processor::1220ea70ea2cbfe6be431f34c7323e249c624a02fb2209d2b73fabd7eea1fe84df34' : "SubscriptionProcessor::12204a039322c01e9f714b56259c3e68b69058bf5dfe1debbe956c698f905ceba9d7", // TODO; Move to env vars and make network dependent
      dso: dsoPartyId,
    },
  };

  const createCommand = {
    templateId: CantonPayments.PaymentStream.PaymentStreamFactory.PaymentStreamFactory.templateId,
    createArguments: paymentStreamFactoryData,
  };

  try {
    console.log('Submitting PaymentStreamFactory contract creation transaction...');

    const response = await client.submitAndWaitForTransactionTree({
      commands: [{
        CreateCommand: createCommand,
      }],
      actAs: [paymentStreamFactoryData.processorContext.processor],
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

    console.log(`✅ PaymentStreamFactory contract created with ID: ${contractId}`);

    // Fetch the disclosed contract data
    // Note: We need to fetch the contract again because CreatedTreeEvent doesn't include
    // the createdEventBlob field, which is required for disclosed contracts
    console.log('Fetching disclosed contract data...');
    const factoryEventsResponse = await client.getEventsByContractId({
      contractId,
      readAs: [paymentStreamFactoryData.processorContext.processor],
    });

    const createdEvent = factoryEventsResponse.created?.createdEvent;
    if (!createdEvent) {
      throw new Error(`Factory contract ${contractId} not found when fetching disclosed contract data`);
    }

    const disclosedContract: DisclosedContract = {
      templateId: createdEvent.templateId,
      contractId: createdEvent.contractId,
      createdEventBlob: createdEvent.createdEventBlob,
      synchronizerId: factoryEventsResponse.created!.synchronizerId,
    };

    console.log('✅ Disclosed contract data fetched');

    const outputPath = getOutputPath();
    const data = loadExistingContractIds(outputPath);
    data[network] = {
      paymentStreamsFactoryContractId: contractId,
      templateId: createdTreeEvent.value.templateId,
      disclosedContract,
    };
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`📝 Saved contract ID and disclosed contract to ${outputPath}`);
  } catch (error) {
    console.error('❌ Failed to create PaymentStreamFactory contract:', error);
    process.exit(1);
  }
}

main();

