/**
 * OCF record dispatch generator.
 *
 * Generates `Fairmint/OpenCapTable/OcfRecords.daml`: the `OcfRecordData` and `OcfRecordCid` sums over every OCF record
 * template, and the functions that create, fetch, archive and view any of them. The register's anchor and its writes
 * are hand-written source; only this 51-way dispatch is generated.
 *
 * One naming rule, no overrides: each template `X` in `OCF/X.daml` has the fields `context : Context` and `ocf_data :
 * XOcfData`, and its `OcfObject` instance names its object type (`object_type = OcfObjectType...`).
 *
 * The constructors follow `record-order.json`, not the file names: variants stay upgrade-compatible only when
 * constructors are appended, so a new template goes at the end of that list and no entry ever moves or leaves.
 *
 * Usage: tsx scripts/codegen/generate-captable.ts
 */

import * as fs from 'fs';
import Handlebars from 'handlebars';
import * as path from 'path';

import { requirePackageConfig } from '../packages';

const ROOT = path.resolve(__dirname, '../..');
const PACKAGE_DIR = requirePackageConfig('ocp').sourceDir;
const OCF_DIR = path.join(ROOT, PACKAGE_DIR, 'daml/Fairmint/OpenCapTable/OCF');
const TEMPLATE_PATH = path.join(__dirname, 'templates/OcfRecords.daml.template');
const OUTPUT_PATH = path.join(ROOT, PACKAGE_DIR, 'daml/Fairmint/OpenCapTable/OcfRecords.daml');
const ORDER_PATH = path.join(__dirname, 'record-order.json');

export interface RecordType {
  name: string;
  data_type: string;
  object_type: string;
}

/** Reads one OCF module and checks it follows the naming rule. */
export function parseRecordType(name: string, source: string): RecordType {
  const dataType = `${name}OcfData`;
  const template = new RegExp(
    `^template ${name}\\s*\\n\\s*with\\s*\\n\\s*context\\s*:\\s*Context\\s*\\n\\s*ocf_data\\s*:\\s*${dataType}\\s*\\n`,
    'm'
  );
  if (!template.test(source)) {
    throw new Error(`OCF/${name}.daml must declare "template ${name} with context : Context; ocf_data : ${dataType}"`);
  }
  if (!new RegExp(`^data ${dataType}\\b`, 'm').test(source)) {
    throw new Error(`OCF/${name}.daml must define data ${dataType}`);
  }
  if (!new RegExp(`^validate${dataType}\\s*:`, 'm').test(source)) {
    throw new Error(`OCF/${name}.daml must define validate${dataType}`);
  }
  const objectType = /object_type\s*=\s*(OcfObjectType\w+)/.exec(source);
  if (!objectType) {
    throw new Error(`OCF/${name}.daml must implement OcfObject with object_type = OcfObjectType...`);
  }
  return { name, data_type: dataType, object_type: objectType[1] };
}

/** The template names in constructor order: every OCF module, each exactly once, in the committed order. */
export function orderRecordTypes(files: string[], order: string[]): string[] {
  const present = new Set(files);
  const duplicate = order.find((name, i) => order.indexOf(name) !== i);
  if (duplicate) throw new Error(`record-order.json lists ${duplicate} twice`);
  const missing = order.filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new Error(
      `record-order.json lists ${missing.join(', ')} with no OCF/<name>.daml; a constructor never leaves a released variant`
    );
  }
  const listed = new Set(order);
  const unlisted = files.filter((name) => !listed.has(name)).sort((a, b) => a.localeCompare(b));
  if (unlisted.length > 0) {
    throw new Error(
      `OCF/${unlisted.join('.daml, OCF/')}.daml ${unlisted.length === 1 ? 'is' : 'are'} not in record-order.json; ` +
        'append new templates at the end, so the generated variants stay upgrade-compatible'
    );
  }
  return order;
}

export function discoverRecordTypes(ocfDir: string = OCF_DIR, orderPath: string = ORDER_PATH): RecordType[] {
  const files = fs
    .readdirSync(ocfDir)
    .filter((file) => file.endsWith('.daml'))
    .map((file) => file.replace(/\.daml$/, ''));
  const { order } = JSON.parse(fs.readFileSync(orderPath, 'utf8')) as { order: string[] };
  return orderRecordTypes(files, order).map((name) =>
    parseRecordType(name, fs.readFileSync(path.join(ocfDir, `${name}.daml`), 'utf8'))
  );
}

export function render(types: RecordType[]): string {
  const template = Handlebars.compile(fs.readFileSync(TEMPLATE_PATH, 'utf8'), { noEscape: true });
  return template({ types, count: types.length });
}

function generate(): void {
  const types = discoverRecordTypes();
  const objectTypes = new Set(types.map((t) => t.object_type));
  if (objectTypes.size !== types.length) {
    throw new Error('Two OCF templates name the same OcfObjectType');
  }
  fs.writeFileSync(OUTPUT_PATH, render(types));
  console.log(`Generated ${path.relative(ROOT, OUTPUT_PATH)} for ${types.length} OCF record templates`);
}

if (require.main === module) {
  generate();
}
