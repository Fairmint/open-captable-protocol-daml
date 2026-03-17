/**
 * CI schema gap checker.
 *
 * Compares DAML record types against OCF JSON schemas and reports any fields present in OCF but missing from DAML. Uses
 * a hardcoded mapping of DAML type name → OCF schema file path(s) and computes the UNION of all OCF schema properties
 * for each mapping.
 *
 * Usage: npx tsx scripts/schema-gap-checker/check-schema-gaps.ts --ocf-schema-dir <path>
 */

import * as fs from 'fs';
import * as path from 'path';

import { getErrorMessage } from '../types';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { ocfSchemaDir: string } {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--ocf-schema-dir');
  if (idx === -1 || idx + 1 >= args.length) {
    console.error('Usage: npx tsx scripts/schema-gap-checker/check-schema-gaps.ts --ocf-schema-dir <path>');
    process.exit(1);
  }
  const raw = args[idx + 1];
  const resolved = path.resolve(raw);
  if (!fs.existsSync(resolved)) {
    console.error(`OCF schema directory not found: ${resolved}`);
    process.exit(1);
  }
  return { ocfSchemaDir: resolved };
}

// ---------------------------------------------------------------------------
// DAML type → OCF schema mapping
// ---------------------------------------------------------------------------

const DAML_TO_OCF_MAP: Record<string, string[]> = {
  // Main entity types
  IssuerOcfData: ['objects/Issuer.schema.json'],
  StockClassOcfData: ['objects/StockClass.schema.json'],
  StockPlanOcfData: ['objects/StockPlan.schema.json'],
  StakeholderOcfData: ['objects/Stakeholder.schema.json'],
  ValuationOcfData: ['objects/Valuation.schema.json'],
  VestingTermsOcfData: ['objects/VestingTerms.schema.json'],
  DocumentOcfData: ['objects/Document.schema.json'],
  StockLegendTemplateOcfData: ['objects/StockLegendTemplate.schema.json'],
  // Issuances
  StockIssuanceOcfData: ['objects/transactions/issuance/StockIssuance.schema.json'],
  ConvertibleIssuanceOcfData: ['objects/transactions/issuance/ConvertibleIssuance.schema.json'],
  WarrantIssuanceOcfData: ['objects/transactions/issuance/WarrantIssuance.schema.json'],
  EquityCompensationIssuanceOcfData: ['objects/transactions/issuance/EquityCompensationIssuance.schema.json'],
  // Sub-types: conversion triggers
  OcfConversionTrigger: [
    'types/conversion_triggers/AutomaticConversionOnConditionTrigger.schema.json',
    'types/conversion_triggers/AutomaticConversionOnDateTrigger.schema.json',
    'types/conversion_triggers/ElectiveConversionAtWillTrigger.schema.json',
    'types/conversion_triggers/ElectiveConversionInDateRangeTrigger.schema.json',
    'types/conversion_triggers/ElectiveConversionOnConditionTrigger.schema.json',
    'types/conversion_triggers/UnspecifiedConversionTrigger.schema.json',
  ],
  OcfConvertibleConversionTrigger: [
    'types/conversion_triggers/AutomaticConversionOnConditionTrigger.schema.json',
    'types/conversion_triggers/AutomaticConversionOnDateTrigger.schema.json',
    'types/conversion_triggers/ElectiveConversionAtWillTrigger.schema.json',
    'types/conversion_triggers/ElectiveConversionInDateRangeTrigger.schema.json',
    'types/conversion_triggers/ElectiveConversionOnConditionTrigger.schema.json',
    'types/conversion_triggers/UnspecifiedConversionTrigger.schema.json',
  ],
  // Sub-types: conversion mechanisms
  OcfSAFEConversionMechanism: ['types/conversion_mechanisms/SAFEConversionMechanism.schema.json'],
  OcfNoteConversionMechanism: ['types/conversion_mechanisms/NoteConversionMechanism.schema.json'],
  OcfRatioConversionMechanism: ['types/conversion_mechanisms/RatioConversionMechanism.schema.json'],
  OcfCustomConversionMechanism: ['types/conversion_mechanisms/CustomConversionMechanism.schema.json'],
  OcfFixedAmountConversionMechanism: ['types/conversion_mechanisms/FixedAmountConversionMechanism.schema.json'],
  OcfPercentCapitalizationConversionMechanism: [
    'types/conversion_mechanisms/PercentCapitalizationConversionMechanism.schema.json',
  ],
  OcfSharePriceBasedConversionMechanism: ['types/conversion_mechanisms/SharePriceBasedConversionMechanism.schema.json'],
  OcfValuationBasedConversionMechanism: ['types/conversion_mechanisms/ValuationBasedConversionMechanism.schema.json'],
  // Sub-types: conversion rights
  OcfConvertibleConversionRight: ['types/conversion_rights/ConvertibleConversionRight.schema.json'],
  OcfWarrantConversionRight: ['types/conversion_rights/WarrantConversionRight.schema.json'],
  OcfStockClassConversionRight: ['types/conversion_rights/StockClassConversionRight.schema.json'],
};

// ---------------------------------------------------------------------------
// Intentional omissions allowlist
// ---------------------------------------------------------------------------

const ALLOWED_GAPS: Record<string, string[]> = {
  // Deprecated OCF fields handled by SDK normalization
  StakeholderOcfData: ['current_relationship'],
  StockPlanOcfData: ['stock_class_id'],
  EquityCompensationIssuanceOcfData: ['option_grant_type'],
  // object_type is not stored in DAML records (it's the template discriminant)
  '*': ['object_type'],
  // Conversion mechanism `type` is the sum-type constructor in DAML, not a record field.
  // E.g. OcfConvMechSAFE wraps OcfSAFEConversionMechanism — the constructor IS the discriminant.
  OcfSAFEConversionMechanism: ['type'],
  OcfNoteConversionMechanism: ['type'],
  OcfRatioConversionMechanism: ['type'],
  OcfCustomConversionMechanism: ['type'],
  OcfFixedAmountConversionMechanism: ['type'],
  OcfPercentCapitalizationConversionMechanism: ['type'],
  OcfSharePriceBasedConversionMechanism: ['type'],
  OcfValuationBasedConversionMechanism: ['type'],
};

function isAllowedGap(damlType: string, field: string): boolean {
  if ('*' in ALLOWED_GAPS && ALLOWED_GAPS['*'].includes(field)) return true;
  if (damlType in ALLOWED_GAPS && ALLOWED_GAPS[damlType].includes(field)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// OCF schema parsing (with allOf $ref resolution)
// ---------------------------------------------------------------------------

const OCF_URL_PREFIX = 'https://raw.githubusercontent.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF/main/schema/';

interface JsonSchema {
  properties?: Record<string, unknown>;
  allOf?: Array<{ $ref?: string; properties?: Record<string, unknown> }>;
}

function resolveRefToLocal(ref: string, schemaDir: string): string | null {
  if (!ref.startsWith(OCF_URL_PREFIX)) return null;
  const relative = ref.slice(OCF_URL_PREFIX.length);
  return path.join(schemaDir, relative);
}

function collectOcfProperties(schemaPath: string, schemaDir: string, visited: Set<string> = new Set()): Set<string> {
  if (visited.has(schemaPath)) return new Set();
  visited.add(schemaPath);

  if (!fs.existsSync(schemaPath)) {
    console.warn(`  ⚠ Schema file not found: ${schemaPath}`);
    return new Set();
  }

  const schema: JsonSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const props = new Set<string>();

  // Collect own properties
  if (schema.properties) {
    for (const key of Object.keys(schema.properties)) {
      props.add(key);
    }
  }

  // Resolve allOf $ref to collect parent properties
  if (schema.allOf) {
    for (const entry of schema.allOf) {
      if (entry.$ref) {
        const localPath = resolveRefToLocal(entry.$ref, schemaDir);
        if (localPath) {
          for (const p of collectOcfProperties(localPath, schemaDir, visited)) {
            props.add(p);
          }
        }
      }
      if (entry.properties) {
        for (const key of Object.keys(entry.properties)) {
          props.add(key);
        }
      }
    }
  }

  return props;
}

// ---------------------------------------------------------------------------
// DAML parsing — extract record fields from `data` blocks
// ---------------------------------------------------------------------------

const DAML_DIR = path.join(__dirname, '../../OpenCapTable-v32/daml/Fairmint/OpenCapTable');

/**
 * Extract record field names from a DAML `data` block.
 *
 * Matches patterns like: data TypeName = TypeName with fieldName: SomeType otherField: Optional Text
 */
function parseDamlRecordFields(content: string, typeName: string): Set<string> | null {
  // Match "data TypeName = TypeName" followed by "with" and field lines
  const dataBlockRegex = new RegExp(
    `data\\s+${escapeRegex(typeName)}\\s*=\\s*${escapeRegex(typeName)}\\s*\\n\\s*with\\b`,
    'm'
  );
  const match = dataBlockRegex.exec(content);
  if (!match) return null;

  const fields = new Set<string>();
  const afterWith = content.slice(match.index + match[0].length);
  const lines = afterWith.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Stop at `deriving`, next `data` block, `template`, or blank non-comment line followed by non-field
    if (trimmed.startsWith('deriving ') || trimmed.startsWith('data ') || trimmed.startsWith('template ')) break;
    // Skip comments and section headers
    if (trimmed === '' || trimmed.startsWith('--')) continue;

    // Match field: "fieldName: Type" or "fieldName : Type"
    const fieldMatch = trimmed.match(/^([a-z_][a-z0-9_]*)\s*:\s*.+/i);
    if (fieldMatch) {
      fields.add(fieldMatch[1]);
    }
  }

  return fields.size > 0 ? fields : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findDamlFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findDamlFiles(fullPath));
    } else if (entry.name.endsWith('.daml')) {
      files.push(fullPath);
    }
  }
  return files;
}

function loadAllDamlSources(): string {
  const damlFiles = findDamlFiles(DAML_DIR);
  return damlFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

// ---------------------------------------------------------------------------
// Field name normalization (DAML `type_` → OCF `type`)
// ---------------------------------------------------------------------------

function normalizeDamlField(field: string): string {
  if (field === 'type_') return 'type';
  return field;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Gap {
  damlType: string;
  field: string;
  fromSchema: string;
}

function main(): void {
  const { ocfSchemaDir } = parseArgs();

  console.log('🔍 Checking DAML ↔ OCF schema field gaps...\n');
  console.log(`   OCF schema dir: ${ocfSchemaDir}`);
  console.log(`   DAML source dir: ${DAML_DIR}\n`);

  const allDaml = loadAllDamlSources();
  const gaps: Gap[] = [];
  let checkedCount = 0;

  for (const [damlType, schemaPaths] of Object.entries(DAML_TO_OCF_MAP)) {
    // Parse DAML fields
    const damlFields = parseDamlRecordFields(allDaml, damlType);
    if (!damlFields) {
      console.warn(`⚠ DAML type "${damlType}" not found in source files — skipping`);
      continue;
    }

    const normalizedDamlFields = new Set([...damlFields].map(normalizeDamlField));

    // Collect union of OCF properties across all mapped schemas
    const ocfProperties = new Set<string>();
    const fieldSourceMap = new Map<string, string>();

    for (const relPath of schemaPaths) {
      const schemaPath = path.join(ocfSchemaDir, relPath);
      const props = collectOcfProperties(schemaPath, ocfSchemaDir);
      for (const p of props) {
        ocfProperties.add(p);
        if (!fieldSourceMap.has(p)) {
          fieldSourceMap.set(p, relPath);
        }
      }
    }

    // Compare: find OCF properties missing from DAML
    for (const ocfField of ocfProperties) {
      if (normalizedDamlFields.has(ocfField)) continue;
      if (isAllowedGap(damlType, ocfField)) continue;

      gaps.push({
        damlType,
        field: ocfField,
        fromSchema: fieldSourceMap.get(ocfField) ?? schemaPaths[0],
      });
    }

    checkedCount++;
  }

  // Report
  console.log(`📊 Checked ${checkedCount} DAML types against OCF schemas.\n`);

  if (gaps.length === 0) {
    console.log('✅ No schema gaps found. All OCF fields are present in DAML records.');
    process.exit(0);
  }

  console.error(`❌ Found ${gaps.length} schema gap(s):\n`);
  for (const gap of gaps) {
    console.error(`  [${gap.damlType}] missing field "${gap.field}" (from ${gap.fromSchema})`);
  }
  console.error('');
  console.error('To fix: add the missing fields to the DAML record types,');
  console.error('or add them to ALLOWED_GAPS if the omission is intentional.\n');
  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error('Fatal error:', getErrorMessage(error));
  process.exit(1);
}
