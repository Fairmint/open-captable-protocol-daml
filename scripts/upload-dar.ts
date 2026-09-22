#!/usr/bin/env node
/**
 * Upload a DAR file to devnet or mainnet.
 *
 * Requires a fresh build whose bytes exactly match the committed backup.
 *
 * **Backed-up DARs:** Upload uses the version recorded under `dars/` + `dars.lock`. Older versions remain in `dars/` on
 * purpose—see https://github.com/Fairmint/open-captable-protocol-daml/wiki/DAR-Backup
 *
 * Usage: tsx scripts/upload-dar.ts --package <package> --network <network> [--no-vet]
 *
 * **`--no-vet`:** pass `vetAllPackages=false` to `POST /v2/packages` so the DAR is stored without immediately vetting
 * packages. That **skips** the upgrade-compatibility step that rejects `NOT_VALID_UPGRADE_PACKAGE` for incompatible
 * lineages. Then run: `npx tsx scripts/vet-package-allow-incompatible-upgrade.ts --network … --provider … --package-id
 * <main-dalf-id>` (with Canton's **ALLOW_VET_INCOMPATIBLE_UPGRADES** force flag) to vet the new package id.
 */

import { computeSha256, getFreshDarPath, requireBackedUpDar } from '@fairmint/canton-dev-tools/daml';
import * as fs from 'fs';
import * as path from 'path';
import {
  type PackageConfig,
  parseNetworkArg,
  parsePackageArg,
  printPackageUsage,
  requireNetwork,
  requirePackage,
} from './packages';
import { LEDGER_SCRIPT_PROVIDERS } from './providers';
import { createLedgerJsonApiClient } from './utils';

const ROOT_DIR = path.join(__dirname, '..');

/** Require the fresh build to be byte-for-byte identical to the committed backup. */
function requireMatchingBuild(pkg: PackageConfig): string {
  const freshPath = getFreshDarPath(ROOT_DIR, pkg.buildDir, pkg.version, pkg.darName);
  if (!freshPath) {
    console.error(`❌ Fresh DAR build not found`);
    console.error(`   Expected: ${pkg.buildDir}/.daml/dist/${pkg.darName}-${pkg.version}.dar`);
    console.error(`   Run "npm run build" first to build the DAR.`);
    process.exit(1);
  }

  let backedUpPath: string;
  try {
    backedUpPath = requireBackedUpDar(ROOT_DIR, pkg.name, pkg.version, pkg.darName);
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const freshHash = computeSha256(freshPath);
  const backedUpHash = computeSha256(backedUpPath);
  if (freshHash !== backedUpHash || fs.statSync(freshPath).size !== fs.statSync(backedUpPath).size) {
    console.error(`❌ Fresh build does not match the committed backup.`);
    console.error(`   Fresh:  ${freshHash}`);
    console.error(`   Backup: ${backedUpHash}`);
    console.error(`   Run: npm run backup-dar -- --package ${pkg.sourceDir} --version ${pkg.version}`);
    process.exit(1);
  }

  return backedUpPath;
}

async function main() {
  // Validate args (show help if missing)
  if (!parsePackageArg() || !parseNetworkArg()) {
    printPackageUsage('upload-dar.ts');
    process.exit(1);
  }

  const pkg = requirePackage('upload-dar.ts');
  const network = requireNetwork('upload-dar.ts');

  console.log(`\n📦 Uploading ${pkg.name} v${pkg.version} to ${network}\n`);

  const darPath = requireMatchingBuild(pkg);

  // Upload to each provider independently so one unhealthy participant (e.g. devnet Intellect with no synchronizer)
  // does not block the other.
  const failures: Array<{ provider: string; message: string }> = [];
  const noVet = process.argv.includes('--no-vet');
  if (noVet) {
    console.log(
      '  ℹ️  --no-vet: uploading without auto-vet (avoids upgrade check at upload). Vet manually with scripts/vet-package-allow-incompatible-upgrade.ts if needed.\n'
    );
  }

  for (const provider of LEDGER_SCRIPT_PROVIDERS) {
    console.log(`  → ${provider}...`);
    try {
      const client = createLedgerJsonApiClient(network, provider);
      if (noVet) {
        // Published @fairmint/canton-node-sdk may not yet parse `vetAllPackages` on uploadDar (Zod strips unknown
        // keys). POST the octet-stream body ourselves with the query flag Canton documents for JSON API uploads.
        const url = `${client.getApiUrl()}/v2/packages?vetAllPackages=false`;
        await client.makePostRequest(url, fs.readFileSync(darPath), {
          contentType: 'application/octet-stream',
          includeBearerToken: true,
        });
      } else {
        await client.uploadDar({ darFile: fs.readFileSync(darPath) });
      }
      console.log(`    ✅ Done`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`    ⚠️  Failed: ${message}`);
      failures.push({ provider, message });
    }
  }

  if (failures.length === LEDGER_SCRIPT_PROVIDERS.length) {
    console.error(`\n❌ Upload failed on all providers:\n`);
    for (const { provider, message } of failures) {
      console.error(`   ${provider}: ${message}\n`);
    }
    if (failures.some((f) => f.message.includes('NOT_VALID_UPGRADE_PACKAGE')) && !noVet) {
      console.error(
        'Tip: incompatible package lineage vetting at upload — retry with --no-vet, then vet the new main package id (see script header).\n'
      );
    }
    process.exit(1);
  }

  if (failures.length > 0) {
    console.warn(`\n⚠️  Partial upload: ${failures.length} provider(s) failed; succeeded on others.`);
    process.exit(1);
  }

  console.log(`\n🎉 Upload complete\n`);
}

void main();
