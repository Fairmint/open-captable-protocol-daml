#!/usr/bin/env node
/**
 * Create the OpenCapTable OcpFactory on ledger and record its identity in generated/ocp-factory-contract-id.json.
 *
 * The v35 factory is consumed by each `OcpFactory_AuthorizeIssuer` (it recreates itself with the next cap table
 * number), so a contract ID goes stale after the first authorization. The JSON records the factory's identity instead:
 * its `templateId` and the `system_operator` and `factory_id` it was created with. Consumers find the live contract
 * with an active-contracts query for that template, filtered on both fields; this script does the same to recover a
 * factory that already exists instead of creating a second one.
 *
 * MainNet is out of scope for OpenCapTable-v35 (ADR-040): `--network mainnet` also needs `--allow-mainnet`.
 *
 * Usage: tsx scripts/create-ocp-factory.ts --network devnet [--factory-id <id>]
 */

import { extractEventsFromTransaction } from '@fairmint/canton-node-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { getDarPath, inspectDarPackageId } from './detect-factory-need';
import { buildTemplateId, requireNetwork, requirePackageConfig } from './packages';
import { OCP_FACTORY_LEDGER_PROVIDERS } from './providers';
import type { ContractNetwork } from './types';
import { createLedgerJsonApiClient } from './utils';

export const OCP_FACTORY_MODULE = 'Fairmint.OpenCapTable.OcpFactory';
export const OCP_FACTORY_TEMPLATE = 'OcpFactory';

/** One network's factory identity. `system_operator` and `factory_id` are the contract's own fields. */
export interface FactoryIdentity {
  templateId: string;
  system_operator: string;
  factory_id: string;
  packageName?: string;
  packageVersion?: string;
  sourceDir?: string;
  updatedAt?: string;
}

export type FactoryIdentityFile = Partial<Record<ContractNetwork, FactoryIdentity>>;

export interface ActiveFactory {
  contractId: string;
  templateId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** The factory ID a network gets unless `--factory-id` overrides it: one factory per package major and network. */
export function defaultFactoryId(packageName: string, network: ContractNetwork): string {
  return `${packageName}-${network}`;
}

/** Mirrors the OcpFactory `ensure`: non-empty and no ':' (derived IDs are a cap table ID, a colon and a hash). */
export function assertValidFactoryId(factoryId: string): void {
  if (factoryId.length === 0 || factoryId.includes(':')) {
    throw new Error(`Invalid factory_id ${JSON.stringify(factoryId)}: it must be non-empty and contain no ':'`);
  }
}

/** Create arguments for a new factory; its first cap table is `<factory_id>-1`. */
export function factoryCreateArguments(systemOperator: string, factoryId: string): Record<string, string> {
  assertValidFactoryId(factoryId);
  // Daml Int64 travels as a JSON string in the Ledger JSON API.
  return { system_operator: systemOperator, factory_id: factoryId, next_cap_table_number: '1' };
}

/**
 * Find the one active factory for this exact template, operator and factory ID, if it exists. Two live factories with
 * one `factory_id` would issue the same cap table IDs, so more than one match is an error.
 */
export function findActiveFactory(
  response: unknown,
  expectedTemplateId: string,
  expectedOperatorPartyId: string,
  expectedFactoryId: string
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
      createArgument.system_operator === expectedOperatorPartyId &&
      createArgument.factory_id === expectedFactoryId
    ) {
      matches.push({ contractId, templateId });
    }
  }

  if (matches.length > 1) {
    throw new Error(
      `Found ${matches.length} active OcpFactory contracts for ${expectedTemplateId}, ${expectedOperatorPartyId} and factory_id ${expectedFactoryId}; refusing to choose one.`
    );
  }
  return matches[0] ?? null;
}

/** Whether a recorded entry has the v35 identity shape (an old v34 entry, which records a contract ID, does not). */
export function isFactoryIdentity(value: unknown): value is FactoryIdentity {
  if (!isRecord(value)) {
    return false;
  }
  return nonEmptyString(value.templateId) && nonEmptyString(value.system_operator) && nonEmptyString(value.factory_id);
}

/** Records `identity` for `network`, keeping other networks' entries only if they are v35 identities. */
export function withFactoryIdentity(
  existing: unknown,
  network: ContractNetwork,
  identity: FactoryIdentity
): FactoryIdentityFile {
  const data: FactoryIdentityFile = {};
  if (isRecord(existing)) {
    for (const key of ['devnet', 'mainnet'] as const) {
      const entry = existing[key];
      if (key !== network && isFactoryIdentity(entry)) {
        data[key] = entry;
      }
    }
  }
  data[network] = identity;
  return data;
}

function loadExistingData(filePath: string): unknown {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    }
  } catch {
    console.warn('⚠️  Could not read existing file, starting fresh');
  }
  return {};
}

function parseFactoryIdArg(args: string[] = process.argv.slice(2)): string | undefined {
  const idx = args.indexOf('--factory-id');
  return idx === -1 ? undefined : args[idx + 1];
}

async function main() {
  const network = requireNetwork('create-ocp-factory.ts');
  if (network === 'mainnet' && !process.argv.includes('--allow-mainnet')) {
    throw new Error(
      'OpenCapTable-v35 targets DevNet only (ADR-040: MainNet is out of scope). Pass --allow-mainnet once a MainNet rollout is decided.'
    );
  }
  const pkg = requirePackageConfig('ocp');
  const factoryId = parseFactoryIdArg() ?? defaultFactoryId(pkg.name, network);
  assertValidFactoryId(factoryId);

  console.log(`\n🔨 Creating OcpFactory on ${network}\n`);

  const darPath = getDarPath(pkg.name, pkg.version, pkg.darName, pkg.buildDir);
  const packageId = inspectDarPackageId(darPath, pkg.name, pkg.version);
  const templateId = `${packageId}:${OCP_FACTORY_MODULE}:${OCP_FACTORY_TEMPLATE}`;
  const templateQuery = buildTemplateId('ocp', OCP_FACTORY_MODULE, OCP_FACTORY_TEMPLATE);
  console.log(`  Template:   ${templateId}`);
  console.log(`  Factory ID: ${factoryId}`);

  const [provider] = OCP_FACTORY_LEDGER_PROVIDERS;
  const client = createLedgerJsonApiClient(network, provider);
  const operatorPartyId = client.getPartyId();
  console.log(`  Provider:   ${provider}`);
  console.log(`  Operator:   ${operatorPartyId}`);

  const identity: FactoryIdentity = {
    templateId,
    system_operator: operatorPartyId,
    factory_id: factoryId,
    packageName: pkg.name,
    packageVersion: pkg.version,
    sourceDir: pkg.sourceDir,
    updatedAt: new Date().toISOString(),
  };

  const activeFactory = findActiveFactory(
    await client.getActiveContracts({ parties: [operatorPartyId], templateIds: [templateQuery] }),
    templateId,
    operatorPartyId,
    factoryId
  );
  if (activeFactory) {
    saveFactory(network, identity, activeFactory.contractId, 'Recovered');
    return;
  }

  const response = await client.submitAndWaitForTransaction({
    commands: [
      {
        CreateCommand: {
          templateId,
          createArguments: factoryCreateArguments(operatorPartyId, factoryId),
        },
      },
    ],
  });

  const { created } = extractEventsFromTransaction(response);
  if (created.length !== 1) {
    throw new Error(`Expected exactly 1 CreatedEvent, got ${created.length}`);
  }
  saveFactory(network, { ...identity, templateId: created[0].templateId }, created[0].contractId, 'Created');
}

const outputPathForJson = (): string => path.join(__dirname, '..', 'generated', 'ocp-factory-contract-id.json');

function saveFactory(
  network: ContractNetwork,
  identity: FactoryIdentity,
  contractId: string,
  action: 'Created' | 'Recovered'
): void {
  const outputPath = outputPathForJson();
  const data = withFactoryIdentity(loadExistingData(outputPath), network, identity);
  fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);

  console.log(
    `\n✅ ${action}: ${identity.factory_id} (current contract ${contractId}; it changes with each authorization)`
  );
  console.log(`   Saved to: ${path.relative(process.cwd(), outputPath)}`);
  for (const key of ['devnet', 'mainnet'] as const) {
    const entry = data[key];
    if (entry) console.log(`   ${key.padEnd(8)} ${entry.factory_id} by ${entry.system_operator}`);
  }
  console.log('');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Failed:', err);
    process.exit(1);
  });
}
