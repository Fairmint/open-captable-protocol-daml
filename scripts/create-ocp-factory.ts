#!/usr/bin/env node
/**
 * Create the OcpFactory contract.
 * Saves contract ID to generated/ocp-factory-contract-id.json.
 *
 * Usage: tsx scripts/create-ocp-factory.ts --network <devnet|mainnet>
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLedgerJsonApiClient } from './utils';
import { requireNetwork, buildTemplateId } from './packages';

interface ContractIdData {
  mainnet?: { ocpFactoryContractId: string; templateId: string };
  devnet?: { ocpFactoryContractId: string; templateId: string };
}

function loadExistingData(filePath: string): ContractIdData {
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      // Handle legacy format
      if (data.ocpFactoryContractId && !data.mainnet && !data.devnet) {
        return { mainnet: { ocpFactoryContractId: data.ocpFactoryContractId, templateId: data.templateId } };
      }
      return data;
    }
  } catch {
    console.warn('⚠️  Could not read existing file, starting fresh');
  }
  return {};
}

async function main() {
  const network = requireNetwork('create-ocp-factory.ts');

  console.log(`\n🔨 Creating OcpFactory on ${network}\n`);

  const client = createLedgerJsonApiClient(network, 'intellect');
  const operatorPartyId = client.getPartyId();

  // Build template ID dynamically from package config (single source of truth)
  const templateId = buildTemplateId('ocp', 'Fairmint.OpenCapTable.OcpFactory', 'OcpFactory');

  console.log(`  Template: ${templateId}`);
  console.log(`  Operator: ${operatorPartyId}`);

  // Create arguments matching current OcpFactory DAML (only system_operator required)
  const response = await client.submitAndWaitForTransactionTree({
    commands: [{
      CreateCommand: {
        templateId,
        createArguments: { system_operator: operatorPartyId },
      },
    }],
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

  // Save to file
  const outputPath = path.join(__dirname, '..', 'generated', 'ocp-factory-contract-id.json');
  const data = loadExistingData(outputPath);
  data[network] = { ocpFactoryContractId: contractId, templateId: resultTemplateId };
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));

  console.log(`\n✅ Created: ${contractId}`);
  console.log(`   Saved to: ${path.relative(process.cwd(), outputPath)}`);

  if (data.mainnet) console.log(`   Mainnet: ${data.mainnet.ocpFactoryContractId}`);
  if (data.devnet) console.log(`   Devnet:  ${data.devnet.ocpFactoryContractId}`);
  console.log('');
}

main().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
