#!/usr/bin/env node
/**
 * Upload a DAR file to devnet or mainnet.
 *
 * Requires a fresh build that exactly matches the committed candidate backup.
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

import * as fs from 'fs';
import { computeSha256, getFreshDarPath, requireBackedUpDar } from './dar-utils';
import { parseNetworkArg, parsePackageArg, printPackageUsage, requireNetwork, requirePackage } from './packages';
import { LEDGER_SCRIPT_PROVIDERS } from './providers';
import { createLedgerJsonApiClient } from './utils';

async function main() {
  // Validate args (show help if missing)
  if (!parsePackageArg() || !parseNetworkArg()) {
    printPackageUsage('upload-dar.ts');
    process.exit(1);
  }

  const pkg = requirePackage('upload-dar.ts');
  const network = requireNetwork('upload-dar.ts');

  console.log(`\n📦 Uploading ${pkg.name} v${pkg.version} to ${network}\n`);

  // Upload only the committed backup, after proving the fresh build is byte-identical.
  const darPath = requireBackedUpDar(pkg.name, pkg.version, pkg.darName);
  const freshPath = getFreshDarPath(pkg.sourceDir, pkg.version, pkg.darName);
  if (!freshPath) {
    console.error(`❌ Fresh DAR not found. Run "npm run build" first.`);
    process.exit(1);
  }
  const backupHash = computeSha256(darPath);
  const freshHash = computeSha256(freshPath);
  if (freshHash !== backupHash) {
    console.error(`❌ Fresh build does not match committed backup.`);
    console.error(`   Backup: ${backupHash}`);
    console.error(`   Build:  ${freshHash}`);
    process.exit(1);
  }

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

  console.log(`\n🎉 Upload complete\n`);
}

void main();
