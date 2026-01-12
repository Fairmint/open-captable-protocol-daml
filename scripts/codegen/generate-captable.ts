/**
 * CapTable Code Generator (Batch Design)
 *
 * Generates CapTable.daml with the UpdateCapTable batch choice that:
 * 1. Accepts lists of creates, edits, and deletes
 * 2. Processes creates in tier order (for intra-batch dependencies)
 * 3. Returns Text lists (OCF object IDs) for created/edited objects
 *
 * Uses Handlebars templates for maintainable, reviewable contract structure.
 *
 * Usage: tsx scripts/codegen/generate-captable.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import Handlebars from "handlebars";

interface Config {
  tiers: Record<number, string[]>;
  validations: Record<string, string[]>;
}

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
  tier: number;
  validations: Validation[];
}

const REPO_ROOT = process.cwd();
const CODEGEN_DIR = path.join(REPO_ROOT, "scripts/codegen");
const TEMPLATES_DIR = path.join(CODEGEN_DIR, "templates");
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

  return types;
}

/**
 * Read a template file with clear error handling
 */
function readTemplateFile(relativePath: string): string {
  const fullPath = path.join(TEMPLATES_DIR, relativePath);
  try {
    return fs.readFileSync(fullPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`  ERROR: Template file not found: ${fullPath}`);
      console.error(`  Run from repository root: scripts/codegen/templates/`);
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Load and compile the main template, registering partials
 */
function loadTemplate(): HandlebarsTemplateDelegate {
  // Load loop templates as partials
  const createCase = readTemplateFile("loops/create-case.daml");
  const editCase = readTemplateFile("loops/edit-case.daml");
  const deleteCase = readTemplateFile("loops/delete-case.daml");

  Handlebars.registerPartial("create-case", createCase);
  Handlebars.registerPartial("edit-case", editCase);
  Handlebars.registerPartial("delete-case", deleteCase);

  // Load and compile main template
  const mainTemplate = readTemplateFile("CapTable.daml.template");

  return Handlebars.compile(mainTemplate, { noEscape: true });
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

  console.log("Loading templates...");
  const template = loadTemplate();

  // Prepare sorted type arrays for template
  // Alphabetically sorted (for most sections)
  const types_alpha = [...types].sort((a, b) => a.name.localeCompare(b.name));

  // Tier-then-alphabetically sorted (for processCreate)
  const types_tier = [...types].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.name.localeCompare(b.name);
  });

  console.log("Rendering template...");
  const output = template({
    types_alpha,
    types_tier,
  });

  fs.writeFileSync(OUTPUT_PATH, output);
  console.log(`\nGenerated ${OUTPUT_PATH}`);
  console.log(`  - ${types.length} types`);
  console.log(`  - 2 choices (EditIssuer, UpdateCapTable)`);
  console.log(
    `  - Batch operations with ${Math.max(...Object.keys(config.tiers).map(Number))} processing tiers`
  );
}

generate();
