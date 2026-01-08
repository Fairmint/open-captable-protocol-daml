/**
 * CapTable Code Generator (Batch Design)
 *
 * Generates CapTable.daml with a single UpdateCapTable batch choice that:
 * 1. Accepts lists of creates, edits, and deletes
 * 2. Processes creates in tier order (for intra-batch dependencies)
 * 3. Returns Text lists (OCF object IDs) for created/edited objects
 *
 * Usage: tsx scripts/codegen/generate-captable.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

interface Config {
  tiers: Record<number, string[]>;
  validations: Record<string, string[]>;
}

interface TypeDef {
  name: string;
  module: string;
  data_type: string;
  data_param: string;
  map_field: string;
  tier: number;
  validations: Array<{ field: string; map: string; error: string }>;
}

const REPO_ROOT = process.cwd();
const CODEGEN_DIR = path.join(REPO_ROOT, "scripts/codegen");
const OPENCAPTABLE_DIR = path.join(
  REPO_ROOT,
  "OpenCapTable-v25/daml/Fairmint/OpenCapTable"
);
const OCF_DIR = path.join(OPENCAPTABLE_DIR, "OCF");
const OUTPUT_PATH = path.join(OPENCAPTABLE_DIR, "CapTable.daml");

function loadConfig(): Config {
  const configPath = path.join(CODEGEN_DIR, "captable-config.yaml");
  const content = fs.readFileSync(configPath, "utf-8");
  return yaml.parse(content) as Config;
}

/**
 * Convert PascalCase to snake_case
 */
function toSnakeCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * Convert snake_case to Title Case
 * stakeholder_id -> Stakeholder
 * stock_class_id -> Stock class
 */
function toTitleCase(str: string): string {
  return str
    .replace(/_id$/, "")
    .split("_")
    .map((word, i) =>
      i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word
    )
    .join(" ");
}

/**
 * Pluralize a snake_case string
 */
function pluralize(str: string): string {
  // Words already plural (e.g., vesting_terms)
  if (str.endsWith("_terms")) return str;
  // Words ending in s, x, z, ch, sh get "es"
  if (
    str.endsWith("ss") ||
    str.endsWith("x") ||
    str.endsWith("z") ||
    str.endsWith("ch") ||
    str.endsWith("sh")
  )
    return str + "es";
  // Words ending in consonant + y get "ies"
  if (str.endsWith("y") && !/[aeiou]y$/.test(str))
    return str.slice(0, -1) + "ies";
  // Words ending in s (like stock_class) get "es"
  if (str.endsWith("s")) return str + "es";
  return str + "s";
}

/**
 * Parse a DAML file to find its main data type and field name
 */
function parseTypeInfo(
  filePath: string,
  typeName: string
): { dataType: string; fieldName: string } | null {
  const content = fs.readFileSync(filePath, "utf-8");

  const dataMatch = content.match(/^data (\w+OcfData) = \1/m);
  if (!dataMatch) return null;

  const templateRegex = new RegExp(
    `template ${typeName}\\s+with\\s+context:\\s*Context\\s+(\\w+):\\s*(\\w+OcfData)`,
    "m"
  );
  const templateMatch = content.match(templateRegex);

  if (!templateMatch) {
    const fieldRegex = new RegExp(`(\\w+):\\s*${dataMatch[1]}`, "m");
    const fieldMatch = content.match(fieldRegex);
    if (fieldMatch) {
      return { dataType: dataMatch[1], fieldName: fieldMatch[1] };
    }
    return null;
  }

  return { dataType: templateMatch[2], fieldName: templateMatch[1] };
}

/**
 * Build a map from type name to tier number
 */
function buildTierMap(config: Config): Map<string, number> {
  const tierMap = new Map<string, number>();
  for (const [tier, types] of Object.entries(config.tiers)) {
    for (const typeName of types) {
      tierMap.set(typeName, parseInt(tier));
    }
  }
  return tierMap;
}

/**
 * Discover all types from DAML files in OCF/ subdirectory
 * Issuer is excluded because it's handled specially (only EditIssuer, no Add/Delete)
 */
function discoverTypes(config: Config): TypeDef[] {
  const files = fs
    .readdirSync(OCF_DIR)
    .filter((f) => f.endsWith(".daml") && f !== "Issuer.daml")
    .map((f) => f.replace(".daml", ""));

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
    const validationFields = config.validations[name] || [];

    const typeDef: TypeDef = {
      name,
      module: `Fairmint.OpenCapTable.OCF.${name}`,
      data_type: typeInfo.dataType,
      data_param: typeInfo.fieldName,
      map_field: pluralize(snakeName),
      tier,
      validations: validationFields.map((field) => ({
        field,
        map: pluralize(toSnakeCase(field.replace("_id", ""))),
        error: `${toTitleCase(field)} not found`,
      })),
    };

    types.push(typeDef);
  }

  // Sort by tier, then alphabetically within tier
  return types.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.name.localeCompare(b.name);
  });
}

function generateImports(types: TypeDef[]): string {
  // Sort alphabetically for imports
  const sortedTypes = [...types].sort((a, b) => a.name.localeCompare(b.name));
  return sortedTypes
    .map((t) => `import ${t.module} (${t.name}(..), ${t.data_type})`)
    .join("\n");
}

function generateMapField(t: TypeDef): string {
  return `    ${t.map_field}: Map Text (ContractId ${t.name})`;
}

/**
 * Generate the OcfCreateData sum type
 */
function generateOcfCreateData(types: TypeDef[]): string {
  const first = types[0];
  const rest = types.slice(1);
  const firstConstructor = `  = OcfCreate${first.name} ${first.data_type}`;
  const restConstructors = rest
    .map((t) => `  | OcfCreate${t.name} ${t.data_type}`)
    .join("\n");

  return `-- | Sum type for all OCF data that can be created in a batch
data OcfCreateData
${firstConstructor}
${restConstructors}
  deriving (Eq, Show)`;
}

/**
 * Generate the OcfEditData sum type
 * Uses the OCF data type directly since it contains the ID field
 */
function generateOcfEditData(types: TypeDef[]): string {
  const first = types[0];
  const rest = types.slice(1);
  const firstConstructor = `  = OcfEdit${first.name} ${first.data_type}`;
  const restConstructors = rest
    .map((t) => `  | OcfEdit${t.name} ${t.data_type}`)
    .join("\n");

  return `-- | Sum type for edits (uses OCF data directly - ID is in the data record)
data OcfEditData
${firstConstructor}
${restConstructors}
  deriving (Eq, Show)`;
}

/**
 * Generate the OcfObjectId sum type (for delete operations)
 */
function generateOcfObjectId(types: TypeDef[]): string {
  const first = types[0];
  const rest = types.slice(1);
  const firstConstructor = `  = Ocf${first.name}Id Text`;
  const restConstructors = rest
    .map((t) => `  | Ocf${t.name}Id Text`)
    .join("\n");

  return `-- | Sum type for object identifiers (tagged with type for delete operations)
data OcfObjectId
${firstConstructor}
${restConstructors}
  deriving (Eq, Show)`;
}

/**
 * Generate validation code for a single type
 */
function generateValidationCode(
  t: TypeDef,
  dataVar: string,
  mapsPrefix: string
): string {
  if (t.validations.length === 0) return "";
  return t.validations
    .map(
      (v) =>
        `        assertMsg ("${v.error}: " <> ${dataVar}.${v.field}) (Map.lookup ${dataVar}.${v.field} ${mapsPrefix}${v.map} /= None)`
    )
    .join("\n");
}

/**
 * Generate a create case for a single type in processCreate
 */
function generateCreateCase(t: TypeDef): string {
  const validations = generateValidationCode(t, "d", "maps.");
  const validationBlock = validations ? `\n${validations}` : "";

  return `      OcfCreate${t.name} d -> do
        assertMsg "${t.name} ID already exists" (Map.lookup d.id maps.${t.map_field} == None)${validationBlock}
        cid <- create ${t.name} with context = ctx, ${t.data_param} = d
        let newMaps = maps with ${t.map_field} = Map.insert d.id cid maps.${t.map_field}
        pure (newMaps, d.id)`;
}

/**
 * Generate an edit case for a single type in processEdit
 */
function generateEditCase(t: TypeDef): string {
  const validations = generateValidationCode(t, "d", "maps.");
  const validationBlock = validations ? `\n${validations}` : "";

  return `      OcfEdit${t.name} d -> do
        let oldCidOpt = Map.lookup d.id maps.${t.map_field}
        assertMsg "${t.name} not found" (oldCidOpt /= None)
        let Some oldCid = oldCidOpt${validationBlock}
        archive oldCid
        newCid <- create ${t.name} with context = ctx, ${t.data_param} = d
        let newMaps = maps with ${t.map_field} = Map.insert d.id newCid maps.${t.map_field}
        pure (newMaps, d.id)`;
}

/**
 * Generate a delete case for a single type in processDelete
 */
function generateDeleteCase(t: TypeDef): string {
  return `      Ocf${t.name}Id delId -> do
        let oldCidOpt = Map.lookup delId maps.${t.map_field}
        assertMsg "${t.name} not found" (oldCidOpt /= None)
        let Some oldCid = oldCidOpt
        archive oldCid
        pure (maps with ${t.map_field} = Map.delete delId maps.${t.map_field})`;
}

/**
 * Generate the CapTableMaps record type
 */
function generateCapTableMapsRecord(types: TypeDef[]): string {
  const fields = types
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `    ${t.map_field}: Map Text (ContractId ${t.name})`)
    .join("\n");

  return `-- | Internal record type for passing maps through batch processing
data CapTableMaps = CapTableMaps with
${fields}
  deriving (Eq, Show)`;
}

/**
 * Generate helper to convert CapTable to CapTableMaps
 */
function generateToMaps(types: TypeDef[]): string {
  const fields = types
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `      ${t.map_field} = ct.${t.map_field}`)
    .join("\n");

  return `-- | Extract maps from CapTable for processing
toMaps : CapTable -> CapTableMaps
toMaps ct = CapTableMaps with
${fields}`;
}

/**
 * Generate the processCreate function
 */
function generateProcessCreate(types: TypeDef[]): string {
  // Group types by tier
  const tierGroups = new Map<number, TypeDef[]>();
  for (const t of types) {
    const group = tierGroups.get(t.tier) || [];
    group.push(t);
    tierGroups.set(t.tier, group);
  }

  // Generate cases for all types (sorted by tier for processing order)
  const sortedTypes = [...types].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.name.localeCompare(b.name);
  });

  const cases = sortedTypes.map((t) => generateCreateCase(t)).join("\n");

  return `-- | Process a single create operation, returning updated maps and the created object's ID
processCreate : Context -> CapTableMaps -> OcfCreateData -> Update (CapTableMaps, Text)
processCreate ctx maps createData = case createData of
${cases}`;
}

/**
 * Generate the processEdit function
 */
function generateProcessEdit(types: TypeDef[]): string {
  const sortedTypes = [...types].sort((a, b) => a.name.localeCompare(b.name));
  const cases = sortedTypes.map((t) => generateEditCase(t)).join("\n");

  return `-- | Process a single edit operation, returning updated maps and the edited object's ID
processEdit : Context -> CapTableMaps -> OcfEditData -> Update (CapTableMaps, Text)
processEdit ctx maps editData = case editData of
${cases}`;
}

/**
 * Generate the processDelete function
 */
function generateProcessDelete(types: TypeDef[]): string {
  const sortedTypes = [...types].sort((a, b) => a.name.localeCompare(b.name));
  const cases = sortedTypes.map((t) => generateDeleteCase(t)).join("\n");

  return `-- | Process a single delete operation, returning updated maps
processDelete : CapTableMaps -> OcfObjectId -> Update CapTableMaps
processDelete maps objId = case objId of
${cases}`;
}

/**
 * Generate helper to get tier from OcfCreateData
 */
function generateGetCreateTier(types: TypeDef[]): string {
  const cases = types
    .map((t) => `  OcfCreate${t.name} _ -> ${t.tier}`)
    .join("\n");

  return `-- | Get the processing tier for a create operation
getCreateTier : OcfCreateData -> Int
getCreateTier createData = case createData of
${cases}`;
}

/**
 * Generate backward-compatible individual Create choice for a type
 * These directly implement the logic (not wrapping UpdateCapTable) to avoid double-consumption
 */
function generateLegacyCreateChoice(t: TypeDef): string {
  const validations = generateValidationCode(t, t.data_param, "");
  const validationBlock = validations ? `\n${validations}\n` : "";

  return `    -- | Legacy choice for backward compatibility
    choice Create${t.name} : ContractId CapTable
      with
        ${t.data_param}: ${t.data_type}
      controller context.issuer
      do
        assertMsg "${t.name} ID already exists" (Map.lookup ${t.data_param}.id ${t.map_field} == None)${validationBlock}
        _ <- createMarker context

        new_cid <- create ${t.name} with
          context = context
          ..

        create this with ${t.map_field} = Map.insert ${t.data_param}.id new_cid ${t.map_field}`;
}

/**
 * Generate backward-compatible individual Edit choice for a type
 */
function generateLegacyEditChoice(t: TypeDef): string {
  const validations = generateValidationCode(t, `new_${t.data_param}`, "");
  const validationBlock = validations ? `\n${validations}\n` : "";

  return `    -- | Legacy choice for backward compatibility
    choice Edit${t.name} : ContractId CapTable
      with
        id: Text
        new_${t.data_param}: ${t.data_type}
      controller context.issuer
      do
        let old_cid_opt = Map.lookup id ${t.map_field}
        assertMsg "${t.name} not found" (old_cid_opt /= None)
        let Some old_cid = old_cid_opt
        assertMsg "Cannot change ${t.name} ID" (id == new_${t.data_param}.id)${validationBlock}
        _ <- createMarker context

        archive old_cid
        new_cid <- create ${t.name} with
          context = context
          ${t.data_param} = new_${t.data_param}

        create this with ${t.map_field} = Map.insert id new_cid ${t.map_field}`;
}

/**
 * Generate backward-compatible individual Delete choice for a type
 */
function generateLegacyDeleteChoice(t: TypeDef): string {
  return `    -- | Legacy choice for backward compatibility
    choice Delete${t.name} : ContractId CapTable
      with
        id: Text
      controller context.issuer
      do
        let old_cid_opt = Map.lookup id ${t.map_field}
        assertMsg "${t.name} not found" (old_cid_opt /= None)
        let Some old_cid = old_cid_opt

        _ <- createMarker context

        archive old_cid
        create this with ${t.map_field} = Map.delete id ${t.map_field}`;
}

/**
 * Generate all legacy choices for a type
 */
function generateLegacyChoices(t: TypeDef): string {
  return `${generateLegacyCreateChoice(t)}

${generateLegacyEditChoice(t)}

${generateLegacyDeleteChoice(t)}`;
}

/**
 * Generate the UpdateCapTable choice
 */
function generateUpdateCapTableChoice(types: TypeDef[]): string {
  const mapWithFields = types
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `          ${t.map_field} = finalMaps.${t.map_field}`)
    .join("\n");

  return `    -- ==========================================================================
    -- BATCH UPDATE (Create/Edit/Delete multiple objects in one transaction)
    -- ==========================================================================

    choice UpdateCapTable : UpdateCapTableResult
      with
        creates: [OcfCreateData]
        edits: [OcfEditData]
        deletes: [OcfObjectId]
      controller context.issuer
      do
        -- Create marker for this update
        _ <- createMarker context

        -- Start with current maps
        let initialMaps = toMaps this

        -- Sort creates by tier for dependency ordering
        let sortedCreates = sortOn getCreateTier creates

        -- Process creates in tier order
        (mapsAfterCreates, createdIds) <- foldlA
          (\\(maps, ids) createData -> do
            (newMaps, objId) <- processCreate context maps createData
            pure (newMaps, ids ++ [objId]))
          (initialMaps, [])
          sortedCreates

        -- Process edits
        (mapsAfterEdits, editedIds) <- foldlA
          (\\(maps, ids) editData -> do
            (newMaps, objId) <- processEdit context maps editData
            pure (newMaps, ids ++ [objId]))
          (mapsAfterCreates, [])
          edits

        -- Process deletes
        finalMaps <- foldlA
          (\\maps deleteRef -> processDelete maps deleteRef)
          mapsAfterEdits
          deletes

        -- Create new CapTable with updated maps
        newCapTableCid <- create this with
${mapWithFields}

        pure UpdateCapTableResult with
          updatedCapTableCid = newCapTableCid
          createdIds = createdIds
          editedIds = editedIds`;
}

function generate(): void {
  console.log("Loading config...");
  const config = loadConfig();

  console.log("Discovering types from DAML files...");
  const types = discoverTypes(config);

  console.log(`  Found ${types.length} types`);

  // Verify all types are in tiers
  const allTierTypes = Object.values(config.tiers).flat();
  const missingFromTiers = types.filter(
    (t) => !allTierTypes.includes(t.name)
  );
  if (missingFromTiers.length > 0) {
    console.error(
      `  ERROR: Types not in any tier: ${missingFromTiers.map((t) => t.name).join(", ")}`
    );
    process.exit(1);
  }

  const imports = generateImports(types);
  const mapFields = types
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(generateMapField)
    .join("\n");
  const ocfCreateData = generateOcfCreateData(types);
  const ocfEditData = generateOcfEditData(types);
  const ocfObjectId = generateOcfObjectId(types);
  const capTableMapsRecord = generateCapTableMapsRecord(types);
  const toMaps = generateToMaps(types);
  const getCreateTier = generateGetCreateTier(types);
  const processCreate = generateProcessCreate(types);
  const processEdit = generateProcessEdit(types);
  const processDelete = generateProcessDelete(types);
  const updateCapTableChoice = generateUpdateCapTableChoice(types);
  const legacyChoices = types
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `    -- ==========================================================================
    -- ${t.name.toUpperCase()} (Legacy individual choices for backward compatibility)
    -- ==========================================================================

${generateLegacyChoices(t)}`)
    .join("\n\n");

  const output = `module Fairmint.OpenCapTable.CapTable where

-- =============================================================================
-- CapTable Contract (GENERATED - DO NOT EDIT)
-- =============================================================================
-- Stateful cap table with batch UpdateCapTable choice for efficient bulk updates.
-- See ADR-002: Stateful Cap Table with OCF Object References
--
-- Generated by: scripts/codegen/generate-captable.ts
-- Config: scripts/codegen/captable-config.yaml
-- =============================================================================

import DA.Map (Map)
import qualified DA.Map as Map
import DA.List (sortOn)
import DA.Action (foldlA)

import Fairmint.OpenCapTable.Types (Context)
import Fairmint.OpenCapTable.Helpers (createMarker)
import Fairmint.OpenCapTable.OCF.Issuer (Issuer(..), IssuerOcfData)

-- OCF Types
${imports}


-- =============================================================================
-- Batch Operation Types
-- =============================================================================

${ocfCreateData}

${ocfEditData}

${ocfObjectId}

-- | Result of batch UpdateCapTable operation
-- Returns OCF object IDs (Text) for created/edited objects - caller can look up ContractIds in the new CapTable maps
data UpdateCapTableResult = UpdateCapTableResult with
    updatedCapTableCid: ContractId CapTable
    createdIds: [Text]
    editedIds: [Text]
  deriving (Eq, Show)


-- =============================================================================
-- Internal Helper Types and Functions
-- =============================================================================

${capTableMapsRecord}

${toMaps}

${getCreateTier}

${processCreate}

${processEdit}

${processDelete}


-- =============================================================================
-- CapTable Template
-- =============================================================================

template CapTable
  with
    context: Context

    -- Issuer (exactly 1, edit only - no create/delete)
    issuer: ContractId Issuer

    -- OCF object/transaction maps
${mapFields}

  where
    signatory context.issuer, context.system_operator

    -- ==========================================================================
    -- ISSUER (Edit only - no Create/Delete)
    -- ==========================================================================

    choice EditIssuer : ContractId CapTable
      with
        new_issuer_data: IssuerOcfData
      controller context.issuer
      do
        old_issuer <- fetch issuer
        assertMsg "Cannot change issuer ID" (old_issuer.issuer_data.id == new_issuer_data.id)

        _ <- createMarker context

        archive issuer
        new_issuer_cid <- create Issuer with
          context = context
          issuer_data = new_issuer_data

        create this with issuer = new_issuer_cid

${updateCapTableChoice}

${legacyChoices}
`;

  fs.writeFileSync(OUTPUT_PATH, output);
  console.log(`\nGenerated ${OUTPUT_PATH}`);
  console.log(`  - ${types.length} types`);
  console.log(`  - ${2 + types.length * 3} choices (EditIssuer, UpdateCapTable + ${types.length * 3} legacy)`);
  console.log(`  - Batch operations with ${Math.max(...Object.keys(config.tiers).map(Number))} processing tiers`);
}

generate();
