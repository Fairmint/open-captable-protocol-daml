/**
 * Comprehensive fix for all failing tests
 * - Add TestHelpers import
 * - Add prerequisite calls (addDefaultStakeholder, addDefaultStockClass, addPrerequisites)
 * - Remove unused mkIssuer functions
 * - Update stakeholder_id to "SH-1"
 */

import * as fs from "fs";
import * as path from "path";

const TEST_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "../Test/daml/OpenCapTable"
);

// Tests that need stakeholder prerequisite only
const STAKEHOLDER_ONLY = [
  "TestConvertibleCancellation",
  "TestConvertibleConversion",
  "TestConvertibleRetraction",
  "TestConvertibleTransfer",
  "TestEquityCompensationAcceptance",
  "TestEquityCompensationCancellation",
  "TestEquityCompensationRetraction",
  "TestEquityCompensationTransfer",
  "TestWarrantAcceptance",
  "TestWarrantCancellation",
  "TestWarrantExercise",
  "TestWarrantIssuance",
  "TestWarrantRetraction",
  "TestWarrantTransfer",
  "TestVestingAcceleration",
  "TestVestingEvent",
  "TestVestingStart",
];

// Tests that need both stakeholder AND stock class
const BOTH_PREREQUISITES = [
  "TestStockAcceptance",
  "TestStockCancellation",
  "TestStockClassSplit",
  "TestStockConsolidation",
  "TestStockConversion",
  "TestStockReissuance",
  "TestStockRepurchase",
  "TestStockRetraction",
  "TestStockTransfer",
  "TestStockPlanPoolAdjustment",
];

// Tests that just need stock class (no stakeholder)
const STOCK_CLASS_ONLY = [
  "TestStockPlan",
];

function fixTestFile(filePath: string): boolean {
  const fileName = path.basename(filePath, ".daml");
  let content = fs.readFileSync(filePath, "utf-8");
  const original = content;

  // Determine what helpers are needed
  let needsStakeholder = STAKEHOLDER_ONLY.includes(fileName);
  let needsBoth = BOTH_PREREQUISITES.includes(fileName);
  let needsStockClass = STOCK_CLASS_ONLY.includes(fileName);

  if (!needsStakeholder && !needsBoth && !needsStockClass) {
    return false;
  }

  // 1. Add TestHelpers import if not present
  if (!content.includes("OpenCapTable.TestHelpers")) {
    const helperImport = needsBoth
      ? "import OpenCapTable.TestHelpers (addPrerequisites)"
      : needsStakeholder
      ? "import OpenCapTable.TestHelpers (addDefaultStakeholder)"
      : "import OpenCapTable.TestHelpers (addDefaultStockClass)";
    
    content = content.replace(
      "import OpenCapTable.Setup",
      `import OpenCapTable.Setup\n${helperImport}`
    );
  }

  // 2. Remove mkIssuer function definitions
  content = content.replace(
    /mkIssuer issuer.*?comments = \[\]\n\n/gs,
    ""
  );

  // 3. Update test functions to add prerequisites
  // Pattern: let capTableCid = cap_table
  // Replace with: capTableCid <- addHelper issuer cap_table
  const helperCall = needsBoth
    ? "addPrerequisites"
    : needsStakeholder
    ? "addDefaultStakeholder"
    : "addDefaultStockClass";

  content = content.replace(
    /let capTableCid = cap_table\n/g,
    `capTableCid <- ${helperCall} issuer cap_table\n`
  );

  // 4. Update stakeholder_id references to use "SH-1"
  content = content.replace(/stakeholder_id = "SH-[^"]+"/g, 'stakeholder_id = "SH-1"');
  content = content.replace(/stakeholder_id = "STAKEHOLDER[^"]*"/g, 'stakeholder_id = "SH-1"');

  // 5. Update stock_class_id references to use "SC_COMMON"
  content = content.replace(/stock_class_id = "SC-[^"]+"/g, 'stock_class_id = "SC_COMMON"');

  if (content !== original) {
    fs.writeFileSync(filePath, content);
    return true;
  }
  return false;
}

function main() {
  const allTests = [...STAKEHOLDER_ONLY, ...BOTH_PREREQUISITES, ...STOCK_CLASS_ONLY];
  
  console.log(`Processing ${allTests.length} test files...`);

  let modifiedCount = 0;
  for (const testName of allTests) {
    const filePath = path.join(TEST_DIR, `${testName}.daml`);
    if (fs.existsSync(filePath)) {
      const modified = fixTestFile(filePath);
      if (modified) {
        modifiedCount++;
        console.log(`  Modified: ${testName}.daml`);
      }
    } else {
      console.log(`  Not found: ${testName}.daml`);
    }
  }

  console.log(`\nDone! Modified ${modifiedCount} files.`);
}

main();

