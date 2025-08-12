#!/usr/bin/env node

import { LedgerJsonApiClient } from '@fairmint/canton-node-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { Fairmint } from '../generated/js/OpenCapTable-v02-0.0.2/lib';

async function main() {
  console.log('Creating OcpFactory contract...');
  
  // Validate that the generated types are available
  if (!Fairmint?.OpenCapTable?.OcpFactory?.OcpFactory) {
    throw new Error('Generated DAML types not found. Please run "npm run codegen" first.');
  }
  
  const client = new LedgerJsonApiClient();
    
  console.log(`Template ID: ${Fairmint.OpenCapTable.OcpFactory.OcpFactory.templateId}`);
  
  // Use the generated OcpFactory type for type safety
  const ocpFactoryData: Fairmint.OpenCapTable.OcpFactory.OcpFactory = {
    system_operator: client.getPartyId()
  };
  
  const createCommand = {
    templateId: Fairmint.OpenCapTable.OcpFactory.OcpFactory.templateId,
    createArguments: ocpFactoryData
  };

  try {
    console.log('Submitting contract creation transaction...');
    
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

    // Create the contract ID data
    const contractIdData = {
      ocpFactoryContractId: contractId,
      templateId: Fairmint.OpenCapTable.OcpFactory.OcpFactory.templateId,
    };

    // Write the contract ID to a JSON file
    const outputPath = path.join(__dirname, '..', 'generated', 'ocp-factory-contract-id.json');
    fs.writeFileSync(outputPath, JSON.stringify(contractIdData, null, 2));

    console.log(`✅ Contract ID saved to: ${outputPath}`);
    console.log('✅ OcpFactory contract creation completed successfully');
  } catch (error) {
    console.error('❌ Failed to create OcpFactory contract:', error);
    process.exit(1);
  }
}

main(); 