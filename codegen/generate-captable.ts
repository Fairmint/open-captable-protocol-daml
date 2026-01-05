/**
 * CapTable Code Generator
 *
 * Generates the CapTable.daml file from captable-types.yaml
 * This avoids maintaining ~2700 lines of repetitive DAML code by hand.
 *
 * Usage: tsx codegen/generate-captable.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

interface Validation {
  field: string;
  map: string;
  error: string;
}

interface TypeDef {
  name: string;
  module: string;
  data_type: string;
  data_param: string;
  map_field: string;
  validations?: Validation[];
}

interface Config {
  objects: TypeDef[];
  transactions: TypeDef[];
}

const CODEGEN_DIR = path.dirname(new URL(import.meta.url).pathname);
const OUTPUT_PATH = path.join(
  CODEGEN_DIR,
  "../OpenCapTable-v25/daml/Fairmint/OpenCapTable/CapTable.daml"
);

function loadConfig(): Config {
  const configPath = path.join(CODEGEN_DIR, "captable-types.yaml");
  const content = fs.readFileSync(configPath, "utf-8");
  return yaml.parse(content) as Config;
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
  validations: Validation[] | undefined,
  dataParam: string,
  prefix: string = ""
): string {
  if (!validations || validations.length === 0) return "";
  return validations
    .map(
      (v) =>
        `${prefix}assertMsg "${v.error}" (Map.lookup ${dataParam}.${v.field} ${v.map} /= None)`
    )
    .join("\n");
}

function generateAddChoice(t: TypeDef): string {
  const validations = generateValidations(
    t.validations,
    t.data_param,
    "        "
  );
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

function generateChoicesForType(t: TypeDef, category: string): string {
  const separator = `    -- ==========================================================================
    -- ${t.name.toUpperCase()} (Add/Edit/Delete)
    -- ==========================================================================`;

  return `${separator}

${generateAddChoice(t)}

${generateEditChoice(t)}

${generateDeleteChoice(t)}`;
}

function generate(): void {
  const config = loadConfig();
  const allTypes = [...config.objects, ...config.transactions];

  // Generate imports
  const imports = generateImports(allTypes);

  // Generate map fields
  const objectMapFields = config.objects.map(generateMapField).join("\n");
  const transactionMapFields = config.transactions
    .map(generateMapField)
    .join("\n");

  // Generate choices
  const objectChoices = config.objects
    .map((t) => generateChoicesForType(t, "Object"))
    .join("\n\n");

  const transactionChoices = config.transactions
    .map((t) => generateChoicesForType(t, "Transaction"))
    .join("\n\n");

  const output = `module Fairmint.OpenCapTable.CapTable where

-- =============================================================================
-- CapTable Contract (GENERATED - DO NOT EDIT)
-- =============================================================================
-- Stateful cap table that maintains Maps of OCF objects for O(1) lookup
-- See ADR-002: Stateful Cap Table with OCF Object References
--
-- Generated by: codegen/generate-captable.ts
-- Source: codegen/captable-types.yaml
-- =============================================================================

import DA.Map (Map)
import qualified DA.Map as Map

import Fairmint.OpenCapTable.Types (Context)
import Fairmint.OpenCapTable.Helpers (createMarker)
import Fairmint.OpenCapTable.Issuer (Issuer(..), OcfIssuerData)

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
        new_issuer_data: OcfIssuerData
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
  console.log(`Generated ${OUTPUT_PATH}`);
  console.log(
    `  - ${config.objects.length} object types (${config.objects.length * 3} choices)`
  );
  console.log(
    `  - ${config.transactions.length} transaction types (${config.transactions.length * 3} choices)`
  );
  console.log(
    `  - Total: ${allTypes.length} types, ${allTypes.length * 3 + 1} choices`
  );
}

generate();

