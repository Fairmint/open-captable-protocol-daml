#!/usr/bin/env node

import { LedgerJsonApiClient } from '@fairmint/canton-node-sdk';
import * as fs from 'fs';
import * as path from 'path';
// Import from the combined lib built by scripts/create-root-index.ts
import { Fairmint } from '../lib';
import { createLedgerJsonApiClient, createValidatorApiClient } from './utils';

// Define the contract ID file structure
interface ContractIdData {
  mainnet?: {
    ocpFactoryContractId: string;
    templateId: string;
  };
  devnet?: {
    ocpFactoryContractId: string;
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

function loadExistingContractIds(outputPath: string): ContractIdData {
  try {
    if (fs.existsSync(outputPath)) {
      const existingData = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

      // Handle legacy format (single contract ID)
      if (existingData.ocpFactoryContractId && !existingData.mainnet && !existingData.devnet) {
        console.log('⚠️  Found legacy format, converting to new multi-network format...');
        return {
          mainnet: {
            ocpFactoryContractId: existingData.ocpFactoryContractId,
            templateId: existingData.templateId
          }
        };
      }

      return existingData;
    }
  } catch (error) {
    console.warn('⚠️  Could not read existing contract ID file, starting fresh');
  }

  return {};
}

async function main() {
  const network = getNetworkFromArgs();
  console.log(`Creating OcpFactory contract for ${network}...`);

  // Create client using EnvLoader
  const client = createLedgerJsonApiClient(network, 'intellect');

  // Validate that the generated types are available
  if (!Fairmint?.OpenCapTable?.OcpFactory?.OcpFactory) {
    throw new Error('Generated DAML types not found. Please run "npm run codegen" first.');
  }

  console.log(`Template ID: ${Fairmint.OpenCapTable.OcpFactory.OcpFactory.templateId}`);

  // Create validator client to lookup featured app right
  const validatorClient = createValidatorApiClient(network, 'intellect');
  const intellectPartyId = client.getPartyId();

  // Lookup featured app right for intellect party
  console.log('Looking up existing FeaturedAppRight contract...');
  const featuredAppRight = await validatorClient.lookupFeaturedAppRight({ partyId: intellectPartyId });
  if (!featuredAppRight || !featuredAppRight.featured_app_right) {
    throw new Error(`No featured app right found for party ${intellectPartyId}`);
  }

  // Extract the contract ID - it might be nested in the response
  const featuredAppRightContractId = typeof featuredAppRight.featured_app_right === 'string'
    ? featuredAppRight.featured_app_right
    : featuredAppRight.featured_app_right.contract_id || featuredAppRight.featured_app_right;

  console.log(`✅ Found FeaturedAppRight contract: ${featuredAppRightContractId}`);

  // Now create the OcpFactory with the featured_app_right field
  const ocpFactoryData: Fairmint.OpenCapTable.OcpFactory.OcpFactory = {
    system_operator: intellectPartyId,
    featured_app_right: featuredAppRightContractId
  };

  const createCommand = {
    templateId: Fairmint.OpenCapTable.OcpFactory.OcpFactory.templateId,
    createArguments: ocpFactoryData
  };

  try {
    console.log('Submitting OcpFactory contract creation transaction...');

    // Create the correct structure for the API call
    const response = await client.submitAndWaitForTransactionTree({
      commands: [{
        CreateCommand: createCommand
      }],
    });

    // Extract the contract ID from the response
    console.log('Transaction submitted successfully. Processing response...');

    // The response structure has events in transactionTree.eventsById
    const eventsById = response.transactionTree?.eventsById;
    if (!eventsById || Object.keys(eventsById).length === 0) {
      throw new Error('No events found in transaction response');
    }

    // Get the first event (should be the created event)
    const eventKeys = Object.keys(eventsById);
    const firstEventKey = eventKeys[0];
    const firstEvent = eventsById[firstEventKey];

    // Check if it's a CreatedTreeEvent
    const createdTreeEvent = firstEvent?.CreatedTreeEvent;
    if (!createdTreeEvent) {
      throw new Error('First event is not a CreatedTreeEvent');
    }

    const contractId = createdTreeEvent.value.contractId;
    if (!contractId) {
      throw new Error('Contract ID not found in CreatedTreeEvent');
    }

    console.log(`✅ OcpFactory contract created with ID: ${contractId}`);

    // Load existing contract IDs
    const outputPath = path.join(__dirname, '..', 'generated', 'ocp-factory-contract-id.json');
    const existingData = loadExistingContractIds(outputPath);

    // Update only the specified network
    const updatedData: ContractIdData = {
      ...existingData,
      [network]: {
        ocpFactoryContractId: contractId,
        templateId: createdTreeEvent.value.templateId,
      }
    };

    // Write the updated contract ID data to the JSON file
    fs.writeFileSync(outputPath, JSON.stringify(updatedData, null, 2));

    console.log(`✅ Contract ID for ${network} saved to: ${outputPath}`);
    console.log(`✅ OcpFactory contract creation for ${network} completed successfully`);

    // Show current state
    console.log('\n📋 Current contract IDs:');
    if (updatedData.mainnet) {
      console.log(`  Mainnet: ${updatedData.mainnet.ocpFactoryContractId}`);
    }
    if (updatedData.devnet) {
      console.log(`  Devnet:  ${updatedData.devnet.ocpFactoryContractId}`);
    }
  } catch (error) {
    console.error('❌ Failed to create OcpFactory contract:', error);
    process.exit(1);
  }
}

main();
