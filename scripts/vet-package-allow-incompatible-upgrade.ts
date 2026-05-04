#!/usr/bin/env node
/**
 * Vet a package id on a participant using Canton's **force** flag that skips upgrade-compatibility checks between
 * vetted package lineages (`UPDATE_VETTED_PACKAGES_FORCE_FLAG_ALLOW_VET_INCOMPATIBLE_UPGRADES`).
 *
 * Use after `npm run upload-dar -- ... --no-vet` when the DAR is valid LF but not a valid upgrade of an already-vetted
 * package (e.g. CantonPayments built against splice-amulet 0.1.16 while `aca762f1…` was built against 0.1.17).
 *
 * **Warning:** This is an operator-level escape hatch. Only use when you understand the topology consequences
 * (simultaneously vetted, upgrade-incompatible package lineages).
 *
 * Usage: npx tsx scripts/vet-package-allow-incompatible-upgrade.ts\
 * --network mainnet --provider intellect\
 * --package-id 6b6a969fa6a621479a29fcf7fb2d9596317545eabc088ed4c62c43c0c0ac2173
 *
 * Dry run (validate request without applying): ... --dry-run
 *
 * Override synchronizer (default: global-domain for mainnet Catalyst / TA): ... --synchronizer-id
 * 'global-domain::1220...'
 */

import type { ProviderType } from '@fairmint/canton-node-sdk';
import { createLedgerJsonApiClient } from './utils';

const DEFAULT_MAINNET_SYNCHRONIZER_ID =
  'global-domain::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc';

function parseArgs(): {
  network: 'mainnet' | 'devnet';
  provider: ProviderType;
  packageId: string;
  dryRun: boolean;
  synchronizerId: string;
} {
  const argv = process.argv.slice(2);
  let network: 'mainnet' | 'devnet' = 'mainnet';
  let provider: ProviderType = 'intellect';
  let packageId: string | undefined;
  let dryRun = false;
  let synchronizerId = DEFAULT_MAINNET_SYNCHRONIZER_ID;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--network' && argv[i + 1]) {
      const v = argv[++i];
      if (v === 'mainnet' || v === 'devnet') network = v;
    } else if (argv[i] === '--provider' && argv[i + 1]) {
      const v = argv[++i];
      if (v === 'intellect' || v === '5n') provider = v;
    } else if (argv[i] === '--package-id' && argv[i + 1]) {
      packageId = argv[++i].toLowerCase();
    } else if (argv[i] === '--synchronizer-id' && argv[i + 1]) {
      synchronizerId = argv[++i];
    } else if (argv[i] === '--dry-run') {
      dryRun = true;
    }
  }

  if (!packageId || !/^[0-9a-f]{64}$/.test(packageId)) {
    console.error('Missing or invalid --package-id (64 hex chars, no prefix).');
    process.exit(1);
  }

  return { network, provider, packageId, dryRun, synchronizerId };
}

/** JSON body for POST /v2/package-vetting (matches Ledger JSON OpenAPI / ScalaPB relaxed codecs). */
function buildUpdateVettedPackagesBody(
  packageId: string,
  dryRun: boolean,
  synchronizerId: string
): Record<string, unknown> {
  return {
    changes: [
      {
        operation: {
          Vet: {
            value: {
              packages: [
                {
                  packageId,
                  packageName: '',
                  packageVersion: '',
                },
              ],
            },
          },
        },
      },
    ],
    dryRun,
    synchronizerId,
    updateVettedPackagesForceFlags: ['UPDATE_VETTED_PACKAGES_FORCE_FLAG_ALLOW_VET_INCOMPATIBLE_UPGRADES'],
  };
}

async function main(): Promise<void> {
  const { network, provider, packageId, dryRun, synchronizerId } = parseArgs();
  const client = createLedgerJsonApiClient(network, provider);
  const url = `${client.getApiUrl()}/v2/package-vetting`;
  const body = buildUpdateVettedPackagesBody(packageId, dryRun, synchronizerId);

  console.log(`\nPOST ${url}`);
  console.log(`provider=${provider} dryRun=${dryRun}`);
  console.log(`body:\n${JSON.stringify(body, null, 2)}\n`);

  const res = await client.makePostRequest<unknown>(url, body, { includeBearerToken: true });
  console.log('Response:', JSON.stringify(res, null, 2));
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
