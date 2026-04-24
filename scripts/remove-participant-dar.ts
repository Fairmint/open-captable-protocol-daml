#!/usr/bin/env node
/**
 * Remove uploaded DARs from a Canton **participant admin** gRPC endpoint using
 * `com.digitalasset.canton.admin.participant.v30.PackageService/RemoveDar`.
 *
 * This is NOT the Ledger JSON API (`POST /v2/packages` has no delete). You need participant-admin gRPC (host:port + TLS
 * material your infra exposes), e.g. Canton console or internal ops tooling — same API the proto documents as
 * potentially unsafe if packages are still in use (#17635 in upstream Canton).
 *
 * Does **not** touch splice-amulet or any package not explicitly listed.
 *
 * Usage (print grpcurl commands — default, safe): npx tsx scripts/remove-participant-dar.ts --preset
 * mainnet-canton-payments-2026-04-23
 *
 * Print commands for **both** mainnet participants (uses env for host:port, or placeholders): npx tsx
 * scripts/remove-participant-dar.ts --preset mainnet-canton-payments-2026-04-23 --mainnet-both
 *
 * Optional: also remove CantonPayments 0.0.38 (also uploaded mainnet that calendar day): npx tsx
 * scripts/remove-participant-dar.ts --preset mainnet-canton-payments-2026-04-23 --include-0-0-38
 *
 * Execute one participant: export CANTON_PARTICIPANT_ADMIN_ADDR='participant-admin.internal:5002' export
 * CANTON_PARTICIPANT_ADMIN_CACERT=/path/to/ca.pem # optional export CANTON_PARTICIPANT_ADMIN_CERT=/path/to/client.pem #
 * optional export CANTON_PARTICIPANT_ADMIN_KEY=/path/to/client.key # optional export
 * CANTON_PARTICIPANT_ADMIN_INSECURE=1 # optional; grpcurl -insecure npx tsx scripts/remove-participant-dar.ts --preset
 * mainnet-canton-payments-2026-04-23 --execute
 *
 * Execute Intellect + 5n mainnet (separate admin gRPC addresses — NOT the public ledger JSON URLs): export
 * CANTON_MAINNET_INTELLECT_PARTICIPANT_ADMIN_ADDR='intellect-admin:5002' export
 * CANTON_MAINNET_5N_PARTICIPANT_ADMIN_ADDR='5n-admin:5002' npx tsx scripts/remove-participant-dar.ts --preset
 * mainnet-canton-payments-2026-04-23 --execute-mainnet-both
 *
 * Custom main package id (64-char hex, no prefix): npx tsx scripts/remove-participant-dar.ts --main-package-id
 * aca762f1ca25b960f4016d00c2eef4263a860e7663e3bb76f4ecf56375508a6a
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const ADMIN_PROTO_ROOT = path.join(ROOT, 'libs/splice/canton/community/admin-api/src/main/protobuf');
const ADMIN_PROTO_REL = 'com/digitalasset/canton/admin/participant/v30/package_service.proto';
const REMOVE_RPC = 'com.digitalasset.canton.admin.participant.v30.PackageService/RemoveDar';

/** Public ledger JSON base URLs (wrong target for RemoveDar — documented in cantonPublic.ts). */
const MAINNET_LEDGER_JSON_HINT = [
  'Intellect mainnet ledger JSON (NOT admin gRPC): https://participant-fairmint-mainnet.canton.catalyst.fairmint.com',
  '5n mainnet ledger JSON (NOT admin gRPC):       https://ledger-api.validator.transfer-agent.xyz',
].join('\n');

/** Main-Dalf package id (64 hex) from backed-up DARs — CantonPayments only. */
const PRESETS: Record<string, readonly string[]> = {
  // dars.lock: 0.0.39 + 0.0.40 recorded mainnet upload 2026-04-23 (splice / airdrop debugging).
  'mainnet-canton-payments-2026-04-23': [
    'aca762f1ca25b960f4016d00c2eef4263a860e7663e3bb76f4ecf56375508a6a', // CantonPayments 0.0.40
    'fd3ff5a072e8f55197c4ef431f57616cda08626e4724266fc2d714cb4d858e8a', // CantonPayments 0.0.39
  ],
};

const PKG_0_0_38 = '8d562fbbd85d6468aa75ad57335a169901fc81cc1f46f058bd8220ec92b56477';

function assertHex64(id: string, label: string): void {
  if (!/^[0-9a-f]{64}$/i.test(id)) {
    throw new Error(`${label} must be exactly 64 hex characters: ${id}`);
  }
}

function grpcImportArgs(): string[] {
  if (!fs.existsSync(path.join(ADMIN_PROTO_ROOT, ADMIN_PROTO_REL))) {
    throw new Error(`Admin proto not found at ${path.join(ADMIN_PROTO_ROOT, ADMIN_PROTO_REL)} — wrong repo layout?`);
  }
  return ['-import-path', ADMIN_PROTO_ROOT, '-proto', ADMIN_PROTO_REL];
}

function buildGrpcurlArgs(addr: string): string[] {
  const args = [...grpcImportArgs()];
  if (process.env.CANTON_PARTICIPANT_ADMIN_INSECURE === '1') {
    args.unshift('-insecure');
  }
  const ca = process.env.CANTON_PARTICIPANT_ADMIN_CACERT?.trim();
  if (ca) args.push('-cacert', ca);
  const cert = process.env.CANTON_PARTICIPANT_ADMIN_CERT?.trim();
  const key = process.env.CANTON_PARTICIPANT_ADMIN_KEY?.trim();
  if (cert && key) {
    args.push('-cert', cert, '-key', key);
  }
  args.push('-d');
  return args;
}

function removeDarOne(mainPackageId: string, execute: boolean, addr: string, label: string): void {
  assertHex64(mainPackageId, 'main_package_id');
  const body = JSON.stringify({ mainPackageId });

  const imp = grpcImportArgs();
  const tls: string[] = [];
  if (process.env.CANTON_PARTICIPANT_ADMIN_INSECURE === '1') tls.push('-insecure');
  if (process.env.CANTON_PARTICIPANT_ADMIN_CACERT?.trim()) {
    tls.push('-cacert', process.env.CANTON_PARTICIPANT_ADMIN_CACERT.trim());
  }
  if (process.env.CANTON_PARTICIPANT_ADMIN_CERT?.trim() && process.env.CANTON_PARTICIPANT_ADMIN_KEY?.trim()) {
    tls.push('-cert', process.env.CANTON_PARTICIPANT_ADMIN_CERT.trim());
    tls.push('-key', process.env.CANTON_PARTICIPANT_ADMIN_KEY.trim());
  }
  const printable = `grpcurl ${imp.join(' ')} ${tls.join(' ')} -d '${body}' ${addr} ${REMOVE_RPC}`
    .replace(/\s+/g, ' ')
    .trim();
  console.log(`\n# [${label}] RemoveDar ${mainPackageId}\n${printable}\n`);

  if (!execute) return;

  const missing = addr.includes('<set ') || addr === '<host:port>';
  if (missing) {
    throw new Error(`[${label}] Missing participant admin address (got placeholder "${addr}")`);
  }

  const grpcArgs = [...buildGrpcurlArgs(addr), body, addr, REMOVE_RPC];
  execFileSync('grpcurl', grpcArgs, {
    stdio: 'inherit',
    env: process.env,
  });
}

function resolveTargets(argv: string[]): Array<{ label: string; addr: string; envHint: string }> {
  const mainnetBoth = argv.includes('--mainnet-both') || argv.includes('--execute-mainnet-both');
  if (mainnetBoth) {
    const intellect =
      process.env.CANTON_MAINNET_INTELLECT_PARTICIPANT_ADMIN_ADDR?.trim() ??
      '<set CANTON_MAINNET_INTELLECT_PARTICIPANT_ADMIN_ADDR>';
    const fiveN =
      process.env.CANTON_MAINNET_5N_PARTICIPANT_ADMIN_ADDR?.trim() ?? '<set CANTON_MAINNET_5N_PARTICIPANT_ADMIN_ADDR>';
    return [
      { label: 'mainnet-intellect', addr: intellect, envHint: 'CANTON_MAINNET_INTELLECT_PARTICIPANT_ADMIN_ADDR' },
      { label: 'mainnet-5n', addr: fiveN, envHint: 'CANTON_MAINNET_5N_PARTICIPANT_ADMIN_ADDR' },
    ];
  }
  const single = process.env.CANTON_PARTICIPANT_ADMIN_ADDR?.trim() ?? '<set CANTON_PARTICIPANT_ADMIN_ADDR>';
  return [{ label: 'participant', addr: single, envHint: 'CANTON_PARTICIPANT_ADMIN_ADDR' }];
}

function main(): void {
  const argv = process.argv.slice(2);
  const execute = argv.includes('--execute') || argv.includes('--execute-mainnet-both');
  const include038 = argv.includes('--include-0-0-38');
  let preset: string | undefined;
  const manual: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--preset' && argv[i + 1]) {
      preset = argv[++i];
    } else if (argv[i] === '--main-package-id' && argv[i + 1]) {
      manual.push(argv[++i]);
    }
  }

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(0, 42).join('\n'));
    process.exit(0);
  }

  let ids: string[] = [];
  if (manual.length > 0) {
    ids = [...manual];
  } else if (preset) {
    const list = PRESETS[preset];
    if (!list) {
      console.error(`Unknown --preset ${preset}. Known: ${Object.keys(PRESETS).join(', ')}`);
      process.exit(1);
    }
    ids = [...list];
  } else {
    console.error(
      'Usage: tsx scripts/remove-participant-dar.ts --preset mainnet-canton-payments-2026-04-23 [--mainnet-both] [--include-0-0-38] [--execute|--execute-mainnet-both]\n' +
        '   or: tsx scripts/remove-participant-dar.ts --main-package-id <64-hex> [--execute]'
    );
    process.exit(1);
  }

  if (include038) {
    ids.push(PKG_0_0_38);
  }

  const targets = resolveTargets(argv);

  if (execute) {
    for (const t of targets) {
      if (t.addr.startsWith('<set ') || t.addr === '<host:port>') {
        console.error(
          `\nCannot --execute: missing ${t.envHint}.\n\n` +
            `${MAINNET_LEDGER_JSON_HINT}\n\n` +
            'Those hosts serve Ledger JSON / v2 REST, not participant admin PackageService; grpcurl gets 404.\n' +
            'Use your internal participant admin gRPC host:port (often :5002 behind kubectl port-forward or VPN).\n'
        );
        process.exit(1);
      }
    }
  }

  console.log(
    '\nParticipant admin RemoveDar — Canton participant only. Does not unvet topology.\n' +
      'Order: newer CantonPayments builds first (preset default), then 0.0.38 only with --include-0-0-38.\n'
  );
  console.log(`${MAINNET_LEDGER_JSON_HINT}\n`);

  try {
    for (const t of targets) {
      console.log(`\n--- ${t.label} (${t.envHint}) ---`);
      for (const id of ids) {
        removeDarOne(id.toLowerCase(), execute, t.addr, t.label);
      }
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (!execute) {
    console.log(
      'Dry-run only (printed commands). To run:\n' +
        '  Single participant: set CANTON_PARTICIPANT_ADMIN_ADDR (+ optional TLS envs), add --execute\n' +
        '  Both mainnet: set CANTON_MAINNET_INTELLECT_PARTICIPANT_ADMIN_ADDR and CANTON_MAINNET_5N_PARTICIPANT_ADMIN_ADDR, add --execute-mainnet-both\n'
    );
  }
}

main();
