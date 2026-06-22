/**
 * DAML-to-OCF schema gap checker.
 *
 * Scans DAML files for `-- OCF: <url>` annotations linked to `data` declarations, resolves the corresponding OCF JSON
 * schemas, compares DAML fields against OCF properties, and reports any missing fields.
 *
 * Usage: npx tsx scripts/schema-gap-checker/check-schema-gaps.ts npx tsx
 * scripts/schema-gap-checker/check-schema-gaps.ts --package OpenCapTable-v36 npx tsx
 * scripts/schema-gap-checker/check-schema-gaps.ts --ocf-schema-dir /path/to/schema
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT_DIR = path.join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

/** Parse a named CLI argument from process.argv. */
function parseArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx === args.length - 1) return undefined;
  return args[idx + 1];
}

/** Auto-detect the latest OpenCapTable-v* directory by highest version number. */
function detectLatestPackage(): string {
  const entries = fs.readdirSync(ROOT_DIR, { withFileTypes: true });
  let best: { name: string; version: number } | null = null;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^OpenCapTable-v(\d+)$/);
    if (!match) continue;
    const version = parseInt(match[1], 10);
    if (!best || version > best.version) {
      best = { name: entry.name, version };
    }
  }

  if (!best) {
    console.error('❌ No OpenCapTable-v* directory found');
    process.exit(1);
  }
  return best.name;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DamlTypeInfo {
  typeName: string;
  fields: Set<string>;
  ocfUrls: string[];
  sourceFile: string;
}

interface SchemaProperties {
  properties: Set<string>;
  constProperties: Set<string>;
}

// ---------------------------------------------------------------------------
// Allowlist — properties that are never flagged as missing
// ---------------------------------------------------------------------------

const GLOBAL_ALLOWLIST = new Set(['object_type']);

const PER_TYPE_ALLOWLIST: Record<string, Set<string>> = {
  StakeholderOcfData: new Set(['current_relationship']),
  StockPlanOcfData: new Set(['stock_class_id']),
  EquityCompensationIssuanceOcfData: new Set(['option_grant_type', 'plan_security_type']),
};

/** Types that intentionally implement a subset of their linked OCF schema. */
const SKIP_TYPES = new Set([
  'OcfEquityCompensationIssuanceData', // Pure-portion helper; full schema covered by EquityCompensationIssuanceOcfData
]);

// ---------------------------------------------------------------------------
// OCF schema resolution and property collection
// ---------------------------------------------------------------------------

const schemaCache = new Map<string, SchemaProperties>();

/** Extract the relative path after `/schema/` from a raw GitHub URL. */
function urlToRelativePath(url: string): string | null {
  const marker = '/schema/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

/** Resolve an OCF schema URL to a local file path. */
function resolveSchemaPath(url: string, ocfSchemaDir: string): string | null {
  const rel = urlToRelativePath(url);
  if (!rel) return null;
  return path.join(ocfSchemaDir, rel);
}

/** Recursively collect property names (and const-valued property names) from a schema file. */
function collectSchemaProperties(schemaPath: string, ocfSchemaDir: string): SchemaProperties {
  const cached = schemaCache.get(schemaPath);
  if (cached) return cached;

  const result: SchemaProperties = { properties: new Set(), constProperties: new Set() };
  schemaCache.set(schemaPath, result);

  if (!fs.existsSync(schemaPath)) return result;

  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;

  if (schema.properties && typeof schema.properties === 'object') {
    for (const [key, def] of Object.entries(schema.properties as Record<string, unknown>)) {
      result.properties.add(key);
      if (def && typeof def === 'object' && 'const' in (def as Record<string, unknown>)) {
        result.constProperties.add(key);
      }
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const entry of schema.allOf as Array<Record<string, unknown>>) {
      if (entry.$ref && typeof entry.$ref === 'string') {
        const refPath = resolveSchemaPath(entry.$ref, ocfSchemaDir);
        if (refPath) {
          const refProps = collectSchemaProperties(refPath, ocfSchemaDir);
          for (const p of refProps.properties) result.properties.add(p);
          for (const p of refProps.constProperties) result.constProperties.add(p);
        }
      }
      if (entry.properties && typeof entry.properties === 'object') {
        for (const [key, def] of Object.entries(entry.properties as Record<string, unknown>)) {
          result.properties.add(key);
          if (def && typeof def === 'object' && 'const' in (def as Record<string, unknown>)) {
            result.constProperties.add(key);
          }
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// DAML scanning
// ---------------------------------------------------------------------------

const OCF_URL_RE = /^--\s+OCF(?:\s*\([^)]*\))?\s*:\s*(https?:\/\/\S+)/;
const DATA_DECL_RE = /^data\s+(\w+)/;
const FIELD_RE = /^\s{2,}(\w+)\s*:\s*(.+)/;
const DERIVING_RE = /^\s+deriving/;
const CONSTRUCTOR_WITH_RE = /^\s*\|\s*\w+\s+with\s*$/;
const CONSTRUCTOR_NO_WITH_RE = /^\s*\|\s*\w+\s*$/;

/** Scan a single DAML file and extract type info. */
function scanDamlFile(filePath: string): DamlTypeInfo[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const results: DamlTypeInfo[] = [];

  let pendingUrls: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const ocfMatch = line.match(OCF_URL_RE);
    if (ocfMatch) {
      const url = ocfMatch[1];
      if (url.endsWith('.schema.json')) {
        pendingUrls.push(url);
      }
      i++;
      continue;
    }

    const dataMatch = line.match(DATA_DECL_RE);
    if (dataMatch) {
      const typeName = dataMatch[1];
      const urls = [...pendingUrls];
      pendingUrls = [];

      const fields = parseDataFields(lines, i);

      if (urls.length > 0 && fields.size > 0) {
        results.push({ typeName, fields, ocfUrls: urls, sourceFile: filePath });
      }

      i++;
      continue;
    }

    if (!line.match(/^--/)) {
      pendingUrls = [];
    }

    i++;
  }

  return results;
}

/** Parse field names from a data declaration starting at the given line index. */
function parseDataFields(lines: string[], startIdx: number): Set<string> {
  const fields = new Set<string>();
  let i = startIdx;
  let inWithBlock = false;

  const firstLine = lines[i];
  if (firstLine.includes(' with')) {
    inWithBlock = true;
  }

  i++;

  while (i < lines.length) {
    const line = lines[i];

    if (DERIVING_RE.test(line)) break;

    if (!inWithBlock) {
      if (line.trimEnd() === '  with' || line.trim() === 'with') {
        inWithBlock = true;
        i++;
        continue;
      }
      if (CONSTRUCTOR_WITH_RE.test(line)) {
        inWithBlock = true;
        i++;
        continue;
      }
      if (CONSTRUCTOR_NO_WITH_RE.test(line)) {
        i++;
        continue;
      }
      if (line.trim() === '' || line.match(/^\s*--/)) {
        i++;
        continue;
      }
      if (DATA_DECL_RE.test(line)) break;
      i++;
      continue;
    }

    const fieldMatch = line.match(FIELD_RE);
    if (fieldMatch) {
      fields.add(fieldMatch[1]);
      i++;
      continue;
    }

    if (CONSTRUCTOR_WITH_RE.test(line)) {
      i++;
      continue;
    }

    if (CONSTRUCTOR_NO_WITH_RE.test(line)) {
      inWithBlock = false;
      i++;
      continue;
    }

    if (line.trim() === '' || line.match(/^\s*--/)) {
      i++;
      continue;
    }

    if (DATA_DECL_RE.test(line) || (line.length > 0 && !line.match(/^\s/))) {
      break;
    }

    i++;
  }

  return fields;
}

/** Recursively find all .daml files under a directory. */
function findDamlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findDamlFiles(fullPath));
    } else if (entry.name.endsWith('.daml')) {
      results.push(fullPath);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

interface GapResult {
  typeName: string;
  checkedCount: number;
  missing: Array<{ field: string; schemaFile: string }>;
}

/** Compare a DAML type against its linked OCF schemas and return gap info. */
function checkTypeGaps(info: DamlTypeInfo, ocfSchemaDir: string): GapResult {
  const allProperties = new Set<string>();
  const allConst = new Set<string>();
  const propertySource = new Map<string, string>();

  for (const url of info.ocfUrls) {
    const schemaPath = resolveSchemaPath(url, ocfSchemaDir);
    if (!schemaPath) continue;

    const { properties, constProperties } = collectSchemaProperties(schemaPath, ocfSchemaDir);
    const fileName = path.basename(schemaPath);

    for (const p of properties) {
      allProperties.add(p);
      if (!propertySource.has(p)) {
        propertySource.set(p, fileName);
      }
    }
    for (const p of constProperties) {
      allConst.add(p);
    }
  }

  const mappedDamlFields = new Set<string>();
  for (const f of info.fields) {
    mappedDamlFields.add(f);
    if (f.endsWith('_')) {
      mappedDamlFields.add(f.slice(0, -1));
    }
  }

  const typeAllowlist = PER_TYPE_ALLOWLIST[info.typeName] ?? new Set();
  const missing: Array<{ field: string; schemaFile: string }> = [];

  for (const prop of allProperties) {
    if (mappedDamlFields.has(prop)) continue;
    if (GLOBAL_ALLOWLIST.has(prop)) continue;
    if (typeAllowlist.has(prop)) continue;
    if (allConst.has(prop)) continue;
    missing.push({ field: prop, schemaFile: propertySource.get(prop) ?? 'unknown' });
  }

  missing.sort((a, b) => a.field.localeCompare(b.field));

  return { typeName: info.typeName, checkedCount: allProperties.size, missing };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const packageName = parseArg('package') ?? detectLatestPackage();
  const ocfSchemaDir =
    parseArg('ocf-schema-dir') ?? path.join(ROOT_DIR, '..', 'ocp-canton-sdk', 'Open-Cap-Format-OCF', 'schema');

  if (!fs.existsSync(ocfSchemaDir)) {
    console.error(`❌ OCF schema directory not found: ${ocfSchemaDir}`);
    process.exit(1);
  }

  const damlDir = path.join(ROOT_DIR, packageName, 'daml');
  if (!fs.existsSync(damlDir)) {
    console.error(`❌ DAML source directory not found: ${damlDir}`);
    process.exit(1);
  }

  console.log(`🔍 Checking DAML-to-OCF schema gaps for ${packageName}...\n`);

  const damlFiles = findDamlFiles(damlDir);
  const allTypes: DamlTypeInfo[] = [];

  for (const file of damlFiles) {
    allTypes.push(...scanDamlFile(file));
  }

  allTypes.sort((a, b) => a.typeName.localeCompare(b.typeName));

  let cleanCount = 0;
  let gapCount = 0;
  let totalMissing = 0;

  let skippedCount = 0;

  for (const typeInfo of allTypes) {
    if (SKIP_TYPES.has(typeInfo.typeName)) {
      console.log(`⏭️  ${typeInfo.typeName}: skipped (intentionally partial)`);
      skippedCount++;
      continue;
    }

    const result = checkTypeGaps(typeInfo, ocfSchemaDir);

    if (result.missing.length === 0) {
      console.log(`✅ ${result.typeName}: ${result.checkedCount} properties checked`);
      cleanCount++;
    } else {
      console.log(`❌ ${result.typeName} missing ${result.missing.length} field(s):`);
      for (const m of result.missing) {
        console.log(`   - "${m.field}" (from ${m.schemaFile})`);
      }
      gapCount++;
      totalMissing += result.missing.length;
    }
  }

  console.log('\n---');
  console.log(
    `📊 Summary: ${allTypes.length - skippedCount} types checked, ${skippedCount} skipped, ${cleanCount} clean, ${gapCount} with gaps (${totalMissing} total missing fields)`
  );

  if (gapCount > 0) {
    console.log('\n❌ Schema gap check failed!');
    process.exit(1);
  }

  console.log('\n✅ All DAML types match their OCF schemas.');
}

try {
  main();
} catch (error) {
  console.error('Fatal error:', error);
  process.exit(1);
}
