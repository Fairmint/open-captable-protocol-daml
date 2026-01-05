/**
 * Rename OCF data types to consistent <Name>OcfData pattern
 *
 * Before: OcfStakeholderData, OcfStockTransferTxData, OcfStockIssuanceData
 * After:  StakeholderOcfData, StockTransferOcfData, StockIssuanceOcfData
 *
 * Usage: tsx codegen/rename-ocf-types.ts
 */

import * as fs from "fs";
import * as path from "path";

const DAML_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "../OpenCapTable-v25/daml/Fairmint/OpenCapTable"
);

const TEST_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "../Test/daml"
);

// Files to exclude from renaming (shared types, helpers, etc.)
const EXCLUDE_FILES = new Set([
  "Types.daml",      // Shared sub-types, keep Ocf prefix
  "Helpers.daml",    // Utility functions
  "CapTable.daml",   // Generated file
]);

// Build the rename map by scanning files
function buildRenameMap(): Map<string, string> {
  const renameMap = new Map<string, string>();

  const files = fs.readdirSync(DAML_DIR)
    .filter((f) => f.endsWith(".daml"))
    .filter((f) => !EXCLUDE_FILES.has(f));

  for (const file of files) {
    const content = fs.readFileSync(path.join(DAML_DIR, file), "utf-8");

    // Find main data type definitions
    // Pattern 1: Ocf*Data or Ocf*TxData (most types)
    // Pattern 2: Ocf<Name> where <Name> matches filename (e.g., OcfDocument in Document.daml)
    const dataMatches = content.matchAll(/^data (Ocf\w+(?:Tx)?Data) =/gm);
    for (const match of dataMatches) {
      const oldName = match[1];
      // OcfStakeholderData -> StakeholderOcfData
      // OcfStockTransferTxData -> StockTransferOcfData
      let newName = oldName.replace(/^Ocf/, ""); // Remove Ocf prefix
      if (newName.endsWith("TxData")) {
        newName = newName.replace(/TxData$/, "OcfData");
      } else if (newName.endsWith("Data")) {
        newName = newName.replace(/Data$/, "OcfData");
      }

      if (oldName !== newName) {
        renameMap.set(oldName, newName);
      }
    }

    // Handle special cases like OcfDocument -> DocumentOcfData
    const fileName = file.replace(".daml", "");
    const specialMatch = content.match(new RegExp(`^data (Ocf${fileName}) = \\1`, "m"));
    if (specialMatch) {
      const oldName = specialMatch[1];
      const newName = `${fileName}OcfData`;
      if (oldName !== newName) {
        renameMap.set(oldName, newName);
      }
    }
  }

  return renameMap;
}

function renameInFile(filePath: string, renameMap: Map<string, string>): boolean {
  let content = fs.readFileSync(filePath, "utf-8");
  const original = content;

  for (const [oldName, newName] of renameMap) {
    // Replace all occurrences (type definitions, field types, imports, etc.)
    content = content.replace(new RegExp(`\\b${oldName}\\b`, "g"), newName);
  }

  if (content !== original) {
    fs.writeFileSync(filePath, content);
    return true;
  }
  return false;
}

function getAllDamlFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".daml")) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

function main() {
  console.log("Building rename map from DAML files...");
  const renameMap = buildRenameMap();

  console.log(`\nFound ${renameMap.size} types to rename:`);
  for (const [oldName, newName] of [...renameMap.entries()].sort()) {
    console.log(`  ${oldName} -> ${newName}`);
  }

  // Get all DAML files
  const damlFiles = [
    ...getAllDamlFiles(DAML_DIR),
    ...getAllDamlFiles(TEST_DIR),
  ];

  console.log(`\nProcessing ${damlFiles.length} DAML files...`);

  let modifiedCount = 0;
  for (const file of damlFiles) {
    const modified = renameInFile(file, renameMap);
    if (modified) {
      modifiedCount++;
      console.log(`  Modified: ${path.relative(process.cwd(), file)}`);
    }
  }

  console.log(`\nDone! Modified ${modifiedCount} files.`);
}

main();

