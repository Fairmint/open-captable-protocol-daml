#!/usr/bin/env node
/**
 * Create the OcpFactory contract on ledger and record IDs in generated/ocp-factory-contract-id.json.
 *
 * Usage: tsx scripts/create-ocp-factory.ts --network <devnet|mainnet>
 *
 * ## Upgrading OpenCapTable (e.g. to v34) end-to-end
 *
 * 1. Build DAR: `npm run build` (from repo root).
 * 2. Upload DAR to **both** Intellect and 5N for each network:
 *    `npm run upload-dar -- --package ocp --network devnet`
 *    `npm run upload-dar -- --package ocp --network mainnet`
 * 3. Regenerate JS + typings: `npm run codegen`
 * 4. Create factories (Intellect first; falls back to 5n if the package is missing on Intellect, e.g. partial devnet
 *    upload):
 *    `tsx scripts/create-ocp-factory.ts --network devnet`
 *    `tsx scripts/create-ocp-factory.ts --network mainnet`
 * 5. Bump `package.json` version and publish `@fairmint/open-captable-protocol-daml-js`.
 *
 * Or run `npm run create-factory:ocp` after steps 1–2 (it runs codegen then both networks).
 *
 * Contract IDs and `templateId` in the JSON come from the ledger response; they must match the uploaded DAR.
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

  const firstEvent = eventsById[Object.keys(eventsById)[0]];
  if (!('CreatedTreeEvent' in firstEvent)) {
    throw new Error('Expected CreatedTreeEvent');
  }

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
