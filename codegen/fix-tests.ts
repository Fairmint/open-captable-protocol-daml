/**
 * Fix test files to use cap_table from setupTestOcp instead of creating Issuer directly
 */

import * as fs from "fs";
import * as path from "path";

const TEST_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "../Test/daml/OpenCapTable"
);

function fixTestFile(filePath: string): boolean {
  let content = fs.readFileSync(filePath, "utf-8");
  const original = content;

  // Skip Setup.daml
  if (filePath.endsWith("Setup.daml")) return false;

  // Pattern: Tests that already have cap_table destructuring but then try to create Issuer
  // Replace the Issuer creation block with using cap_table

  // Match: capTableCid <- submit issuer do\n    createCmd Issuer with\n      context = ctx\n      issuer_data = IssuerOcfData with\n        ...many lines...\n        comments = []
  const issuerCreationPattern = /capTableCid <- submit issuer do\s+createCmd Issuer with\s+context = ctx\s+issuer_data = IssuerOcfData with[\s\S]*?comments = \[\]/g;

  content = content.replace(issuerCreationPattern, "let capTableCid = cap_table");

  // Also replace submitMulti versions
  const issuerCreationMultiPattern = /capTableCid <- submitMulti \[issuer, system_operator\] \[\] do\s+createCmd Issuer with\s+context = ctx\s+issuer_data = IssuerOcfData with[\s\S]*?comments = \[\]/g;

  content = content.replace(issuerCreationMultiPattern, "let capTableCid = cap_table");

  // Same for sysOp/issuerP pattern
  const issuerCreationAltPattern = /capTableCid <- submitMulti \[sysOp, issuerP\] \[\] do\s+createCmd Issuer with[\s\S]*?comments = \[\]/g;

  content = content.replace(issuerCreationAltPattern, "let capTableCid = cap_table");

  // Fix: submit issuer do archiveCmd cid needs both signatories
  // But CapTable choices only need issuer. Archive needs both signatories.
  // The archive pattern should be submitMulti for the underlying contract archive

  if (content !== original) {
    fs.writeFileSync(filePath, content);
    return true;
  }
  return false;
}

function main() {
  const files = fs.readdirSync(TEST_DIR)
    .filter((f) => f.endsWith(".daml"))
    .map((f) => path.join(TEST_DIR, f));

  console.log(`Processing ${files.length} test files...`);

  let modifiedCount = 0;
  for (const file of files) {
    const modified = fixTestFile(file);
    if (modified) {
      modifiedCount++;
      console.log(`  Modified: ${path.basename(file)}`);
    }
  }

  console.log(`\nDone! Modified ${modifiedCount} files.`);
}

main();
