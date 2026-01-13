#!/usr/bin/env tsx
/**
 * Verifies that the npm package has no unresolved external daml.js/ imports.
 *
 * After Canton 3.4, DAML codegen produces imports like:
 *   require('daml.js/ghc-stdlib-DA-Internal-Template-1.0.0')
 *
 * These must be replaced with relative paths by bundle-dependencies.ts
 * before the package is published, otherwise consumers can't use it.
 *
 * This script catches the issue in CI before publish.
 */

import fs from 'fs';
import path from 'path';
import { getErrorMessage } from './types';

const LIB_DIR = path.join(__dirname, '../lib');

function findFiles(dir: string, extension: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;

  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...findFiles(fullPath, extension));
    } else if (item.endsWith(extension)) {
      files.push(fullPath);
    }
  }
  return files;
}

function checkForUnresolvedImports(): { file: string; matches: string[] }[] {
  const issues: { file: string; matches: string[] }[] = [];

  // Check both .js and .d.ts files
  const jsFiles = findFiles(LIB_DIR, '.js');
  const dtsFiles = findFiles(LIB_DIR, '.d.ts');
  const allFiles = [...jsFiles, ...dtsFiles];

  // Pattern to find unresolved daml.js imports
  // These should have been replaced with relative paths
  const unresolvedPatterns = [
    /require\(['"]daml\.js\/[^'"]+['"]\)/g,
    /from ['"]daml\.js\/[^'"]+['"]/g,
  ];

  for (const filePath of allFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const matches: string[] = [];

    for (const pattern of unresolvedPatterns) {
      const found = content.match(pattern);
      if (found) {
        matches.push(...found);
      }
    }

    if (matches.length > 0) {
      issues.push({
        file: path.relative(LIB_DIR, filePath),
        matches: [...new Set(matches)], // dedupe
      });
    }
  }

  return issues;
}

function main(): void {
  console.log('🔍 Checking for unresolved daml.js/ imports in lib/...\n');

  if (!fs.existsSync(LIB_DIR)) {
    console.error('❌ lib/ directory not found. Run npm run codegen first.');
    process.exit(1);
  }

  try {
    const issues = checkForUnresolvedImports();

    if (issues.length > 0) {
      console.error('❌ Found unresolved daml.js/ imports:\n');
      for (const issue of issues) {
        console.error(`  ${issue.file}:`);
        for (const match of issue.matches) {
          console.error(`    - ${match}`);
        }
        console.error('');
      }
      console.error(
        'These imports should have been replaced with relative paths by bundle-dependencies.ts.',
      );
      console.error(
        'Check that the patterns in bundle-dependencies.ts match the generated code format.',
      );
      process.exit(1);
    }

    console.log('✅ No unresolved daml.js/ imports found. Package is ready for publish.');
  } catch (error) {
    console.error('❌ Error checking imports:', getErrorMessage(error));
    process.exit(1);
  }
}

main();
