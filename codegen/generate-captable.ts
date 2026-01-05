/**
 * CapTable Code Generator
 *
 * Generates CapTable.daml by:
 * 1. Discovering types from DAML files in OpenCapTable-v25/
 * 2. Deriving module, data_type, data_param, map_field programmatically
 * 3. Using config only for: excluded files, object vs transaction, validations
 *
 * Usage: tsx codegen/generate-captable.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

interface Config {
  exclude: string[];
  objects: string[];
  validations: Record<string, Record<string, string>>;
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
const DAML_DIR = path.join(
  CODEGEN_DIR,
  "../OpenCapTable-v25/daml/Fairmint/OpenCapTable"
);
const OUTPUT_PATH = path.join(DAML_DIR, "CapTable.daml");

function loadConfig(): Config {
  const configPath = path.join(CODEGEN_DIR, "captable-config.yaml");
  const content = fs.readFileSync(configPath, "utf-8");
  return yaml.parse(content) as Config;
}

/**
 * Convert PascalCase to snake_case
 * StockClass -> stock_class
 * EquityCompensationIssuance -> equity_compensation_issuance
 */
function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

/**
 * Pluralize a snake_case string
 * stakeholder -> stakeholders
 * stock_class -> stock_classes
 */
function pluralize(str: string): string {
  if (str.endsWith("s")) return str + "es";
  if (str.endsWith("y")) return str.slice(0, -1) + "ies";
  return str + "s";
}

/**
 * Parse a DAML file to find its main data type and field name
 * Returns { dataType, fieldName } or null
 */
function parseTypeInfo(filePath: string, typeName: string): { dataType: string; fieldName: string } | null {
  const content = fs.readFileSync(filePath, "utf-8");

  // Look for: data <Name>OcfData = <Name>OcfData
  const dataMatch = content.match(/^data (\w+OcfData) = \1/m);
  if (!dataMatch) return null;

  // Look for field name in template definition
  // template TypeName with context: Context <fieldName>: <DataType>
  const templateRegex = new RegExp(
    `template ${typeName}\\s+with\\s+context:\\s*Context\\s+(\\w+):\\s*(\\w+OcfData)`,
    "m"
  );
  const templateMatch = content.match(templateRegex);

  if (!templateMatch) {
    // Fallback: try to find any field with the OcfData type
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
 * Discover all types from DAML files
 */
function discoverTypes(config: Config): { objects: TypeDef[]; transactions: TypeDef[] } {
  const excludeSet = new Set(config.exclude);
  const objectSet = new Set(config.objects);

  const files = fs.readdirSync(DAML_DIR)
    .filter((f) => f.endsWith(".daml"))
    .filter((f) => !excludeSet.has(f.replace(".daml", "")))
    .map((f) => f.replace(".daml", ""));

  const objects: TypeDef[] = [];
  const transactions: TypeDef[] = [];

  for (const name of files) {
    const filePath = path.join(DAML_DIR, `${name}.daml`);
    const typeInfo = parseTypeInfo(filePath, name);

    if (!typeInfo) {
      console.warn(`  Warning: No OcfData type found in ${name}.daml, skipping`);
      continue;
    }

    const snakeName = toSnakeCase(name);
    const validationConfig = config.validations[name] || {};

    const typeDef: TypeDef = {
      name,
      module: `Fairmint.OpenCapTable.${name}`,
      data_type: typeInfo.dataType,
      data_param: typeInfo.fieldName,
      map_field: pluralize(snakeName),
      validations: Object.entries(validationConfig).map(([field, error]) => ({
        field,
        map: pluralize(toSnakeCase(field.replace("_id", ""))),
        error,
      })),
    };

    if (objectSet.has(name)) {
      objects.push(typeDef);
    } else {
      transactions.push(typeDef);
    }
  }

  // Sort alphabetically for consistent output
  objects.sort((a, b) => a.name.localeCompare(b.name));
  transactions.sort((a, b) => a.name.localeCompare(b.name));

  return { objects, transactions };
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
        `${prefix}assertMsg "${v.error}" (Map.lookup ${dataParam}.${v.field} ${v.map} /= None)`
    )
    .join("\n");
}

function generateAddChoice(t: TypeDef): string {
  const validations = generateValidations(t.validations, t.data_param, "        ");
  const validationBlock = validations ? `\n${validations}\n` : "";

  return `    choice Add${t.name} : ContractId CapTable
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
    -- ${t.name.toUpperCase()} (Add/Edit/Delete)
    -- ==========================================================================`;

  return `${separator}

${generateAddChoice(t)}

${generateEditChoice(t)}

${generateDeleteChoice(t)}`;
}

function generate(): void {
  console.log("Loading config...");
  const config = loadConfig();

  console.log("Discovering types from DAML files...");
  const { objects, transactions } = discoverTypes(config);
  const allTypes = [...objects, ...transactions];

  console.log(`  Found ${objects.length} objects, ${transactions.length} transactions`);

  // Generate imports
  const imports = generateImports(allTypes);

  // Generate map fields
  const objectMapFields = objects.map(generateMapField).join("\n");
  const transactionMapFields = transactions.map(generateMapField).join("\n");

  // Generate choices
  const objectChoices = objects
    .map((t) => generateChoicesForType(t))
    .join("\n\n");

  const transactionChoices = transactions
    .map((t) => generateChoicesForType(t))
    .join("\n\n");

  const output = `module Fairmint.OpenCapTable.CapTable where

-- =============================================================================
-- CapTable Contract (GENERATED - DO NOT EDIT)
-- =============================================================================
-- Stateful cap table that maintains Maps of OCF objects for O(1) lookup
-- See ADR-002: Stateful Cap Table with OCF Object References
--
-- Generated by: codegen/generate-captable.ts
-- Config: codegen/captable-config.yaml
-- =============================================================================

import DA.Map (Map)
import qualified DA.Map as Map

import Fairmint.OpenCapTable.Types (Context)
import Fairmint.OpenCapTable.Helpers (createMarker)
import Fairmint.OpenCapTable.Issuer (Issuer(..), IssuerOcfData)

-- OCF Objects and Transactions
${imports}


template CapTable
  with
    context: Context

    -- Issuer (exactly 1, edit only - no add/delete)
    issuer: ContractId Issuer

    -- Objects
${objectMapFields}

    -- Transactions
${transactionMapFields}

  where
    signatory context.issuer, context.system_operator

    -- ==========================================================================
    -- ISSUER (Edit only - no Add/Delete)
    -- ==========================================================================

    choice EditIssuer : ContractId CapTable
      with
        new_issuer_data: IssuerOcfData
      controller context.issuer
      do
        -- Fetch current issuer to validate ID hasn't changed
        old_issuer <- fetch issuer
        assertMsg "Cannot change issuer ID" (old_issuer.issuer_data.id == new_issuer_data.id)

        _ <- createMarker context

        -- Archive old and create new
        archive issuer
        new_issuer_cid <- create Issuer with
          context = context
          issuer_data = new_issuer_data

        create this with issuer = new_issuer_cid

${objectChoices}

${transactionChoices}
`;

  fs.writeFileSync(OUTPUT_PATH, output);
  console.log(`\nGenerated ${OUTPUT_PATH}`);
  console.log(`  - ${objects.length} object types (${objects.length * 3} choices)`);
  console.log(`  - ${transactions.length} transaction types (${transactions.length * 3} choices)`);
  console.log(`  - Total: ${allTypes.length} types, ${allTypes.length * 3 + 1} choices`);
}

generate();
