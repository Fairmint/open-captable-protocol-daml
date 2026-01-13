#!/usr/bin/env node
/**
 * Create the ReportsFactory contract. Saves contract ID to generated/reports-factory-contract-id.json.
 *
 * Usage: tsx scripts/create-reports-factory.ts --network <devnet|mainnet>
 */

import * as fs from 'fs';
import * as path from 'path';
import { requireNetwork } from './packages';
import { createLedgerJsonApiClient, createValidatorApiClient } from './utils';

interface ContractIdData {
  mainnet?: { reportsFactoryContractId: string; templateId: string };
  devnet?: { reportsFactoryContractId: string; templateId: string };
}

function loadExistingData(filePath: string): ContractIdData {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    console.warn('⚠️  Could not read existing file, starting fresh');
  }
  return {};
}

async function main() {
  const network = requireNetwork('create-reports-factory.ts');

  console.log(`\n🔨 Creating ReportsFactory on ${network}\n`);

  const { Fairmint } = await import('../lib');
  const client = createLedgerJsonApiClient(network, 'intellect');
  const validatorClient = createValidatorApiClient(network, 'intellect');
  const operatorPartyId = client.getPartyId();
  const { templateId } = Fairmint.OpenCapTableReports.ReportsFactory.ReportsFactory;

  console.log(`  Template: ${templateId}`);
  console.log(`  Operator: ${operatorPartyId}`);

  // Lookup FeaturedAppRight
  console.log('  Looking up FeaturedAppRight...');
  const featuredAppRight = await validatorClient.lookupFeaturedAppRight({ partyId: operatorPartyId });
  if (!featuredAppRight.featured_app_right) {
    throw new Error(`No FeaturedAppRight found for ${operatorPartyId}`);
  }
  const featuredAppRightContractId =
    typeof featuredAppRight.featured_app_right === 'string'
      ? featuredAppRight.featured_app_right
      : (featuredAppRight.featured_app_right.contract_id ?? featuredAppRight.featured_app_right);
  console.log(`  FeaturedAppRight: ${featuredAppRightContractId}`);

  const response = await client.submitAndWaitForTransactionTree({
    commands: [
      {
        CreateCommand: {
          templateId,
          createArguments: {
            system_operator: operatorPartyId,
            featured_app_right: featuredAppRightContractId,
          },
        },
      },
    ],
  });

  const { eventsById } = response.transactionTree;
  if (Object.keys(eventsById).length === 0) {
    throw new Error('No events in response');
  }

  const firstEvent = eventsById[Object.keys(eventsById)[0]];
  if (!('CreatedTreeEvent' in firstEvent)) {
    throw new Error('Expected CreatedTreeEvent');
  }

  const { contractId } = firstEvent.CreatedTreeEvent.value;
  const resultTemplateId = firstEvent.CreatedTreeEvent.value.templateId;

  // Save to file
  const outputPath = path.join(__dirname, '..', 'generated', 'reports-factory-contract-id.json');
  const data = loadExistingData(outputPath);
  data[network] = { reportsFactoryContractId: contractId, templateId: resultTemplateId };
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));

  console.log(`\n✅ Created: ${contractId}`);
  console.log(`   Saved to: ${path.relative(process.cwd(), outputPath)}\n`);
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
