#!/usr/bin/env node
/**
 * Create the OcpFactory contract on ledger and record IDs in generated/ocp-factory-contract-id.json.
 *
 * Usage: tsx scripts/create-ocp-factory.ts --network <devnet|mainnet>
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildTemplateId, requireNetwork, requirePackageConfig } from './packages';
import { OCP_FACTORY_LEDGER_PROVIDERS } from './providers';
import { createLedgerJsonApiClient } from './utils';

interface ContractIdData {
  mainnet?: { ocpFactoryContractId: string; templateId: string };
  devnet?: { ocpFactoryContractId: string; templateId: string };
}

function loadExistingData(filePath: string): ContractIdData {
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
      const { mainnet, devnet } = data;
      return {
        ...(isNetworkEntry(mainnet) ? { mainnet } : {}),
        ...(isNetworkEntry(devnet) ? { devnet } : {}),
      };
    }
  } catch {
    console.warn('⚠️  Could not read existing file, starting fresh');
  }
  return {};
}

function isNetworkEntry(value: unknown): value is { ocpFactoryContractId: string; templateId: string } {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const o = value as Record<string, unknown>;
  const cid = o.ocpFactoryContractId;
  const tid = o.templateId;
  if (typeof cid !== 'string' || typeof tid !== 'string') {
    return false;
  }
  return cid.trim().length > 0 && tid.trim().length > 0;
}

interface CreatedTreeEventNode {
  CreatedTreeEvent: { value: { contractId: string; templateId: string } };
}

function isCreatedTreeEventNode(event: unknown): event is CreatedTreeEventNode {
  if (event === null || typeof event !== 'object' || !('CreatedTreeEvent' in event)) {
    return false;
  }
  const wrapped = (event as { CreatedTreeEvent: unknown }).CreatedTreeEvent;
  if (wrapped === null || typeof wrapped !== 'object' || !('value' in wrapped)) {
    return false;
  }
  const val = (wrapped as { value: unknown }).value;
  if (val === null || typeof val !== 'object') {
    return false;
  }
  const v = val as Record<string, unknown>;
  return typeof v.contractId === 'string' && typeof v.templateId === 'string';
}

async function main() {
  const network = requireNetwork('create-ocp-factory.ts');
  requirePackageConfig('ocp');

  console.log(`\n🔨 Creating OcpFactory on ${network}\n`);

  // Build template ID dynamically from package config (single source of truth)
  const templateId = buildTemplateId('ocp', 'Fairmint.OpenCapTable.OcpFactory', 'OcpFactory');
  console.log(`  Template: ${templateId}`);

  const [provider] = OCP_FACTORY_LEDGER_PROVIDERS;
  const client = createLedgerJsonApiClient(network, provider);
  const operatorPartyId = client.getPartyId();
  console.log(`  Provider: ${provider}`);
  console.log(`  Operator: ${operatorPartyId}`);

  const response = await client.submitAndWaitForTransactionTree({
    commands: [
      {
        CreateCommand: {
          templateId,
          createArguments: { system_operator: operatorPartyId },
        },
      },
    ],
  });

  finishCreate(network, response, outputPathForJson());
}

const outputPathForJson = (): string => path.join(__dirname, '..', 'generated', 'ocp-factory-contract-id.json');

function finishCreate(
  network: 'devnet' | 'mainnet',
  response: { transactionTree: { eventsById: Record<string, unknown> } },
  outputPath: string
): void {
  const { eventsById } = response.transactionTree;
  const created = Object.values(eventsById).filter(isCreatedTreeEventNode);
  if (created.length !== 1) {
    throw new Error(`Expected exactly 1 CreatedTreeEvent, got ${created.length}`);
  }

  const { contractId, templateId: resultTemplateId } = created[0].CreatedTreeEvent.value;

  const data = loadExistingData(outputPath);
  data[network] = { ocpFactoryContractId: contractId, templateId: resultTemplateId };
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));

  console.log(`\n✅ Created: ${contractId}`);
  console.log(`   Saved to: ${path.relative(process.cwd(), outputPath)}`);

  if (data.mainnet) console.log(`   Mainnet:  ${data.mainnet.ocpFactoryContractId}`);
  if (data.devnet) console.log(`   Devnet:   ${data.devnet.ocpFactoryContractId}`);
  console.log('');
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
