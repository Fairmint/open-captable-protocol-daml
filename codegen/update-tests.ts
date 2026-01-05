/**
 * Update test files to use CapTable pattern instead of Issuer factory
 *
 * Transformations:
 * 1. Replace `import qualified Fairmint.OpenCapTable.Issuer as Iss` with CapTable import
 * 2. Replace `exerciseCmd issuerCid Iss.Create*` with `exerciseCmd capTableCid CT.Add*`
 * 3. Replace `ArchiveByIssuer` with built-in `Archive`
 * 4. Update test setup to use cap_table from TestOcp
 *
 * Usage: npx tsx codegen/update-tests.ts
 */

import * as fs from "fs";
import * as path from "path";

const TEST_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "../Test/daml/OpenCapTable"
);

function updateTestFile(filePath: string): boolean {
  let content = fs.readFileSync(filePath, "utf-8");
  const original = content;

  // Skip Setup.daml - already updated
  if (filePath.endsWith("Setup.daml")) return false;

  // 1. Add CapTable import if using Iss
  if (content.includes("qualified Fairmint.OpenCapTable.Issuer as Iss")) {
    content = content.replace(
      "import qualified Fairmint.OpenCapTable.Issuer as Iss",
      "import qualified Fairmint.OpenCapTable.CapTable as CT"
    );
  }

  // 2. Replace Iss.Create* with CT.Add*
  content = content.replace(/Iss\.Create(\w+)/g, "CT.Add$1");

  // 3. Replace ArchiveByIssuer with Archive (need both parties)
  // This is trickier - ArchiveByIssuer was controller issuer only
  // Archive needs both signatories

  // 4. Update test pattern: issuerCid -> capTableCid
  content = content.replace(/issuerCid/g, "capTableCid");

  // 5. Remove functions that manually create Issuer contracts (they're not needed)
  // These typically follow pattern: createIssuerFor* ... submitMulti ... createCmd Iss.Issuer
  content = content.replace(
    /createIssuerFor\w+[^=]*=[\s\S]*?submitMulti[^}]*createCmd Iss\.Issuer[\s\S]*?comments = \[\]\n/g,
    ""
  );

  // 6. Update test functions to get cap_table from TestOcp
  content = content.replace(
    /TestOcp\{([^}]*)\}\s*<-\s*setupTestOcp/g,
    (match, fields) => {
      if (!fields.includes("cap_table")) {
        // Add cap_table to destructuring
        const newFields = fields.trim() + ", cap_table";
        return `TestOcp{${newFields}} <- setupTestOcp`;
      }
      return match;
    }
  );

  // 7. Replace calls to createIssuerFor* with using cap_table directly
  content = content.replace(
    /capTableCid\s*<-\s*createIssuerFor\w+[^\n]*\n/g,
    "let capTableCid = cap_table\n"
  );

  // 8. Fix Iss.Issuer references that remain
  content = content.replace(/Iss\.Issuer\b/g, "Issuer");
  content = content.replace(/Iss\.IssuerOcfData\b/g, "IssuerOcfData");
  content = content.replace(/Iss\.OcfInitialShares\w+/g, (m) => m.replace("Iss.", ""));

  // 9. If we removed Iss import but still use Issuer types, add direct import
  if (!content.includes("as Iss") &&
      (content.includes("IssuerOcfData") || content.includes(":: Issuer"))) {
    if (!content.includes("import Fairmint.OpenCapTable.Issuer")) {
      content = content.replace(
        /import qualified Fairmint\.OpenCapTable\.CapTable as CT/,
        "import qualified Fairmint.OpenCapTable.CapTable as CT\nimport Fairmint.OpenCapTable.Issuer"
      );
    }
  }

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
    const modified = updateTestFile(file);
    if (modified) {
      modifiedCount++;
      console.log(`  Modified: ${path.basename(file)}`);
    }
  }

  console.log(`\nDone! Modified ${modifiedCount} files.`);
  console.log("Note: Manual review may be needed for complex test patterns.");
}

main();
