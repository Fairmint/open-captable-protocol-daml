/**
 * CapTable Code Generator (Batch Design)
 *
 * Generates CapTable.daml with the UpdateCapTable batch choice that:
 *
 * 1. Accepts lists of creates, edits, and deletes
 * 2. Processes creates in tier order (for intra-batch dependencies)
 * 3. Returns Text lists (OCF object IDs) for created/edited objects
 *
 * Uses Handlebars templates for maintainable, reviewable contract structure.
 *
 * Usage: tsx scripts/codegen/generate-captable.ts
 */

import * as fs from 'fs';
import Handlebars from 'handlebars';
import * as path from 'path';
import * as yaml from 'yaml';

interface Config {
  tiers: Record<number, string[]>;
  validations: Record<string, string[]>;
  // Types that write into the stock class named by their stock_class_id (root guard)
  position_class_writes?: string[];
}

interface Validation {
  field: string;
  map: string;
  error: string;
  // For OR-based lookups across multiple maps
  or_maps?: boolean;
  firstMap?: string;
  secondMap?: string;
  thirdMap?: string;
  // For array field validation (validates each element in the array)
  is_array?: boolean;
  // For Optional Text reference fields
  is_optional?: boolean;
}

// Maps issuance type names to their security_id index map names
const SECURITY_ID_INDEX_MAPS: Record<string, string> = {
  ConvertibleIssuance: 'convertible_issuances_by_security_id',
  EquityCompensationIssuance: 'equity_compensation_issuances_by_security_id',
  StockIssuance: 'stock_issuances_by_security_id',
  WarrantIssuance: 'warrant_issuances_by_security_id',
};

// The security_id index map of stock issuances: the stock securities the root guard checks
const STOCK_SECURITY_MAP = 'stock_issuances_by_security_id';

const OBJECT_TYPE_CONSTRUCTOR_OVERRIDES: Record<string, string> = {
  StakeholderRelationshipChangeEvent: 'OcfObjCeStakeholderRelationship',
  StakeholderStatusChangeEvent: 'OcfObjCeStakeholderStatus',
};

// One version of a root record as the position guard sees it (validatePositionManagedWrites)
interface PositionGuard {
  // Name of the generated Daml function, e.g. stockTransferRefs
  fn: string;
  // Record label in guard errors, e.g. "stock transfer"
  label: string;
  // Daml expression for the stock class the record writes into
  writes_into: string;
  // Daml expression for the stock securities the record names
  security_ids: string;
}

interface TypeDef {
  name: string;
  module: string;
  data_type: string;
  data_param: string;
  map_field: string;
  tier: number;
  validations: Validation[];
  // Types introduced after v0.0.2 must be appended to upgrade-sensitive records and variants.
  is_upgrade_append: boolean;
  has_validations: boolean;
  validates_issuer_id_reference: boolean;
  is_document: boolean;
  object_type_constructor: string;
  // For issuance types, the name of the security_id index map (e.g., 'stock_issuances_by_security_id')
  security_id_index_map: string | null;
  // Root guard for position-managed classes; null when the type names no stock security and writes into no class
  position_guard: PositionGuard | null;
}

const REPO_ROOT = process.cwd();
const CODEGEN_DIR = path.join(REPO_ROOT, 'scripts/codegen');
const TEMPLATES_DIR = path.join(CODEGEN_DIR, 'templates');
const OPENCAPTABLE_DIR = path.join(REPO_ROOT, 'OpenCapTable-v34/daml/Fairmint/OpenCapTable');
const OCF_DIR = path.join(OPENCAPTABLE_DIR, 'OCF');
const OUTPUT_PATH = path.join(OPENCAPTABLE_DIR, 'CapTable.daml');

function loadConfig(): Config {
  const configPath = path.join(CODEGEN_DIR, 'captable-config.yaml');
  const content = fs.readFileSync(configPath, 'utf-8');
  return yaml.parse(content) as Config;
}

/** Convert PascalCase to snake_case */
function toSnakeCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

/** Convert snake_case to Title Case stakeholder_id -> Stakeholder stock_class_id -> Stock class */
function toTitleCase(str: string): string {
  return str
    .replace(/_id$/, '')
    .split('_')
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** Pluralize a snake_case string */
function pluralize(str: string): string {
  // Words already plural (e.g., vesting_terms)
  if (str.endsWith('_terms')) return str;
  // Words ending in s, x, z, ch, sh get "es"
  if (str.endsWith('ss') || str.endsWith('x') || str.endsWith('z') || str.endsWith('ch') || str.endsWith('sh'))
    return `${str}es`;
  // Words ending in consonant + y get "ies"
  if (str.endsWith('y') && !/[aeiou]y$/.test(str)) return `${str.slice(0, -1)}ies`;
  // Words ending in s (like stock_class) get "es"
  if (str.endsWith('s')) return `${str}es`;
  return `${str}s`;
}

function objectTypeConstructor(name: string): string {
  if (OBJECT_TYPE_CONSTRUCTOR_OVERRIDES[name]) return OBJECT_TYPE_CONSTRUCTOR_OVERRIDES[name];
  if (
    /^(Convertible|EquityCompensation|Stock|Warrant).*(Acceptance|Cancellation|Conversion|Exercise|Issuance|Release|Repricing|Retraction|Transfer|Consolidation|Repurchase|Reissuance)$/.test(
      name
    ) ||
    name.startsWith('IssuerAuthorizedSharesAdjustment') ||
    name.startsWith('StockClassAuthorizedSharesAdjustment') ||
    name.startsWith('StockClassConversionRatioAdjustment') ||
    name.startsWith('StockClassSplit') ||
    name.startsWith('StockPlanPoolAdjustment') ||
    name.startsWith('StockPlanReturnToPool') ||
    name === 'VestingAcceleration' ||
    name === 'VestingEvent' ||
    name === 'VestingStart'
  ) {
    return `OcfObjTx${name}`;
  }
  return `OcfObj${name}`;
}

/** Parse a DAML file to find its main data type and field name */
function parseTypeInfo(filePath: string, typeName: string): { dataType: string; fieldName: string } | null {
  const content = fs.readFileSync(filePath, 'utf-8');

  const dataMatch = content.match(/^data (\w+OcfData) = \1/m);
  if (!dataMatch) return null;

  const templateRegex = new RegExp(
    `template ${typeName}\\s+with\\s+context:\\s*Context\\s+(\\w+):\\s*(\\w+OcfData)`,
    'm'
  );
  const templateMatch = content.match(templateRegex);

  if (!templateMatch) {
    const fieldRegex = new RegExp(`(\\w+):\\s*${dataMatch[1]}`, 'm');
    const fieldMatch = content.match(fieldRegex);
    if (fieldMatch) {
      return { dataType: dataMatch[1], fieldName: fieldMatch[1] };
    }
    return null;
  }

  return { dataType: templateMatch[2], fieldName: templateMatch[1] };
}

/** Build a map from type name to tier number */
function buildTierMap(config: Config): Map<string, number> {
  const tierMap = new Map<string, number>();
  for (const [tier, types] of Object.entries(config.tiers)) {
    for (const typeName of types) {
      tierMap.set(typeName, parseInt(tier, 10));
    }
  }
  return tierMap;
}

interface SecurityIdsPart {
  expr: string;
  singleton: boolean;
}

/** Render the parts as one Daml list: x :: rest for a singleton, xs ++ rest for a list, [] for none */
function renderSecurityIds(parts: SecurityIdsPart[]): string {
  if (parts.length === 0) return '[]';
  const [first, ...rest] = parts;
  if (rest.length === 0) return first.singleton ? `[${first.expr}]` : first.expr;
  return `${first.expr} ${first.singleton ? '::' : '++'} ${renderSecurityIds(rest)}`;
}

/**
 * The root guard of a type: the stock securities its validations check against stock_issuances_by_security_id (a stock
 * issuance also names its own security_id) and, for position_class_writes, the stock class it writes into.
 */
function positionGuard(name: string, validations: Validation[], config: Config): PositionGuard | null {
  const parts: SecurityIdsPart[] = [];
  if (SECURITY_ID_INDEX_MAPS[name] === STOCK_SECURITY_MAP) parts.push({ expr: 'd.security_id', singleton: true });
  for (const v of validations) {
    const maps = v.or_maps ? [v.firstMap, v.secondMap, v.thirdMap] : [v.map];
    if (!maps.includes(STOCK_SECURITY_MAP)) continue;
    if (v.is_array) parts.push({ expr: `d.${v.field}`, singleton: false });
    else if (v.is_optional) parts.push({ expr: `optionalToList d.${v.field}`, singleton: false });
    else parts.push({ expr: `d.${v.field}`, singleton: true });
  }
  const writes = (config.position_class_writes ?? []).includes(name);
  if (parts.length === 0 && !writes) return null;
  return {
    fn: `${name.charAt(0).toLowerCase()}${name.slice(1)}Refs`,
    label: name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(),
    writes_into: writes ? 'Some d.stock_class_id' : 'None',
    security_ids: renderSecurityIds(parts),
  };
}

/**
 * Discover all types from DAML files in OCF/ subdirectory. Issuer is excluded because it's handled specially - it's
 * edit-only (no create/delete) and stored as a single reference, not in a map. Issuer edits are handled via
 * OcfEditIssuer in the UpdateCapTable batch operation.
 */
function discoverTypes(config: Config): TypeDef[] {
  const files = fs
    .readdirSync(OCF_DIR)
    .filter((f) => f.endsWith('.daml') && f !== 'Issuer.daml')
    .map((f) => f.replace('.daml', ''));

  const tierMap = buildTierMap(config);
  const types: TypeDef[] = [];

  for (const name of files) {
    const filePath = path.join(OCF_DIR, `${name}.daml`);
    const typeInfo = parseTypeInfo(filePath, name);

    if (!typeInfo) {
      console.warn(`  Warning: No OcfData type found in ${name}.daml, skipping`);
      continue;
    }

    const tier = tierMap.get(name);
    if (tier === undefined) {
      console.error(`  ERROR: ${name} not found in any tier in config`);
      process.exit(1);
    }

    const snakeName = toSnakeCase(name);
    const validationFields = config.validations[name] ?? [];

    const typeDef: Omit<TypeDef, 'position_guard'> = {
      name,
      module: `Fairmint.OpenCapTable.OCF.${name}`,
      data_type: typeInfo.dataType,
      data_param: typeInfo.fieldName,
      map_field: pluralize(snakeName),
      tier,
      validations: validationFields.map((fieldSpec) => {
        // Support five formats:
        // - Simple: "stakeholder_id" -> field: stakeholder_id, map: stakeholders (auto-derived)
        // - Explicit: "security_id:stock_issuances_by_security_id" -> field: security_id, map: stock_issuances_by_security_id
        // - OR-based: "security_id:map1|map2|map3" -> field: security_id, checks all three maps with OR logic
        // - Array: "security_ids[]:stock_issuances_by_security_id" -> field: security_ids, validates each element in array
        // - Optional: "stock_plan_id?:stock_plans" -> field: stock_plan_id, validates only when Some
        if (fieldSpec.includes(':')) {
          const parts = fieldSpec.split(':');
          let field = parts[0];
          const mapSpec = parts[1];
          // Check for optional syntax (e.g., "stock_plan_id?")
          const is_optional = field.endsWith('?');
          if (is_optional) {
            field = field.slice(0, -1); // Remove ? suffix
          }
          // Check for array syntax (e.g., "security_ids[]")
          const is_array = field.endsWith('[]');
          if (is_array) {
            field = field.slice(0, -2); // Remove [] suffix
          }
          const error = field.includes('security_id') ? 'Security not found' : `${toTitleCase(field)} not found`;
          // Check for OR-based multiple maps (e.g., "map1|map2|map3")
          if (mapSpec.includes('|')) {
            const maps = mapSpec.split('|');
            if (maps.length !== 3) {
              console.error(
                `  ERROR: OR-based validation for "${field}" in "${name}" must specify exactly 3 maps, got ${maps.length}: "${mapSpec}"`
              );
              process.exit(1);
            }
            return {
              field,
              map: maps[0], // Default map (not used when or_maps is true)
              error,
              or_maps: true,
              firstMap: maps[0],
              secondMap: maps[1],
              thirdMap: maps[2],
              is_array,
              is_optional,
            };
          }
          return {
            field,
            map: mapSpec,
            error,
            is_array,
            is_optional,
          };
        }
        return {
          field: fieldSpec,
          map: pluralize(toSnakeCase(fieldSpec.replace('_id', ''))),
          error: `${toTitleCase(fieldSpec)} not found`,
        };
      }),
      // Financing is the first type absent from the v0.0.2 baseline. Add every future post-v0.0.2 type here so its
      // constructors and Optional map stay appended instead of being inserted by alphabetical codegen ordering.
      is_upgrade_append: name === 'Financing',
      has_validations: validationFields.length > 0,
      validates_issuer_id_reference: name === 'IssuerAuthorizedSharesAdjustment',
      is_document: name === 'Document',
      object_type_constructor: objectTypeConstructor(name),
      security_id_index_map: SECURITY_ID_INDEX_MAPS[name] ?? null,
    };

    types.push({ ...typeDef, position_guard: positionGuard(name, typeDef.validations, config) });
  }

  return types;
}

/** Read a template file with clear error handling */
function readTemplateFile(relativePath: string): string {
  const fullPath = path.join(TEMPLATES_DIR, relativePath);
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(`  ERROR: Template file not found: ${fullPath}`);
      console.error(`  Run from repository root: scripts/codegen/templates/`);
      process.exit(1);
    }
    throw error;
  }
}

/** Load and compile the main template, registering partials */
function loadTemplate(): HandlebarsTemplateDelegate {
  // Load loop templates as partials
  const createCase = readTemplateFile('loops/create-case.daml');
  const editCase = readTemplateFile('loops/edit-case.daml');
  const deleteCase = readTemplateFile('loops/delete-case.daml');

  Handlebars.registerPartial('create-case', createCase);
  Handlebars.registerPartial('edit-case', editCase);
  Handlebars.registerPartial('delete-case', deleteCase);

  // Load and compile main template
  const mainTemplate = readTemplateFile('CapTable.daml.template');

  return Handlebars.compile(mainTemplate, { noEscape: true });
}

function generate(): void {
  console.log('Loading config...');
  const config = loadConfig();

  console.log('Discovering types from DAML files...');
  const types = discoverTypes(config);

  console.log(`  Found ${types.length} types`);

  // Verify all types are in tiers
  const allTierTypes = Object.values(config.tiers).flat();
  const missingFromTiers = types.filter((t) => !allTierTypes.includes(t.name));
  if (missingFromTiers.length > 0) {
    console.error(`  ERROR: Types not in any tier: ${missingFromTiers.map((t) => t.name).join(', ')}`);
    process.exit(1);
  }

  const unknownClassWrites = (config.position_class_writes ?? []).filter((n) => !types.some((t) => t.name === n));
  if (unknownClassWrites.length > 0) {
    console.error(`  ERROR: position_class_writes names unknown types: ${unknownClassWrites.join(', ')}`);
    process.exit(1);
  }
  // The root guard reads every guarded type's root map directly, so none may be an Optional (appended) map
  const appendedGuards = types.filter((t) => t.position_guard && t.is_upgrade_append);
  if (appendedGuards.length > 0) {
    console.error(
      `  ERROR: Root-guarded types must not be upgrade-appended (Optional root map): ${appendedGuards.map((t) => t.name).join(', ')}`
    );
    process.exit(1);
  }

  console.log('Loading templates...');
  const template = loadTemplate();

  // Prepare sorted type arrays for template
  // Alphabetically sorted (for most sections)
  const types_alpha = [...types].sort((a, b) => a.name.localeCompare(b.name));

  // DAML upgrades preserve constructor and record-field order. Keep the v0.0.2 surface stable and append types that
  // were added later, even when that differs from alphabetical order.
  const types_existing = types_alpha.filter((type) => !type.is_upgrade_append);
  const types_appended = types_alpha.filter((type) => type.is_upgrade_append);

  // Tier-then-alphabetically sorted (for processCreate)
  const types_tier = [...types].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.name.localeCompare(b.name);
  });

  console.log('Rendering template...');
  const output = template({
    types_alpha,
    types_existing,
    types_appended,
    types_tier,
  });

  fs.writeFileSync(OUTPUT_PATH, output);
  console.log(`\nGenerated ${OUTPUT_PATH}`);
  console.log(`  - ${types.length} types (+ Issuer as edit-only)`);
  console.log(`  - 1 choice (UpdateCapTable) - handles all creates, edits (including Issuer), deletes`);
  console.log(`  - Batch operations with ${Math.max(...Object.keys(config.tiers).map(Number))} processing tiers`);
}

generate();
