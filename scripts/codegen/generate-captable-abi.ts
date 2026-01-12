/**
 * CapTable ABI Generator
 *
 * Generates a minimal, human-readable artifact showing the public interfaces
 * of the cap table contracts. This makes it easy to:
 * - Review what operations are available
 * - Track changes to the interface over time
 * - Understand the contract API without reading implementation details
 *
 * Usage: tsx scripts/codegen/generate-captable-abi.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

const REPO_ROOT = process.cwd();
const OPENCAPTABLE_DIR = path.join(
  REPO_ROOT,
  "OpenCapTable-v25/daml/Fairmint/OpenCapTable"
);
const OCF_DIR = path.join(OPENCAPTABLE_DIR, "OCF");
const CONFIG_PATH = path.join(REPO_ROOT, "scripts/codegen/captable-config.yaml");
const OUTPUT_PATH = path.join(REPO_ROOT, "generated/captable-abi.json");

interface Config {
  tiers: Record<number, string[]>;
  validations: Record<string, string[]>;
}

interface ChoiceABI {
  name: string;
  controller: string;
  consuming: boolean;
  parameters: Record<string, string>;
  returns: string;
}

interface TemplateABI {
  name: string;
  module: string;
  signatories: string[];
  observers: string[];
  fields: Record<string, string>;
  choices: ChoiceABI[];
}

interface DataTypeABI {
  name: string;
  module: string;
  kind: "record" | "sum";
  fields?: Record<string, string>;
  constructors?: Record<string, string>;
}

interface ABI {
  version: string;
  description: string;
  templates: TemplateABI[];
  dataTypes: DataTypeABI[];
  ocfTypes: string[];
}

function loadConfig(): Config {
  const content = fs.readFileSync(CONFIG_PATH, "utf-8");
  return yaml.parse(content) as Config;
}

/**
 * Extract template info from DAML file content
 */
function parseTemplate(content: string, moduleName: string): TemplateABI | null {
  // Match template declaration - more flexible pattern
  const templateMatch = content.match(/template\s+(\w+)\s+with\s+([\s\S]*?)\s+where\s+([\s\S]*?)(?=\ntemplate\s|$)/);
  if (!templateMatch) return null;

  const name = templateMatch[1];
  const fieldsBlock = templateMatch[2];
  const bodyBlock = templateMatch[3];

  // Parse fields
  const fields: Record<string, string> = {};
  const fieldRegex = /^\s*(\w+)\s*:\s*(.+?)$/gm;
  let fieldMatch;
  while ((fieldMatch = fieldRegex.exec(fieldsBlock)) !== null) {
    const fieldName = fieldMatch[1];
    const fieldType = fieldMatch[2].trim();
    fields[fieldName] = simplifyType(fieldType);
  }

  // Parse signatories
  const signatoriesMatch = bodyBlock.match(/signatory\s+(.+?)(?=\n|$)/);
  const signatories = signatoriesMatch
    ? signatoriesMatch[1].split(",").map((s) => s.trim())
    : [];

  // Parse observers
  const observersMatch = bodyBlock.match(/observer\s+(.+?)(?=\n|$)/);
  const observers = observersMatch
    ? observersMatch[1].split(",").map((s) => s.trim())
    : [];

  // Parse choices - handle various DAML choice patterns
  const choices: ChoiceABI[] = [];

  // Find all choice declarations using a simpler approach
  // Match: [nonconsuming] choice Name : ReturnType (including generic types like ContractId Foo)
  const choiceHeaderRegex = /(nonconsuming\s+)?choice\s+(\w+)\s*:\s*((?:ContractId\s+\w+|\(\)|\w+))/g;
  let headerMatch;
  while ((headerMatch = choiceHeaderRegex.exec(bodyBlock)) !== null) {
    const isNonconsuming = !!headerMatch[1];
    const choiceName = headerMatch[2];
    const returnType = headerMatch[3];

    // Find the controller for this choice (search after the choice header)
    const afterChoice = bodyBlock.substring(headerMatch.index);
    const controllerMatch = afterChoice.match(/controller\s+(\S+)/);
    if (!controllerMatch) continue;

    const controller = controllerMatch[1];

    // Find parameters if there's a "with" block before controller
    const parameters: Record<string, string> = {};
    const withMatch = afterChoice.match(/with\s+([\s\S]*?)controller/);
    if (withMatch) {
      const paramsBlock = withMatch[1];
      const paramRegex = /^\s*(\w+)\s*:\s*(.+?)$/gm;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(paramsBlock)) !== null) {
        parameters[paramMatch[1]] = simplifyType(paramMatch[2].trim());
      }
    }

    // Skip if already added (shouldn't happen but just in case)
    if (choices.some((c) => c.name === choiceName)) continue;

    choices.push({
      name: choiceName,
      controller: controller,
      consuming: !isNonconsuming,
      parameters,
      returns: simplifyType(returnType),
    });
  }

  return {
    name,
    module: moduleName,
    signatories,
    observers,
    fields,
    choices: choices.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Simplify DAML types for readability
 */
function simplifyType(type: string): string {
  // Remove line continuations and extra whitespace
  return type
    .replace(/\s+/g, " ")
    .replace(/Map Text \(ContractId (\w+)\)/g, "Map<Text, ContractId<$1>>")
    .replace(/ContractId (\w+)/g, "ContractId<$1>")
    .replace(/Optional (\w+)/g, "Optional<$1>")
    .replace(/\[(\w+)\]/g, "[$1]")
    .trim();
}

/**
 * Parse data type from DAML content
 */
function parseDataType(
  content: string,
  typeName: string,
  moduleName: string
): DataTypeABI | null {
  // Match record data type
  const recordMatch = content.match(
    new RegExp(`data\\s+${typeName}\\s*=\\s*${typeName}\\s+with\\s+([\\s\\S]*?)deriving`, "m")
  );
  if (recordMatch) {
    const fields: Record<string, string> = {};
    const fieldRegex = /^\s*(\w+)\s*:\s*(.+?)$/gm;
    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(recordMatch[1])) !== null) {
      fields[fieldMatch[1]] = simplifyType(fieldMatch[2].trim());
    }
    return { name: typeName, module: moduleName, kind: "record", fields };
  }

  // Match sum type
  const sumMatch = content.match(
    new RegExp(`data\\s+${typeName}\\s*([\\s\\S]*?)deriving`, "m")
  );
  if (sumMatch && sumMatch[1].includes("|")) {
    const constructors: Record<string, string> = {};
    const constructorLines = sumMatch[1].split(/[|=]/).filter((s) => s.trim());
    for (const line of constructorLines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 1) {
        const ctorName = parts[0];
        const ctorType = parts.slice(1).join(" ") || "()";
        constructors[ctorName] = simplifyType(ctorType);
      }
    }
    return { name: typeName, module: moduleName, kind: "sum", constructors };
  }

  return null;
}

/**
 * Get all OCF type names from the config
 */
function getOcfTypes(config: Config): string[] {
  const types: string[] = [];
  for (const tierTypes of Object.values(config.tiers)) {
    types.push(...tierTypes);
  }
  return types.sort();
}

function generate(): void {
  console.log("Generating CapTable ABI...");

  const config = loadConfig();
  const templates: TemplateABI[] = [];
  const dataTypes: DataTypeABI[] = [];

  // Parse OcpFactory
  const factoryPath = path.join(OPENCAPTABLE_DIR, "OcpFactory.daml");
  if (fs.existsSync(factoryPath)) {
    const content = fs.readFileSync(factoryPath, "utf-8");
    const template = parseTemplate(content, "Fairmint.OpenCapTable.OcpFactory");
    if (template) templates.push(template);
  }

  // Parse IssuerAuthorization
  const authPath = path.join(OPENCAPTABLE_DIR, "IssuerAuthorization.daml");
  if (fs.existsSync(authPath)) {
    const content = fs.readFileSync(authPath, "utf-8");
    const template = parseTemplate(
      content,
      "Fairmint.OpenCapTable.IssuerAuthorization"
    );
    if (template) templates.push(template);
  }

  // Parse CapTable (simplified - extract key info manually since it's complex)
  const capTablePath = path.join(OPENCAPTABLE_DIR, "CapTable.daml");
  if (fs.existsSync(capTablePath)) {
    const content = fs.readFileSync(capTablePath, "utf-8");

    // Extract batch operation data types
    const createDataType = parseDataType(
      content,
      "OcfCreateData",
      "Fairmint.OpenCapTable.CapTable"
    );
    if (createDataType) dataTypes.push(createDataType);

    const editDataType = parseDataType(
      content,
      "OcfEditData",
      "Fairmint.OpenCapTable.CapTable"
    );
    if (editDataType) dataTypes.push(editDataType);

    const objectIdType = parseDataType(
      content,
      "OcfObjectId",
      "Fairmint.OpenCapTable.CapTable"
    );
    if (objectIdType) dataTypes.push(objectIdType);

    const resultType = parseDataType(
      content,
      "UpdateCapTableResult",
      "Fairmint.OpenCapTable.CapTable"
    );
    if (resultType) dataTypes.push(resultType);

    // Build CapTable template ABI manually for clarity
    const ocfTypes = getOcfTypes(config);
    const mapFields: Record<string, string> = {
      context: "Context",
      issuer: "ContractId<Issuer>",
    };

    // Add all OCF type map fields
    for (const typeName of ocfTypes) {
      const snakeName = typeName.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
      const pluralName = pluralize(snakeName);
      mapFields[pluralName] = `Map<Text, ContractId<${typeName}>>`;
    }

    templates.push({
      name: "CapTable",
      module: "Fairmint.OpenCapTable.CapTable",
      signatories: ["context.issuer", "context.system_operator"],
      observers: [],
      fields: mapFields,
      choices: [
        {
          name: "EditIssuer",
          controller: "context.issuer",
          consuming: true,
          parameters: { new_issuer_data: "IssuerOcfData" },
          returns: "ContractId<CapTable>",
        },
        {
          name: "UpdateCapTable",
          controller: "context.issuer",
          consuming: true,
          parameters: {
            creates: "[OcfCreateData]",
            edits: "[OcfEditData]",
            deletes: "[OcfObjectId]",
          },
          returns: "UpdateCapTableResult",
        },
      ],
    });
  }

  // Parse Issuer template
  const issuerPath = path.join(OCF_DIR, "Issuer.daml");
  if (fs.existsSync(issuerPath)) {
    const content = fs.readFileSync(issuerPath, "utf-8");
    const template = parseTemplate(
      content,
      "Fairmint.OpenCapTable.OCF.Issuer"
    );
    if (template) templates.push(template);

    // Also extract IssuerOcfData
    const issuerDataType = parseDataType(
      content,
      "IssuerOcfData",
      "Fairmint.OpenCapTable.OCF.Issuer"
    );
    if (issuerDataType) dataTypes.push(issuerDataType);
  }

  // Get list of OCF types
  const ocfTypes = getOcfTypes(config);

  // Build the ABI (no timestamp for deterministic output)
  const abi: ABI = {
    version: "1.0.0",
    description:
      "Public interface definitions for the Open Cap Table Protocol DAML contracts. " +
      "Auto-generated by: npm run codegen:abi",
    templates: templates.sort((a, b) => a.name.localeCompare(b.name)),
    dataTypes: dataTypes.sort((a, b) => a.name.localeCompare(b.name)),
    ocfTypes,
  };

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write JSON output
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(abi, null, 2) + "\n");

  console.log(`Generated ${OUTPUT_PATH}`);
  console.log(`  - ${templates.length} templates`);
  console.log(`  - ${dataTypes.length} data types`);
  console.log(`  - ${ocfTypes.length} OCF types`);
}

function pluralize(str: string): string {
  if (str.endsWith("_terms")) return str;
  if (
    str.endsWith("ss") ||
    str.endsWith("x") ||
    str.endsWith("z") ||
    str.endsWith("ch") ||
    str.endsWith("sh")
  )
    return str + "es";
  if (str.endsWith("y") && !/[aeiou]y$/.test(str))
    return str.slice(0, -1) + "ies";
  if (str.endsWith("s")) return str + "es";
  return str + "s";
}

generate();
