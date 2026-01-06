/**
 * CapTable Code Generator
 *
 * Generates CapTable.daml by:
 * 1. Discovering types from DAML files in OpenCapTable-v25/OCF/
 * 2. Deriving module, data_type, data_param, map_field programmatically
 * 3. Using config only for reference validations
 *
 * Usage: tsx scripts/codegen/generate-captable.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

interface Config {
  validations: Record<string, string[]>;
}

interface TypeDef {
  name: string;
  module: string;
  data_type: string;
  data_param: string;
  map_field: string;
  validations: Array<{ field: string; map: string; error: string }>;
}

const CODEGEN_DIR = path.dirname(new URL(import.meta.url).pathname);
const OPENCAPTABLE_DIR = path.join(
  CODEGEN_DIR,
  "../../OpenCapTable-v25/daml/Fairmint/OpenCapTable"
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
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/**
 * Pluralize a snake_case string
 */
function pluralize(str: string): string {
  // Words already plural (e.g., vesting_terms)
  if (str.endsWith("_terms")) return str;
  // Words ending in s, x, z, ch, sh get "es"
  if (str.endsWith("ss") || str.endsWith("x") || str.endsWith("z") ||
      str.endsWith("ch") || str.endsWith("sh")) return str + "es";
  // Words ending in consonant + y get "ies"
  if (str.endsWith("y") && !/[aeiou]y$/.test(str)) return str.slice(0, -1) + "ies";
  // Words ending in s (like stock_class) get "es"
  if (str.endsWith("s")) return str + "es";
  return str + "s";
}

/**
 * Parse a DAML file to find its main data type and field name
 */
function parseTypeInfo(filePath: string, typeName: string): { dataType: string; fieldName: string } | null {
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
 * Discover all types from DAML files in OCF/ subdirectory
 * Issuer is excluded because it's handled specially (only EditIssuer, no Add/Delete)
 */
function discoverTypes(config: Config): TypeDef[] {
  const files = fs.readdirSync(OCF_DIR)
    .filter((f) => f.endsWith(".daml") && f !== "Issuer.daml")
    .map((f) => f.replace(".daml", ""));

  const types: TypeDef[] = [];

  for (const name of files) {
    const filePath = path.join(OCF_DIR, `${name}.daml`);
    const typeInfo = parseTypeInfo(filePath, name);

    if (!typeInfo) {
      console.warn(`  Warning: No OcfData type found in ${name}.daml, skipping`);
      continue;
    }

    const snakeName = toSnakeCase(name);
    const validationFields = config.validations[name] || [];

    const typeDef: TypeDef = {
      name,
      module: `Fairmint.OpenCapTable.OCF.${name}`,
      data_type: typeInfo.dataType,
      data_param: typeInfo.fieldName,
      map_field: pluralize(snakeName),
      validations: validationFields.map((field) => ({
        field,
        map: pluralize(toSnakeCase(field.replace("_id", ""))),
        error: `${toTitleCase(field)} not found`,
      })),
    };

    types.push(typeDef);
  }

  return types.sort((a, b) => a.name.localeCompare(b.name));
}

function generateImports(types: TypeDef[]): string {
  return types
    .map((t) => `import ${t.module} (${t.name}(..), ${t.data_type})`)
    .join("\n");
}

function generateMapField(t: TypeDef): string {
  return `    ${t.map_field}: Map Text (ContractId ${t.name})`;
}

function generateValidations(
  validations: TypeDef["validations"],
  dataParam: string,
  prefix: string = ""
): string {
  if (validations.length === 0) return "";
  return validations
    .map(
      (v) =>
        `${prefix}assertMsg ("${v.error}: " <> ${dataParam}.${v.field}) (Map.lookup ${dataParam}.${v.field} ${v.map} /= None)`
    )
    .join("\n");
}

function generateCreateChoice(t: TypeDef): string {
  const validations = generateValidations(t.validations, t.data_param, "        ");
  const validationBlock = validations ? `\n${validations}\n` : "";

  return `    choice Create${t.name} : ContractId CapTable
      with
        ${t.data_param}: ${t.data_type}
      controller context.issuer
      do
        assertMsg "${t.name} ID already exists" (Map.lookup ${t.data_param}.id ${t.map_field} == None)
${validationBlock}
        _ <- createMarker context

        new_cid <- create ${t.name} with
          context = context
          ..

        create this with ${t.map_field} = Map.insert ${t.data_param}.id new_cid ${t.map_field}`;
}

function generateEditChoice(t: TypeDef): string {
  const validations = generateValidations(
    t.validations,
    `new_${t.data_param}`,
    "        "
  );
  const validationBlock = validations ? `\n${validations}\n` : "";

  return `    choice Edit${t.name} : ContractId CapTable
      with
        id: Text
        new_${t.data_param}: ${t.data_type}
      controller context.issuer
      do
        let old_cid_opt = Map.lookup id ${t.map_field}
        assertMsg "${t.name} not found" (old_cid_opt /= None)
        let Some old_cid = old_cid_opt
        assertMsg "Cannot change ${t.name} ID" (id == new_${t.data_param}.id)
${validationBlock}
        _ <- createMarker context

        archive old_cid
        new_cid <- create ${t.name} with
          context = context
          ${t.data_param} = new_${t.data_param}

        create this with ${t.map_field} = Map.insert id new_cid ${t.map_field}`;
}

function generateDeleteChoice(t: TypeDef): string {
  return `    choice Delete${t.name} : ContractId CapTable
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

function generateChoicesForType(t: TypeDef): string {
  const separator = `    -- ==========================================================================
    -- ${t.name.toUpperCase()} (Create/Edit/Delete)
    -- ==========================================================================`;

  return `${separator}

${generateCreateChoice(t)}

${generateEditChoice(t)}

${generateDeleteChoice(t)}`;
}

function generate(): void {
  console.log("Loading config...");
  const config = loadConfig();

  console.log("Discovering types from DAML files...");
  const types = discoverTypes(config);

  console.log(`  Found ${types.length} types`);

  const imports = generateImports(types);
  const mapFields = types.map(generateMapField).join("\n");
  const choices = types.map((t) => generateChoicesForType(t)).join("\n\n");

  const output = `module Fairmint.OpenCapTable.CapTable where

-- =============================================================================
-- CapTable Contract (GENERATED - DO NOT EDIT)
-- =============================================================================
-- Stateful cap table that maintains Maps of OCF objects for O(1) lookup
-- See ADR-002: Stateful Cap Table with OCF Object References
--
-- Generated by: scripts/codegen/generate-captable.ts
-- Config: scripts/codegen/captable-config.yaml
-- =============================================================================

import DA.Map (Map)
import qualified DA.Map as Map

import Fairmint.OpenCapTable.Types (Context)
import Fairmint.OpenCapTable.Helpers (createMarker)
import Fairmint.OpenCapTable.OCF.Issuer (Issuer(..), IssuerOcfData)

-- OCF Types
${imports}


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

${choices}
`;

  fs.writeFileSync(OUTPUT_PATH, output);
  console.log(`\nGenerated ${OUTPUT_PATH}`);
  console.log(`  - ${types.length} types, ${types.length * 3 + 1} choices`);
}

generate();
