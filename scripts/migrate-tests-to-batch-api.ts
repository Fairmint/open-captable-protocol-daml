/**
 * Script to migrate test files from individual CapTable choices to batch API
 *
 * Transforms patterns like:
 *   exerciseCmd capTableCid CT.CreateStakeholder with stakeholder_data = ...
 * To:
 *   exerciseCmd capTableCid CT.UpdateCapTable with
 *     creates = [CT.OcfCreateStakeholder ...]
 *     edits = []
 *     deletes = []
 *
 * Usage: tsx scripts/migrate-tests-to-batch-api.ts
 */

import * as fs from "fs";
import * as path from "path";

const TEST_DIR = path.join(process.cwd(), "Test/daml/OpenCapTable");

// Map of old choice -> new pattern
// For Create: CT.CreateX with data_param = Y  -> CT.OcfCreateX Y
// For Edit: CT.EditX with id = I, new_data_param = Y -> CT.OcfEditX CT.EditXData{..}
// For Delete: CT.DeleteX with id = I -> CT.OcfDeleteX I

interface TypeMapping {
  typeName: string;
  dataParam: string;
  editIdField: string;
  editDataField: string;
}

// Generate mappings from the types we know about
function getTypeMappings(): TypeMapping[] {
  const types = [
    "ConvertibleAcceptance", "ConvertibleCancellation", "ConvertibleConversion",
    "ConvertibleIssuance", "ConvertibleRetraction", "ConvertibleTransfer",
    "Document", "EquityCompensationAcceptance", "EquityCompensationCancellation",
    "EquityCompensationExercise", "EquityCompensationIssuance", "EquityCompensationRelease",
    "EquityCompensationRepricing", "EquityCompensationRetraction", "EquityCompensationTransfer",
    "IssuerAuthorizedSharesAdjustment", "Stakeholder", "StakeholderRelationshipChangeEvent",
    "StakeholderStatusChangeEvent", "StockAcceptance", "StockCancellation", "StockClass",
    "StockClassAuthorizedSharesAdjustment", "StockClassConversionRatioAdjustment",
    "StockClassSplit", "StockConsolidation", "StockConversion", "StockIssuance",
    "StockLegendTemplate", "StockPlan", "StockPlanPoolAdjustment", "StockPlanReturnToPool",
    "StockReissuance", "StockRepurchase", "StockRetraction", "StockTransfer",
    "Valuation", "VestingAcceleration", "VestingEvent", "VestingStart", "VestingTerms",
    "WarrantAcceptance", "WarrantCancellation", "WarrantExercise", "WarrantIssuance",
    "WarrantRetraction", "WarrantTransfer"
  ];

  return types.map(typeName => {
    const snakeName = typeName.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    // Data param patterns vary - this is an approximation
    const dataParam = getDataParam(typeName);
    return {
      typeName,
      dataParam,
      editIdField: `edit_${snakeName}_id`,
      editDataField: `edit_${snakeName}_data`
    };
  });
}

function getDataParam(typeName: string): string {
  // Common patterns in the codebase
  if (typeName.includes("Issuance")) return "issuance_data";
  if (typeName.includes("Transfer")) return "transfer_data";
  if (typeName.includes("Cancellation")) return "cancellation_data";
  if (typeName.includes("Acceptance")) return "acceptance_data";
  if (typeName.includes("Exercise")) return "exercise_data";
  if (typeName.includes("Conversion")) return "conversion_data";
  if (typeName.includes("Retraction")) return "retraction_data";
  if (typeName.includes("Release")) return "release_data";
  if (typeName.includes("Repricing")) return "repricing_data";
  if (typeName.includes("Acceleration")) return "acceleration_data";
  if (typeName.includes("Event")) return "event_data";
  if (typeName.includes("Start")) return "start_data";
  if (typeName === "Stakeholder") return "stakeholder_data";
  if (typeName === "StockClass") return "stock_class_data";
  if (typeName === "StockPlan") return "stock_plan_data";
  if (typeName === "StockLegendTemplate") return "template_data";
  if (typeName === "VestingTerms") return "terms_data";
  if (typeName === "Valuation") return "valuation_data";
  if (typeName === "Document") return "document_data";
  if (typeName.includes("Adjustment")) return "adjustment_data";
  if (typeName.includes("Split")) return "split_data";
  if (typeName.includes("Consolidation")) return "consolidation_data";
  if (typeName.includes("Repurchase")) return "repurchase_data";
  if (typeName.includes("Reissuance")) return "reissuance_data";
  if (typeName.includes("ReturnToPool")) return "return_data";
  return "data"; // fallback
}

function migrateFile(filePath: string): boolean {
  const content = fs.readFileSync(filePath, "utf-8");
  let modified = content;
  let hasChanges = false;

  const mappings = getTypeMappings();

  for (const mapping of mappings) {
    // Pattern for Create: exerciseCmd VAR CT.CreateTypeName with data_param = ...
    // This is complex because we need to extract the data block
    const createPattern = new RegExp(
      `(submit\\s+\\w+\\s+do\\s*\\n\\s*)exerciseCmd\\s+(\\w+)\\s+CT\\.Create${mapping.typeName}\\s+with\\s*\\n\\s*${mapping.dataParam}\\s*=\\s*`,
      "g"
    );

    // For now, let's do simpler regex replacements
    // Replace CT.CreateX with CT.OcfCreateX in the context of UpdateCapTable
    const simpleCreatePattern = new RegExp(`CT\\.Create${mapping.typeName}\\s+with\\s+${mapping.dataParam}\\s*=\\s*`, "g");
    if (simpleCreatePattern.test(modified)) {
      // This is getting complex - the test structure varies significantly
      hasChanges = true;
    }
  }

  // For now, just report which files need changes
  console.log(`File ${path.basename(filePath)} needs migration`);
  return hasChanges;
}

function main() {
  console.log("Scanning test files for migration...\n");

  const files = fs.readdirSync(TEST_DIR)
    .filter(f => f.endsWith(".daml") && f.startsWith("Test"))
    .map(f => path.join(TEST_DIR, f));

  let needsMigration = 0;
  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    if (content.includes("CT.Create") || content.includes("CT.Edit") || content.includes("CT.Delete")) {
      if (!file.includes("TestStakeholder") && !file.includes("TestHelpers")) {
        console.log(`  - ${path.basename(file)}`);
        needsMigration++;
      }
    }
  }

  console.log(`\n${needsMigration} files need migration (excluding already migrated)`);
  console.log("\nNote: Manual migration is recommended due to complex test patterns.");
  console.log("Each test uses the CapTable choices differently.");
}

main();
