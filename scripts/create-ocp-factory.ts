#!/usr/bin/env node
/**
 * Create the OcpFactory contract on ledger and record IDs in generated/ocp-factory-contract-id.json.
 *
 * Usage: tsx scripts/create-ocp-factory.ts --network <devnet|mainnet>
 */

import { extractEventsFromTransaction } from '@fairmint/canton-node-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { getDarPath, inspectDarPackageId } from './detect-factory-need';
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

export interface ActiveFactory {
  contractId: string;
  templateId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** Find the one active factory for this exact package and operator, if it already exists. */
export function findActiveFactory(
  response: unknown,
  expectedTemplateId: string,
  expectedOperatorPartyId: string
): ActiveFactory | null {
  if (!Array.isArray(response)) {
    return null;
  }

  const matches: ActiveFactory[] = [];
  for (const item of response) {
    if (!isRecord(item)) continue;
    const { contractEntry } = item;
    if (!isRecord(contractEntry)) continue;
    const { JsActiveContract: activeContract } = contractEntry;
    if (!isRecord(activeContract)) continue;
    const { createdEvent } = activeContract;
    if (!isRecord(createdEvent)) continue;
    const { createArgument, contractId, templateId } = createdEvent;
    if (!isRecord(createArgument)) continue;

    if (
      typeof contractId === 'string' &&
      templateId === expectedTemplateId &&
      createArgument.system_operator === expectedOperatorPartyId
    ) {
      matches.push({ contractId, templateId });
    }
  }

  if (matches.length > 1) {
    throw new Error(
      `Found ${matches.length} active OcpFactory contracts for ${expectedTemplateId} and ${expectedOperatorPartyId}; refusing to choose one.`
    );
  }
  return matches[0] ?? null;
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

async function main() {
  const network = requireNetwork('create-ocp-factory.ts');
  const pkg = requirePackageConfig('ocp');

  console.log(`\n🔨 Creating OcpFactory on ${network}\n`);

  const darPath = getDarPath(pkg.name, pkg.version, pkg.darName);
  const packageId = inspectDarPackageId(darPath, pkg.name, pkg.version);
  const templateId = `${packageId}:Fairmint.OpenCapTable.OcpFactory:OcpFactory`;
  const templateQuery = buildTemplateId('ocp', 'Fairmint.OpenCapTable.OcpFactory', 'OcpFactory');
  console.log(`  Template: ${templateId}`);

  const [provider] = OCP_FACTORY_LEDGER_PROVIDERS;
  const client = createLedgerJsonApiClient(network, provider);
  const operatorPartyId = client.getPartyId();
  console.log(`  Provider: ${provider}`);
  console.log(`  Operator: ${operatorPartyId}`);

  const activeFactory = findActiveFactory(
    await client.getActiveContracts({ parties: [operatorPartyId], templateIds: [templateQuery] }),
    templateId,
    operatorPartyId
  );
  if (activeFactory) {
    saveFactory(network, activeFactory, outputPathForJson(), pkg, 'Recovered');
    return;
  }

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
  const { created } = extractEventsFromTransaction(response);
  if (created.length !== 1) {
    throw new Error(`Expected exactly 1 CreatedTreeEvent, got ${created.length}`);
  }

  const { contractId, templateId: resultTemplateId } = created[0];

  saveFactory(network, { contractId, templateId: resultTemplateId }, outputPath, pkg, 'Created');
}

function saveFactory(
  network: 'devnet' | 'mainnet',
  factory: ActiveFactory,
  outputPath: string,
  pkg: { name: string; version: string; sourceDir: string },
  action: 'Created' | 'Recovered'
): void {
  const data = loadExistingData(outputPath);
  data[network] = {
    ocpFactoryContractId: factory.contractId,
    templateId: factory.templateId,
    packageName: pkg.name,
    packageVersion: pkg.version,
    sourceDir: pkg.sourceDir,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));

  console.log(`\n✅ ${action}: ${factory.contractId}`);
  console.log(`   Saved to: ${path.relative(process.cwd(), outputPath)}`);

  if (data.mainnet) console.log(`   Mainnet:  ${data.mainnet.ocpFactoryContractId}`);
  if (data.devnet) console.log(`   Devnet:   ${data.devnet.ocpFactoryContractId}`);
  console.log('');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Failed:', err);
    process.exit(1);
  });
}
