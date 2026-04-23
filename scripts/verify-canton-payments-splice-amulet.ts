#!/usr/bin/env node
/**
 * Verify a CantonPayments DAR embeds splice-amulet 0.1.16 (mainnet CC / Amulet package id).
 *
 * Uses `dpm damlc inspect-dar --json` from CantonPayments/ (correct SDK from daml.yaml).
 *
 * Usage:
 *   npx tsx scripts/verify-canton-payments-splice-amulet.ts
 *   npx tsx scripts/verify-canton-payments-splice-amulet.ts --dar CantonPayments/.daml/dist/CantonPayments-0.0.42.dar
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const CANTON_PAYMENTS_DIR = path.join(ROOT, 'CantonPayments');

/** Main package id of standalone `libs/splice/daml/dars/splice-amulet-0.1.16.dar` (canonical). */
export const SPLICE_AMULET_0_1_16_PACKAGE_ID =
  'c208d7ead1e4e9b610fc2054d0bf00716144ad444011bce0b02dcd6cd0cb8a23';

function main(): void {
  const argv = process.argv.slice(2);
  let darPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dar' && argv[i + 1]) {
      darPath = path.resolve(ROOT, argv[++i]);
    }
  }
  if (!darPath) {
    const yamlPath = path.join(CANTON_PAYMENTS_DIR, 'daml.yaml');
    const yaml = fs.readFileSync(yamlPath, 'utf8');
    const m = yaml.match(/^version:\s*(\S+)/m);
    const ver = m?.[1];
    if (!ver) throw new Error('Could not read version from CantonPayments/daml.yaml');
    darPath = path.join(CANTON_PAYMENTS_DIR, '.daml', 'dist', `CantonPayments-${ver}.dar`);
  }

  if (!fs.existsSync(darPath)) {
    console.error(`DAR not found: ${darPath}\nRun: cd CantonPayments && dpm build`);
    process.exit(1);
  }

  const raw = execFileSync(
    'dpm',
    ['damlc', 'inspect-dar', path.relative(CANTON_PAYMENTS_DIR, darPath), '--json'],
    { cwd: CANTON_PAYMENTS_DIR, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  const j = JSON.parse(raw) as {
    main_package_id: string;
    packages: Record<string, { name?: string; path?: string }>;
  };

  let spliceId: string | undefined;
  let splicePath: string | undefined;
  for (const [pid, meta] of Object.entries(j.packages)) {
    if (meta.name === 'splice-amulet') {
      spliceId = pid;
      splicePath = meta.path;
      break;
    }
  }

  if (!spliceId) {
    console.error('No embedded package named "splice-amulet" in DAR inspect JSON.');
    process.exit(1);
  }

  const ok = spliceId.toLowerCase() === SPLICE_AMULET_0_1_16_PACKAGE_ID.toLowerCase();
  console.log(`CantonPayments main: ${j.main_package_id}`);
  console.log(`Embedded splice-amulet package_id: ${spliceId}`);
  console.log(`Path fragment: ${splicePath?.includes('splice-amulet-0.1.16') ? 'contains 0.1.16' : splicePath ?? '(none)'}`);
  if (!ok) {
    console.error(
      `\nExpected splice-amulet package id ${SPLICE_AMULET_0_1_16_PACKAGE_ID} (0.1.16).\n` +
        `Daml code may still call LockedAmulet_Unlock, but this DAR is not linked against 0.1.16 LF.\n`,
    );
    process.exit(1);
  }

  const libCp = path.join(ROOT, 'lib', 'CantonPayments');
  if (fs.existsSync(libCp)) {
    const bad: string[] = [];
    const walk = (dir: string): void => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.name.endsWith('.js') || ent.name.endsWith('.d.ts')) {
          const t = fs.readFileSync(p, 'utf8');
          if (t.includes('splice-amulet-0.1.17')) bad.push(path.relative(ROOT, p));
        }
      }
    };
    walk(libCp);
    if (bad.length > 0) {
      console.error(
        '\nPublished lib/CantonPayments still references splice-amulet-0.1.17 in JS/typings.\n' +
          'Regenerate and bundle: `cd CantonPayments && dpm codegen-js && cd .. && npx tsx scripts/bundle-dependencies.ts && npx tsx scripts/create-package-index.ts && npx tsx scripts/create-root-index.ts && npx tsx scripts/fix-splice-refs.ts && npm run build:ts`\n' +
          `Offending files (${bad.length}):\n  ${bad.slice(0, 12).join('\n  ')}${bad.length > 12 ? '\n  …' : ''}\n`,
      );
      process.exit(1);
    }
  }

  console.log('\nOK — CantonPayments DAR is built against splice-amulet 0.1.16.');
}

void main();
