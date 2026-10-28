/**
 * DAML-to-OCF schema gap checker.
 *
 * Scans the OpenCapTable package and the OpenCapTableApi package for annotations directly above `data` declarations:
 *
 * - `-- OCF: <url>`: an official OCF schema, resolved under `--ocf-schema-dir` (default: the OCF submodule of a sibling
 *   `ocp-canton-sdk` checkout, `../ocp-canton-sdk/libs/Open-Cap-Format-OCF/schema`, pinned to the commit the links
 *   name);
 * - `-- Fairmint OCF extension: <path>`: a schema of the declared Fairmint extension (the hold pair), resolved under
 *   `ocf-extension/schema/`.
 *
 * For each annotated type it checks that every schema property is a DAML field (records), that the constructors are the
 * type name plus each OCF value in PascalCase, in OCF order (enums), and that every OCF Date property is a DAML `Date`,
 * `Optional Date` or `[Date]`. It also requires an annotation on every `*OcfData` type in `OCF/`, forbids `Time` and
 * nested optional dates in the OCF and Types modules, and checks the extension against its registry below: exactly the
 * declared types carry extension annotations, the amended ObjectType enum and TransactionsFile are upstream plus
 * exactly the declared additions, the amended Object primitive is upstream's with that enum, and sample hold records
 * validate against the complete schemas, OCF's included.
 *
 * Usage: npx tsx scripts/schema-gap-checker/check-schema-gaps.ts [--package OpenCapTable-v36] [--api-package
 * OpenCapTableApi-v01] [--ocf-schema-dir /path/to/schema] [--extension-schema-dir /path/to/ocf-extension/schema]
 */

import Ajv, { type AnySchema } from 'ajv';
import * as fs from 'fs';
import * as path from 'path';

const ROOT_DIR = path.join(__dirname, '..', '..');
const DEFAULT_OCF_SCHEMA_DIR = path.join(ROOT_DIR, '..', 'ocp-canton-sdk', 'libs', 'Open-Cap-Format-OCF', 'schema');
const DEFAULT_EXTENSION_SCHEMA_DIR = path.join(ROOT_DIR, 'ocf-extension', 'schema');

/** URL path segment that marks a schema of the Fairmint extension (its `$id`s live under this repository). */
const EXTENSION_URL_MARKER = '/ocf-extension/schema/';
const OCF_URL_MARKER = '/schema/';

// ---------------------------------------------------------------------------
// The declared Fairmint OCF extension (ocf-extension/README.md)
// ---------------------------------------------------------------------------

export const DECLARED_EXTENSION = {
  /** Object types the extension adds to OCF's ObjectType enum, in order. */
  objectTypes: ['TX_STOCK_HOLD', 'TX_STOCK_HOLD_CANCELLATION'],
  /** DAML types annotated with `-- Fairmint OCF extension:`, and the extension schema each one implements. */
  types: {
    StockHoldOcfData: 'objects/transactions/hold/StockHold.schema.json',
    StockHoldCancellationOcfData: 'objects/transactions/hold/StockHoldCancellation.schema.json',
    OcfHoldType: 'enums/HoldType.schema.json',
  } as Record<string, string>,
  /** Object schemas the amended TransactionsFile adds to OCF's `items.oneOf`. */
  transactionsFileAdditions: [
    'objects/transactions/hold/StockHold.schema.json',
    'objects/transactions/hold/StockHoldCancellation.schema.json',
  ],
};

// ---------------------------------------------------------------------------
// Allowlists — properties that are never flagged as missing
// ---------------------------------------------------------------------------

const GLOBAL_ALLOWLIST = new Set(['object_type']);

/** Schema properties a type deliberately does not store. Entries that no longer apply fail the check. */
const PER_TYPE_ALLOWLIST: Record<string, Set<string>> = {
  StakeholderOcfData: new Set(['current_relationship']),
  StockPlanOcfData: new Set(['stock_class_id']),
  EquityCompensationIssuanceOcfData: new Set(['option_grant_type']),
};

/** Enum values a DAML enum deliberately omits (writers normalize them), and the values it appends after OCF's. */
const ENUM_RULES: Record<string, { omit?: RegExp; append?: string[] }> = {
  // OCF's seven TX_PLAN_SECURITY_* aliases normalize to TX_EQUITY_COMPENSATION_*; the hold pair comes last.
  OcfObjectType: { omit: /^TX_PLAN_SECURITY_/, append: DECLARED_EXTENSION.objectTypes },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnnotationKind = 'ocf' | 'extension';

export interface Annotation {
  kind: AnnotationKind;
  /** As written in the DAML comment. */
  target: string;
  /** Path relative to its schema root (OCF or extension). */
  relativePath: string;
  /** Root the relative path resolves against. */
  root: AnnotationKind;
}

export interface Constructor {
  name: string;
  /** `nullary` (an enum value), `record` (`C with …`) or `positional` (`C SomeType`). */
  kind: 'nullary' | 'record' | 'positional';
}

export interface DamlTypeInfo {
  typeName: string;
  /** Field name → DAML type text, unioned over every constructor. */
  fields: Map<string, string>;
  constructors: Constructor[];
  annotations: Annotation[];
  sourceFile: string;
  line: number;
}

interface PropertyInfo {
  isConst: boolean;
  /** `$ref` of the property, or of its `items`. */
  ref?: string;
  source: string;
}

interface SchemaInfo {
  properties: Map<string, PropertyInfo>;
  enumValues: string[] | null;
}

interface SchemaRoots {
  ocf: string;
  extension: string;
}

interface Problem {
  typeName: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Schema resolution
// ---------------------------------------------------------------------------

/** Resolve a schema URL (a `$ref` or an OCF annotation) to its root and relative path. */
export function resolveSchemaUrl(url: string): { root: AnnotationKind; relativePath: string } | null {
  const extensionIdx = url.indexOf(EXTENSION_URL_MARKER);
  if (extensionIdx !== -1) {
    return { root: 'extension', relativePath: url.slice(extensionIdx + EXTENSION_URL_MARKER.length) };
  }
  const ocfIdx = url.indexOf(OCF_URL_MARKER);
  if (ocfIdx !== -1) {
    return { root: 'ocf', relativePath: url.slice(ocfIdx + OCF_URL_MARKER.length) };
  }
  return null;
}

function schemaFile(roots: SchemaRoots, root: AnnotationKind, relativePath: string): string {
  return path.join(root === 'ocf' ? roots.ocf : roots.extension, relativePath);
}

function readSchema(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Schema file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function propertyRef(def: Record<string, unknown>): string | undefined {
  if (typeof def.$ref === 'string') return def.$ref;
  if (isRecord(def.items) && typeof def.items.$ref === 'string') return def.items.$ref;
  return undefined;
}

const schemaCache = new Map<string, SchemaInfo>();

/**
 * Collect a schema's properties: its own `properties`, plus each `allOf` entry's `properties` and `$ref` (recursively).
 * A property defined in several places keeps the definition that carries a `$ref` (own-schema re-declarations such as
 * `"date": {}` have none). Missing schema files are errors.
 */
export function collectSchema(filePath: string, roots: SchemaRoots): SchemaInfo {
  const cached = schemaCache.get(filePath);
  if (cached) return cached;

  const schema = readSchema(filePath);
  const info: SchemaInfo = {
    properties: new Map(),
    enumValues: Array.isArray(schema.enum) ? schema.enum.map(String) : null,
  };
  schemaCache.set(filePath, info);

  const merge = (name: string, next: PropertyInfo): void => {
    const existing = info.properties.get(name);
    info.properties.set(
      name,
      existing
        ? { isConst: existing.isConst || next.isConst, ref: existing.ref ?? next.ref, source: existing.source }
        : next
    );
  };
  const addProperties = (properties: unknown, source: string): void => {
    if (!isRecord(properties)) return;
    for (const [name, def] of Object.entries(properties)) {
      const record = isRecord(def) ? def : {};
      merge(name, { isConst: 'const' in record, ref: propertyRef(record), source });
    }
  };

  const fileName = path.basename(filePath);
  addProperties(schema.properties, fileName);
  if (Array.isArray(schema.allOf)) {
    for (const entry of schema.allOf) {
      if (!isRecord(entry)) continue;
      if (typeof entry.$ref === 'string') {
        const resolved = resolveSchemaUrl(entry.$ref);
        if (!resolved) throw new Error(`${fileName}: cannot resolve $ref ${entry.$ref}`);
        const ref = collectSchema(schemaFile(roots, resolved.root, resolved.relativePath), roots);
        for (const [name, prop] of ref.properties) merge(name, prop);
      }
      addProperties(entry.properties, fileName);
    }
  }
  return info;
}

// ---------------------------------------------------------------------------
// DAML scanning
// ---------------------------------------------------------------------------

const OCF_ANNOTATION_RE = /^--\s+OCF(?:\s*\([^)]*\))?\s*:\s*(https?:\/\/\S+)/;
const EXTENSION_ANNOTATION_RE = /^--\s+Fairmint OCF extension:\s*(\S+)/;
const DATA_DECL_RE = /^data\s+([A-Z]\w*)/;

/** Remove `{- -}` block comments, keeping line breaks so line numbers stay right. */
function stripBlockComments(source: string): string {
  return source.replace(/\{-[\s\S]*?-\}/g, (match) => match.replace(/[^\n]/g, ' '));
}

/** Remove a line comment (`--` outside a string literal). */
export function stripLineComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== '\\') inString = !inString;
    if (!inString && ch === '-' && line[i + 1] === '-') return line.slice(0, i);
  }
  return line;
}

function parseAnnotation(line: string): Annotation | 'invalid' | null {
  const ocf = OCF_ANNOTATION_RE.exec(line);
  if (ocf) {
    const resolved = resolveSchemaUrl(ocf[1]);
    if (!resolved || !ocf[1].endsWith('.schema.json')) return 'invalid';
    return { kind: 'ocf', target: ocf[1], ...resolved };
  }
  const extension = EXTENSION_ANNOTATION_RE.exec(line);
  if (extension) {
    if (!extension[1].endsWith('.schema.json')) return 'invalid';
    return { kind: 'extension', target: extension[1], root: 'extension', relativePath: extension[1] };
  }
  return null;
}

/** Parse the alternatives of a `data` declaration's text (comments stripped, `deriving` removed). */
export function parseDataBody(declaration: string): { constructors: Constructor[]; fields: Map<string, string> } {
  const constructors: Constructor[] = [];
  const fields = new Map<string, string>();
  const eq = declaration.indexOf('=');
  if (eq === -1) return { constructors, fields };

  for (const alternative of declaration.slice(eq + 1).split('|')) {
    const text = alternative.trim();
    const nameMatch = /^([A-Z]\w*)/.exec(text);
    if (!nameMatch) continue;
    const rest = text.slice(nameMatch[1].length).trim();
    const kind = rest.length === 0 ? 'nullary' : /^with\b/.test(rest) ? 'record' : 'positional';
    constructors.push({ name: nameMatch[1], kind });
    if (kind !== 'record') continue;
    for (const segment of rest.slice(4).split(/[\n;]/)) {
      const field = /^\s*([a-z_]\w*)\s*:\s*(.+?)\s*$/.exec(segment);
      if (field) fields.set(field[1], field[2]);
    }
  }
  return { constructors, fields };
}

/**
 * Scan one DAML file for data declarations and the annotations in the comment block directly above each. An annotation
 * above anything else (a validator, say) documents it and is not checked; a lost `*OcfData` annotation is caught by the
 * coverage rule in `main`.
 */
export function scanDamlSource(source: string, sourceFile: string): { types: DamlTypeInfo[]; problems: Problem[] } {
  const lines = stripBlockComments(source).split('\n');
  const types: DamlTypeInfo[] = [];
  const problems: Problem[] = [];
  let pending: Annotation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('--')) {
      const annotation = parseAnnotation(line);
      if (annotation === 'invalid') {
        problems.push({
          typeName: `${sourceFile}:${i + 1}`,
          message: `annotation does not name a .schema.json: ${line}`,
        });
      } else if (annotation) {
        pending.push(annotation);
      }
      continue;
    }

    const dataMatch = DATA_DECL_RE.exec(line);
    if (dataMatch) {
      const block = [stripLineComment(line)];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (next.length > 0 && !/^\s/.test(next) && !next.startsWith('--')) break;
        block.push(stripLineComment(next));
      }
      const declaration = block.join('\n').replace(/\bderiving\b[\s\S]*$/, '');
      const { constructors, fields } = parseDataBody(declaration);
      types.push({
        typeName: dataMatch[1],
        fields,
        constructors,
        annotations: pending,
        sourceFile,
        line: i + 1,
      });
      pending = [];
      continue;
    }

    pending = [];
  }
  return { types, problems };
}

/** Recursively find all .daml files under a directory. */
function findDamlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findDamlFiles(fullPath));
    } else if (entry.name.endsWith('.daml')) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** `REGISTER_SETTLEMENT` → `RegisterSettlement`; `NOT APPLICABLE` → `NotApplicable`. */
export function pascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

function isDateRef(ref: string | undefined): boolean {
  return ref?.endsWith('types/Date.schema.json') ?? false;
}

const DATE_FIELD_TYPES = new Set(['Date', 'Optional Date', '[Date]']);

/** Check one annotated type against its schemas; returns the problems and the number of properties or values checked. */
function checkType(info: DamlTypeInfo, roots: SchemaRoots): { problems: string[]; checked: number; variant?: boolean } {
  const problems: string[] = [];
  const schemas = info.annotations.map((a) => ({
    annotation: a,
    schema: collectSchema(schemaFile(roots, a.root, a.relativePath), roots),
  }));

  const enumSchemas = schemas.filter(({ schema }) => schema.enumValues !== null);
  if (enumSchemas.length > 0) {
    if (enumSchemas.length !== schemas.length || enumSchemas.length > 1) {
      return { problems: ['links an enum schema together with other schemas'], checked: 0 };
    }
    const rule = ENUM_RULES[info.typeName] ?? {};
    const values = [
      ...(enumSchemas[0].schema.enumValues ?? []).filter((v) => !rule.omit?.test(v)),
      ...(rule.append ?? []),
    ];
    const expected = values.map((v) => `${info.typeName}${pascalCase(v)}`);
    const actual = info.constructors.map((c) => c.name);
    const nonNullary = info.constructors.filter((c) => c.kind !== 'nullary').map((c) => c.name);
    if (nonNullary.length > 0) problems.push(`enum constructors take arguments: ${nonNullary.join(', ')}`);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      const missing = expected.filter((name) => !actual.includes(name));
      const extra = actual.filter((name) => !expected.includes(name));
      problems.push(
        missing.length === 0 && extra.length === 0
          ? `enum constructors are not in OCF order: expected ${expected.join(' | ')}`
          : `enum constructors differ from OCF:${missing.length ? ` missing ${missing.join(', ')};` : ''}${extra.length ? ` unexpected ${extra.join(', ')}` : ''}`
      );
    }
    return { problems, checked: values.length };
  }

  if (info.constructors.length > 0 && info.constructors.every((c) => c.kind === 'positional')) {
    // A sum of other types (one OCF property's alternatives): each alternative's own type carries the check.
    return { problems: [], checked: 0, variant: true };
  }

  const properties = new Map<string, PropertyInfo>();
  for (const { schema } of schemas) {
    for (const [name, prop] of schema.properties) {
      const existing = properties.get(name);
      properties.set(
        name,
        existing
          ? { isConst: existing.isConst || prop.isConst, ref: existing.ref ?? prop.ref, source: existing.source }
          : prop
      );
    }
  }

  const damlFieldFor = (prop: string): string | undefined =>
    info.fields.has(prop) ? prop : info.fields.has(`${prop}_`) ? `${prop}_` : undefined;
  const allowlist = PER_TYPE_ALLOWLIST[info.typeName] ?? new Set<string>();

  for (const [prop, def] of [...properties.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const field = damlFieldFor(prop);
    if (!field) {
      if (GLOBAL_ALLOWLIST.has(prop) || allowlist.has(prop) || def.isConst) continue;
      problems.push(`missing "${prop}" (from ${def.source})`);
      continue;
    }
    if (isDateRef(def.ref)) {
      const type = info.fields.get(field) ?? '';
      if (!DATE_FIELD_TYPES.has(type.replace(/\s+/g, ' ').trim())) {
        problems.push(`"${field}" is an OCF Date but has type ${type}; use Date, Optional Date or [Date]`);
      }
    }
  }

  for (const prop of allowlist) {
    if (!properties.has(prop)) problems.push(`stale allowlist entry "${prop}": not in the linked schemas`);
    else if (damlFieldFor(prop)) problems.push(`stale allowlist entry "${prop}": the DAML type has this field`);
  }

  if (info.fields.size === 0) problems.push('links a record schema but has no fields');
  return { problems, checked: properties.size };
}

/** No `Time` type, and no nested optional date, in the OCF and Types modules (OCF dates are calendar dates). */
export function checkDateTypes(source: string): string[] {
  const problems: string[] = [];
  const lines = stripBlockComments(source).split('\n');
  lines.forEach((raw, index) => {
    const line = stripLineComment(raw).replace(/"(?:[^"\\]|\\.)*"/g, '""');
    if (/(?<![.\w])Time(?![.\w])/.test(line)) {
      problems.push(`line ${index + 1}: uses Time; OCF dates are Daml Date`);
    }
    if (/Optional\s*\(\s*Optional\s+Date\s*\)/.test(line)) {
      problems.push(`line ${index + 1}: nested optional Date`);
    }
  });
  return problems;
}

function enumValuesOf(filePath: string): string[] {
  const schema = readSchema(filePath);
  if (!Array.isArray(schema.enum)) throw new Error(`${filePath} has no enum`);
  return schema.enum.map(String);
}

function transactionsFileRefs(filePath: string): string[] {
  const schema = readSchema(filePath);
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const items = isRecord(properties.items) && isRecord(properties.items.items) ? properties.items.items : {};
  if (!Array.isArray(items.oneOf)) throw new Error(`${filePath} has no properties.items.items.oneOf`);
  return items.oneOf
    .map((entry) => (isRecord(entry) && typeof entry.$ref === 'string' ? resolveSchemaUrl(entry.$ref) : null))
    .map((resolved) => (resolved ? `${resolved.root}:${resolved.relativePath}` : '?'));
}

/** The amended ObjectType enum and TransactionsFile must be upstream plus exactly the declared additions. */
function checkAmendedFiles(roots: SchemaRoots): string[] {
  const problems: string[] = [];
  const upstream = enumValuesOf(path.join(roots.ocf, 'enums', 'ObjectType.schema.json'));
  const amended = enumValuesOf(path.join(roots.extension, 'enums', 'ObjectType.schema.json'));
  const expectedEnum = [...upstream, ...DECLARED_EXTENSION.objectTypes];
  if (JSON.stringify(amended) !== JSON.stringify(expectedEnum)) {
    problems.push(
      `enums/ObjectType.schema.json must be OCF's values followed by ${DECLARED_EXTENSION.objectTypes.join(', ')}`
    );
  }

  const upstreamRefs = transactionsFileRefs(path.join(roots.ocf, 'files', 'TransactionsFile.schema.json'));
  const amendedRefs = transactionsFileRefs(path.join(roots.extension, 'files', 'TransactionsFile.schema.json'));
  const additions = DECLARED_EXTENSION.transactionsFileAdditions.map((rel) => `extension:${rel}`);
  const expectedRefs = new Set([...upstreamRefs, ...additions]);
  const missing = [...expectedRefs].filter((ref) => !amendedRefs.includes(ref));
  const extra = amendedRefs.filter((ref) => !expectedRefs.has(ref));
  if (missing.length > 0 || extra.length > 0 || amendedRefs.length !== expectedRefs.size) {
    problems.push(
      `files/TransactionsFile.schema.json items must be OCF's plus the hold pair:${missing.length ? ` missing ${missing.join(', ')};` : ''}${extra.length ? ` unexpected ${extra.join(', ')}` : ''}`
    );
  }
  return problems;
}

/** The extension's Object primitive must be OCF's, with `object_type` taking the amended ObjectType enum. */
function checkObjectPrimitive(roots: SchemaRoots): string[] {
  const upstream = readSchema(path.join(roots.ocf, 'primitives', 'objects', 'Object.schema.json'));
  const amended = readSchema(path.join(roots.extension, 'primitives', 'objects', 'Object.schema.json'));
  const props = (schema: Record<string, unknown>): Record<string, unknown> =>
    isRecord(schema.properties) ? schema.properties : {};
  const objectTypeRef = (schema: Record<string, unknown>): string => {
    const objectType = props(schema).object_type;
    const resolved =
      isRecord(objectType) && typeof objectType.$ref === 'string' ? resolveSchemaUrl(objectType.$ref) : null;
    return resolved ? `${resolved.root}:${resolved.relativePath}` : '?';
  };
  const withoutObjectTypeRef = (schema: Record<string, unknown>): string => {
    const { object_type: objectType, ...rest } = props(schema);
    const { $ref: _ref, ...objectTypeRest } = isRecord(objectType) ? objectType : {};
    return JSON.stringify({ properties: { ...rest, object_type: objectTypeRest }, required: schema.required });
  };
  const problems: string[] = [];
  if (objectTypeRef(amended) !== 'extension:enums/ObjectType.schema.json') {
    problems.push(
      "primitives/objects/Object.schema.json's object_type must take the amended enums/ObjectType.schema.json"
    );
  }
  if (withoutObjectTypeRef(amended) !== withoutObjectTypeRef(upstream)) {
    problems.push(
      "primitives/objects/Object.schema.json must match OCF's Object primitive except for object_type's enum"
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Extension records against the complete schemas
// ---------------------------------------------------------------------------

export interface ExtensionSample {
  /** Extension schema, relative to its root. */
  schema: string;
  label: string;
  valid: boolean;
  record: unknown;
}

const SAMPLE_DATE = '2026-01-15';
const settlementHold = {
  object_type: 'TX_STOCK_HOLD',
  id: 'hold-1',
  date: SAMPLE_DATE,
  security_id: 'S-1',
  hold_type: 'REGISTER_SETTLEMENT',
  reference: 'T-1',
  reason_text: 'Settlement of trade T-1',
  quantity: '100',
};
const stopHold = {
  object_type: 'TX_STOCK_HOLD',
  id: 'hold-2',
  date: SAMPLE_DATE,
  security_id: 'S-1',
  hold_type: 'STOP_TRANSFER',
  reference: 'CASE-1',
  reason_text: 'Court order',
};
const holdCancellation = {
  object_type: 'TX_STOCK_HOLD_CANCELLATION',
  id: 'hold-1-cancel',
  date: SAMPLE_DATE,
  security_id: 'S-1',
  hold_id: 'hold-1',
  reason_text: 'Trade released',
};

/** Records the extension schemas must accept, and must reject, with every `$ref` resolved. */
export const EXTENSION_SAMPLES: ExtensionSample[] = [
  {
    schema: 'objects/transactions/hold/StockHold.schema.json',
    label: 'a settlement hold',
    valid: true,
    record: settlementHold,
  },
  { schema: 'objects/transactions/hold/StockHold.schema.json', label: 'a stop', valid: true, record: stopHold },
  {
    schema: 'objects/transactions/hold/StockHold.schema.json',
    label: 'a settlement hold without a quantity',
    valid: false,
    record: { ...settlementHold, quantity: undefined },
  },
  {
    schema: 'objects/transactions/hold/StockHold.schema.json',
    label: 'a stop with a quantity',
    valid: false,
    record: { ...stopHold, quantity: '1' },
  },
  {
    schema: 'objects/transactions/hold/StockHoldCancellation.schema.json',
    label: 'a hold cancellation',
    valid: true,
    record: holdCancellation,
  },
  {
    schema: 'objects/transactions/hold/StockHoldCancellation.schema.json',
    label: 'a hold under the cancellation type',
    valid: false,
    record: { ...settlementHold, object_type: 'TX_STOCK_HOLD_CANCELLATION' },
  },
  {
    schema: 'files/TransactionsFile.schema.json',
    label: 'an extended transactions file with the hold pair',
    valid: true,
    record: { file_type: 'OCF_TRANSACTIONS_FILE', items: [settlementHold, stopHold, holdCancellation] },
  },
];

const LOCAL_SCHEMA_BASE = 'https://schemas.invalid/';

/**
 * Rewrites every `$id` and `$ref` URL to `<base><root>/<path>`, so the pinned URLs the extension uses and the `main`
 * URLs OCF's own schemas use name the same schema, and drops `$schema`.
 */
export function localizeSchemaUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(localizeSchemaUrls);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === '$schema') continue;
    const resolved = (key === '$id' || key === '$ref') && typeof entry === 'string' ? resolveSchemaUrl(entry) : null;
    out[key] = resolved ? `${LOCAL_SCHEMA_BASE}${resolved.root}/${resolved.relativePath}` : localizeSchemaUrls(entry);
  }
  return out;
}

/** Validates each sample against its extension schema; `schemas` are already localized. */
export function checkExtensionSamples(schemas: unknown[], samples: ExtensionSample[]): string[] {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  for (const schema of schemas) ajv.addSchema(schema as AnySchema);
  const problems: string[] = [];
  for (const sample of samples) {
    const id = `${LOCAL_SCHEMA_BASE}extension/${sample.schema}`;
    let valid: boolean;
    let errors = '';
    try {
      const validate = ajv.getSchema(id);
      if (!validate) {
        problems.push(`${sample.schema}: no such schema`);
        continue;
      }
      valid = validate(JSON.parse(JSON.stringify(sample.record))) as boolean;
      errors = valid ? '' : ajv.errorsText(validate.errors?.slice(0, 3));
    } catch (error) {
      problems.push(`${sample.schema}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (valid !== sample.valid) {
      problems.push(
        `${sample.schema}: ${sample.label} is ${valid ? 'accepted but must be rejected' : `rejected (${errors})`}`
      );
    }
  }
  return problems;
}

function schemaFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return schemaFiles(full);
    return entry.name.endsWith('.schema.json') ? [full] : [];
  });
}

/** The extension's records validate against its complete schemas, OCF's included. */
function checkExtensionRecords(roots: SchemaRoots): string[] {
  const schemas = [...schemaFiles(roots.ocf), ...schemaFiles(roots.extension)].map((file) =>
    localizeSchemaUrls(readSchema(file))
  );
  return checkExtensionSamples(schemas, EXTENSION_SAMPLES);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx === args.length - 1) return undefined;
  return args[idx + 1];
}

/** The highest `<prefix>-vNN` directory at the repository root. */
function detectLatestPackage(prefix: string): string {
  const pattern = new RegExp(`^${prefix}-v(\\d+)$`);
  const candidates = fs
    .readdirSync(ROOT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, match: pattern.exec(entry.name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
    .sort((a, b) => Number(b.match[1]) - Number(a.match[1]));
  if (candidates.length === 0) {
    throw new Error(`No ${prefix}-v* directory found`);
  }
  return candidates[0].name;
}

function main(): void {
  const packages = [
    parseArg('package') ?? detectLatestPackage('OpenCapTable'),
    parseArg('api-package') ?? detectLatestPackage('OpenCapTableApi'),
  ];
  const roots: SchemaRoots = {
    ocf: path.resolve(parseArg('ocf-schema-dir') ?? DEFAULT_OCF_SCHEMA_DIR),
    extension: path.resolve(parseArg('extension-schema-dir') ?? DEFAULT_EXTENSION_SCHEMA_DIR),
  };
  for (const [label, dir] of [
    ['OCF schema directory (pass --ocf-schema-dir)', roots.ocf],
    ['Fairmint OCF extension schema directory', roots.extension],
  ]) {
    if (!fs.existsSync(dir)) {
      console.error(`❌ ${label} not found: ${dir}`);
      process.exit(1);
    }
  }

  console.log(`🔍 Checking DAML-to-OCF schema gaps for ${packages.join(' and ')}...\n`);

  const problems: Problem[] = [];
  const allTypes: DamlTypeInfo[] = [];
  for (const pkg of packages) {
    const damlDir = path.resolve(ROOT_DIR, pkg, 'daml');
    if (!fs.existsSync(damlDir)) {
      console.error(`❌ DAML source directory not found: ${damlDir}`);
      process.exit(1);
    }
    for (const file of findDamlFiles(damlDir)) {
      const rel = path.relative(ROOT_DIR, file);
      const source = fs.readFileSync(file, 'utf8');
      const scanned = scanDamlSource(source, rel);
      allTypes.push(...scanned.types);
      problems.push(...scanned.problems);

      const segments = rel.split(path.sep);
      const isOcfModule = segments.includes('OCF');
      if (isOcfModule || segments.includes('Types')) {
        for (const message of checkDateTypes(source)) problems.push({ typeName: rel, message });
      }
      if (isOcfModule) {
        for (const type of scanned.types) {
          if (type.typeName.endsWith('OcfData') && type.annotations.length === 0) {
            problems.push({
              typeName: type.typeName,
              message: `${rel}:${type.line} has no OCF or extension annotation`,
            });
          }
        }
      }
    }
  }

  // Extension registry: exactly the declared types carry extension annotations, each for its declared schema.
  const extensionTypes = allTypes.filter((t) => t.annotations.some((a) => a.kind === 'extension'));
  for (const type of extensionTypes) {
    const declared = DECLARED_EXTENSION.types[type.typeName];
    const targets = type.annotations.filter((a) => a.kind === 'extension').map((a) => a.relativePath);
    if (!declared) {
      problems.push({
        typeName: type.typeName,
        message: 'has a Fairmint OCF extension annotation but is not a declared extension type',
      });
    } else if (targets.length !== 1 || targets[0] !== declared) {
      problems.push({ typeName: type.typeName, message: `extension annotation must be exactly ${declared}` });
    }
  }
  for (const [typeName, declared] of Object.entries(DECLARED_EXTENSION.types)) {
    const found = extensionTypes.filter((t) => t.typeName === typeName);
    if (found.length !== 1) {
      problems.push({
        typeName,
        message: `declared extension type (${declared}) must be annotated exactly once; found ${found.length}`,
      });
    }
  }
  for (const message of [
    ...checkAmendedFiles(roots),
    ...checkObjectPrimitive(roots),
    ...checkExtensionRecords(roots),
  ]) {
    problems.push({ typeName: 'ocf-extension', message });
  }

  const annotated = allTypes
    .filter((t) => t.annotations.length > 0)
    .sort((a, b) => a.typeName.localeCompare(b.typeName));
  const counts = { ocf: 0, extension: 0, clean: 0, variants: 0, withProblems: 0 };
  for (const type of annotated) {
    const isExtension = type.annotations.some((a) => a.kind === 'extension');
    counts[isExtension ? 'extension' : 'ocf']++;
    let result: { problems: string[]; checked: number; variant?: boolean };
    try {
      result = checkType(type, roots);
    } catch (error) {
      result = { problems: [error instanceof Error ? error.message : String(error)], checked: 0 };
    }
    const label = `${type.typeName}${isExtension ? ' [Fairmint extension]' : ''}`;
    if (result.variant) {
      console.log(`⏭️  ${label}: variant of other types, checked through them`);
      counts.variants++;
    } else if (result.problems.length === 0) {
      const unit = type.constructors.every((c) => c.kind === 'nullary') ? 'values' : 'properties';
      console.log(`✅ ${label}: ${result.checked} ${unit} checked`);
      counts.clean++;
    } else {
      console.log(`❌ ${label} (${type.sourceFile}:${type.line}):`);
      for (const message of result.problems) console.log(`   - ${message}`);
      counts.withProblems++;
    }
  }

  if (problems.length > 0) {
    console.log('\nOther problems:');
    for (const problem of problems) console.log(`❌ ${problem.typeName}: ${problem.message}`);
  }

  console.log('\n---');
  console.log(
    `📊 Summary: ${counts.ocf} OCF types and ${counts.extension} Fairmint extension types checked, ${counts.clean} clean, ${counts.variants} variants of other types, ${counts.withProblems} with gaps, ${problems.length} other problem(s)`
  );

  if (counts.withProblems > 0 || problems.length > 0) {
    console.log('\n❌ Schema gap check failed!');
    process.exit(1);
  }
  console.log('\n✅ All DAML types match their OCF and extension schemas.');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}
