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
  mainnet?: ContractIdEntry;
  devnet?: ContractIdEntry;
}

interface ContractIdEntry {
  ocpFactoryContractId: string;
  templateId: string;
  packageName?: string;
  packageVersion?: string;
  sourceDir?: string;
  updatedAt?: string;
}

interface CreatedTreeEventValue {
  contractId: string;
  templateId: string;
}

interface CreatedTreeEventWrapper {
  CreatedTreeEvent: {
    value: CreatedTreeEventValue;
  };
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

function isNetworkEntry(value: unknown): value is ContractIdEntry {
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

function isCreatedTreeEventWrapper(value: unknown): value is CreatedTreeEventWrapper {
  if (value === null || typeof value !== 'object' || !('CreatedTreeEvent' in value)) {
    return false;
  }

  const wrapper = value as { CreatedTreeEvent?: unknown };
  if (wrapper.CreatedTreeEvent === null || typeof wrapper.CreatedTreeEvent !== 'object') {
    return false;
  }

  const event = wrapper.CreatedTreeEvent as { value?: unknown };
  if (event.value === null || typeof event.value !== 'object') {
    return false;
  }

  const created = event.value as Record<string, unknown>;
  return typeof created.contractId === 'string' && typeof created.templateId === 'string';
}

function getCreatedEvents(response: {
  transactionTree: { eventsById: Record<string, unknown> };
}): CreatedTreeEventValue[] {
  return Object.values(response.transactionTree.eventsById)
    .filter(isCreatedTreeEventWrapper)
    .map((event) => event.CreatedTreeEvent.value);
}

async function main() {
  const network = requireNetwork('create-ocp-factory.ts');
  const pkg = requirePackageConfig('ocp');

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

  finishCreate(network, response, outputPathForJson(), pkg);
}

const outputPathForJson = (): string => path.join(__dirname, '..', 'generated', 'ocp-factory-contract-id.json');

function finishCreate(
  network: 'devnet' | 'mainnet',
  response: { transactionTree: { eventsById: Record<string, unknown> } },
  outputPath: string,
  pkg: { name: string; version: string; sourceDir: string }
): void {
  const created = getCreatedEvents(response);
  if (created.length !== 1) {
    throw new Error(`Expected exactly 1 CreatedTreeEvent, got ${created.length}`);
  }

  const { contractId, templateId: resultTemplateId } = created[0];

  const data = loadExistingData(outputPath);
  data[network] = {
    ocpFactoryContractId: contractId,
    templateId: resultTemplateId,
    packageName: pkg.name,
    packageVersion: pkg.version,
    sourceDir: pkg.sourceDir,
    updatedAt: new Date().toISOString(),
  };
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
