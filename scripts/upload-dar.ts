#!/usr/bin/env node
/**
 * Upload a DAR file to devnet or mainnet.
 *
 * Requires the DAR to be backed up first. If not backed up, the script will automatically run the backup process before
 * uploading.
 *
 * **Backed-up DARs:** Upload uses the version recorded under `dars/` + `dars.lock`. Older versions remain in `dars/` on
 * purpose—see https://github.com/Fairmint/open-captable-protocol-daml/wiki
 *
 * Usage: tsx scripts/upload-dar.ts --package <package> --network <network> [--no-vet]
 *
 * **`--no-vet`:** pass `vetAllPackages=false` to `POST /v2/packages` so the DAR is stored without immediately vetting
 * packages. That **skips** the upgrade-compatibility step that rejects `NOT_VALID_UPGRADE_PACKAGE` for incompatible
 * lineages. Then run: `npx tsx scripts/vet-package-allow-incompatible-upgrade.ts --network … --provider … --package-id
 * <main-dalf-id>` (with Canton's **ALLOW_VET_INCOMPATIBLE_UPGRADES** force flag) to vet the new package id.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import { getFreshDarPath, isDarBackedUp, recordNetworkUpload, requireBackedUpDar } from './dar-utils';
import { parseNetworkArg, parsePackageArg, printPackageUsage, requireNetwork, requirePackage } from './packages';
import { LEDGER_SCRIPT_PROVIDERS } from './providers';
import { createLedgerJsonApiClient } from './utils';

/** Ensure the DAR is backed up before upload. If not backed up, automatically run the backup process. */
function ensureDarBackedUp(packageName: string, version: string, darName: string): void {
  if (isDarBackedUp(packageName, version, darName)) {
    return;
  }

  // Check if fresh DAR exists to backup
  const freshPath = getFreshDarPath(packageName, version, darName);
  if (!freshPath) {
    console.error(`❌ No DAR found to backup`);
    console.error(`   Expected: ${packageName}/.daml/dist/${darName}-${version}.dar`);
    console.error(`   Run "npm run build" first to build the DAR.`);
    process.exit(1);
  }

  console.log(`📋 DAR not backed up yet, backing up first...\n`);

  try {
    execSync(`npm run backup-dar -- --package ${packageName} --version ${version}`, {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    console.log('');
  } catch {
    console.error(`\n❌ Failed to backup DAR`);
    process.exit(1);
  }
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

  // Ensure DAR is backed up first (auto-backup if needed)
  ensureDarBackedUp(pkg.name, pkg.version, pkg.darName);

  // Now require the backed-up DAR (this verifies integrity)
  const darPath = requireBackedUpDar(pkg.name, pkg.version, pkg.darName);

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
        // Published @fairmint/canton-node-sdk may not yet parse `vetAllPackages` on uploadDarFile (Zod strips unknown
        // keys). POST the octet-stream body ourselves with the query flag Canton documents for JSON API uploads.
        const url = `${client.getApiUrl()}/v2/packages?vetAllPackages=false`;
        await client.makePostRequest(url, fs.readFileSync(darPath), {
          contentType: 'application/octet-stream',
          includeBearerToken: true,
        });
      } else {
        await client.uploadDarFile({ filePath: darPath });
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
    console.warn(`   Not updating dars.lock — upload must succeed on all providers first.\n`);
    process.exit(1);
  }

  recordNetworkUpload(pkg.name, pkg.version, pkg.darName, network);
  console.log(`\n🎉 Upload complete\n`);
}

void main();
