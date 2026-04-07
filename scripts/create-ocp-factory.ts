#!/usr/bin/env node
/**
 * Create the OcpFactory contract on ledger and record IDs in generated/ocp-factory-contract-id.json.
 *
 * Usage: tsx scripts/create-ocp-factory.ts --network <devnet|mainnet>
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProviderType } from '@fairmint/canton-node-sdk';
import { buildTemplateId, requireNetwork } from './packages';
import { createLedgerJsonApiClient } from './utils';

/** True when the participant does not have the DAR vetted (e.g. upload only reached the other provider). */
function isPackageMissingOnParticipant(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('context' in err)) {
    return false;
  }
  const ctx = (err as { context?: { code?: unknown } }).context;
  return ctx?.code === 'PACKAGE_NAMES_NOT_FOUND';
}

interface ContractIdData {
  mainnet?: { ocpFactoryContractId: string; templateId: string };
  devnet?: { ocpFactoryContractId: string; templateId: string };
}

function loadExistingData(filePath: string): ContractIdData {
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
      const mainnet = data.mainnet;
      const devnet = data.devnet;
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
  return typeof o.ocpFactoryContractId === 'string' && typeof o.templateId === 'string';
}

async function main() {
  const network = requireNetwork('create-ocp-factory.ts');

  console.log(`\n🔨 Creating OcpFactory on ${network}\n`);

  // Build template ID dynamically from package config (single source of truth)
  const templateId = buildTemplateId('ocp', 'Fairmint.OpenCapTable.OcpFactory', 'OcpFactory');
  console.log(`  Template: ${templateId}`);

  const providers: ProviderType[] = ['intellect', '5n'];
  let lastError: unknown;

  for (const provider of providers) {
    const client = createLedgerJsonApiClient(network, provider);
    const operatorPartyId = client.getPartyId();
    console.log(`  Provider: ${provider}`);
    console.log(`  Operator: ${operatorPartyId}`);

    try {
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
      return;
    } catch (err) {
      lastError = err;
      if (isPackageMissingOnParticipant(err) && provider === 'intellect') {
        console.warn(`  ⚠️  OpenCapTable-v34 not on Intellect; trying 5n…\n`);
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error('No provider succeeded');
}

const outputPathForJson = (): string => path.join(__dirname, '..', 'generated', 'ocp-factory-contract-id.json');

function finishCreate(
  network: 'devnet' | 'mainnet',
  response: { transactionTree: { eventsById: Record<string, unknown> } },
  outputPath: string
): void {
  const { eventsById } = response.transactionTree;
  if (Object.keys(eventsById).length === 0) {
    throw new Error('No events in response');
  }

  const raw = eventsById[Object.keys(eventsById)[0]];
  if (typeof raw !== 'object' || raw === null || !('CreatedTreeEvent' in raw)) {
    throw new Error('Expected CreatedTreeEvent');
  }
  const firstEvent = raw as {
    CreatedTreeEvent: { value: { contractId: string; templateId: string } };
  };

  const { contractId } = firstEvent.CreatedTreeEvent.value;
  const resultTemplateId = firstEvent.CreatedTreeEvent.value.templateId;

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
