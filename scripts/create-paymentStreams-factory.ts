#!/usr/bin/env node
/**
 * Create the PaymentStreamFactory contract.
 * Saves contract ID and disclosed contract to generated/paymentStreams-factory-contract-id.json.
 *
 * Usage: tsx scripts/create-paymentStreams-factory.ts --network <devnet|mainnet>
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLedgerJsonApiClient, createValidatorApiClient } from './utils';
import type { DisclosedContract } from '@fairmint/canton-node-sdk/build/src/clients/ledger-json-api/schemas/api/commands';
import { requireNetwork } from './packages';

interface ContractIdData {
  mainnet?: { paymentStreamsFactoryContractId: string; templateId: string; disclosedContract: DisclosedContract };
  devnet?: { paymentStreamsFactoryContractId: string; templateId: string; disclosedContract: DisclosedContract };
}

// Processor party IDs per network
const PROCESSOR_PARTY_IDS = {
  devnet: 'test-subscription-processor::1220ea70ea2cbfe6be431f34c7323e249c624a02fb2209d2b73fabd7eea1fe84df34',
  mainnet: 'SubscriptionProcessor::12204a039322c01e9f714b56259c3e68b69058bf5dfe1debbe956c698f905ceba9d7',
} as const;

function loadExistingData(filePath: string): ContractIdData {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    console.warn('⚠️  Could not read existing file, starting fresh');
  }
  return {};
}

async function main() {
  const network = requireNetwork('create-paymentStreams-factory.ts');

  console.log(`\n🔨 Creating PaymentStreamFactory on ${network}\n`);

  const { CantonPayments } = await import('../lib');

  if (!CantonPayments?.PaymentStream?.PaymentStreamFactory?.PaymentStreamFactory) {
    throw new Error('Generated types not found. Run "npm run codegen" first.');
  }

  const client = createLedgerJsonApiClient(network, '5n');
  const validatorClient = createValidatorApiClient(network, '5n');
  const templateId = CantonPayments.PaymentStream.PaymentStreamFactory.PaymentStreamFactory.templateId;
  const processorPartyId = PROCESSOR_PARTY_IDS[network];

  console.log(`  Template: ${templateId}`);
  console.log(`  Processor: ${processorPartyId}`);

  // Get DSO party
  console.log('  Looking up DSO party...');
  const dsoResponse = await validatorClient.getDsoPartyId();
  if (!dsoResponse?.dso_party_id) {
    throw new Error('Could not determine DSO party ID');
  }
  console.log(`  DSO: ${dsoResponse.dso_party_id}`);

  const response = await client.submitAndWaitForTransactionTree({
    commands: [{
      CreateCommand: {
        templateId,
        createArguments: {
          processorContext: {
            processor: processorPartyId,
            dso: dsoResponse.dso_party_id,
          },
        },
      },
    }],
    actAs: [processorPartyId],
  });

  const eventsById = response.transactionTree?.eventsById;
  if (!eventsById || Object.keys(eventsById).length === 0) {
    throw new Error('No events in response');
  }

  const firstEvent = eventsById[Object.keys(eventsById)[0]];
  if (!firstEvent || !('CreatedTreeEvent' in firstEvent)) {
    throw new Error('Expected CreatedTreeEvent');
  }

  const contractId = firstEvent.CreatedTreeEvent.value.contractId;
  const resultTemplateId = firstEvent.CreatedTreeEvent.value.templateId;

  // Fetch disclosed contract data
  console.log('  Fetching disclosed contract...');
  const factoryEventsResponse = await client.getEventsByContractId({
    contractId,
    readAs: [processorPartyId],
  });

  const createdEvent = factoryEventsResponse.created?.createdEvent;
  if (!createdEvent) {
    throw new Error('Could not fetch disclosed contract data');
  }

  const disclosedContract: DisclosedContract = {
    templateId: createdEvent.templateId,
    contractId: createdEvent.contractId,
    createdEventBlob: createdEvent.createdEventBlob,
    synchronizerId: factoryEventsResponse.created!.synchronizerId,
  };

  // Save to file
  const outputPath = path.join(__dirname, '..', 'generated', 'paymentStreams-factory-contract-id.json');
  const data = loadExistingData(outputPath);
  data[network] = { paymentStreamsFactoryContractId: contractId, templateId: resultTemplateId, disclosedContract };
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));

  console.log(`\n✅ Created: ${contractId}`);
  console.log(`   Saved to: ${path.relative(process.cwd(), outputPath)}\n`);
}

main().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
