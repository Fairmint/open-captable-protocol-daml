#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';

const LIB_DIR = path.join(__dirname, '../lib');

function extractNamespaceFromPath(modulePath: string): string | null {
  // Extract namespace from module paths like:
  // '../Api/FeaturedAppRightV1' -> 'Splice.Api.FeaturedAppRightV1'
  // '../../..' (splice-amulet root) -> 'Splice.Amulet' (or other Splice modules)
  // '../Api/Token/MetadataV1' -> 'Splice.Api.Token.MetadataV1'

  // Convert path separators to dots and remove leading ../
  const normalized = modulePath.replace(/\.\.\//g, '').replace(/\//g, '.');

  // If it's a Splice module path, it should start with Splice or be in a Splice subdirectory
  if (normalized.startsWith('Splice.') || modulePath.includes('/Splice/')) {
    // Extract the full namespace from the path
    const spliceMatch = normalized.match(/Splice\.[A-Za-z.]+/);
    if (spliceMatch) {
      return `${spliceMatch[0]}.`;
    }
  }

  return null;
}

function fixFile(filePath: string): boolean {
  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;

  // Find all package variable declarations
  const packageRegex = /var (pkg[a-f0-9]{64}) = require\('([^']+)'\);/g;
  const packages: Map<string, string> = new Map();

  let match;
  while ((match = packageRegex.exec(content)) !== null) {
    const pkgVar = match[1];
    const modulePath = match[2];
    packages.set(pkgVar, modulePath);
  }

  // For each package, check if it has Splice or nested namespace references that need fixing
  let modified = false;
  for (const [pkgVar, modulePath] of packages.entries()) {
    // Find all uses of this package variable with nested namespaces
    // Matches patterns like: pkg.Splice.Api.Token.MetadataV1.Metadata -> pkg.Metadata
    // Or: pkg.FeaturedAppRightV1.FeaturedAppActivityMarker -> pkg.FeaturedAppActivityMarker
    // The pattern captures everything between pkg. and the final Type
    const usageRegex = new RegExp(`${pkgVar}\\.((?:[A-Z][A-Za-z0-9]*\\.)+)([A-Z][A-Za-z0-9_]*)`, 'g');

    let usageMatch;
    const replacements = new Map<string, string>();

    while ((usageMatch = usageRegex.exec(content)) !== null) {
      const fullMatch = usageMatch[0]; // e.g., pkg.Splice.Api.Token.MetadataV1.Metadata
      const namespacePath = usageMatch[1]; // e.g., Splice.Api.Token.MetadataV1.
      const typeName = usageMatch[2]; // e.g., Metadata

      // Check if this is a Splice-related namespace or a module-specific namespace
      if (namespacePath.includes('Splice.') || namespacePath.match(/^[A-Z][A-Za-z0-9]*V\d+\./)) {
        // Replace with just pkg.TypeName
        replacements.set(fullMatch, `${pkgVar}.${typeName}`);
      }
    }

    // Apply all replacements
    for (const [from, to] of replacements.entries()) {
      const beforeReplace = content;
      content = content.replace(new RegExp(from.replace(/\./g, '\\.'), 'g'), to);

      if (content !== beforeReplace) {
        modified = true;
        console.log(`  Fixed ${from} -> ${to} in ${path.relative(LIB_DIR, filePath)}`);
      }
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content);
    return true;
  }

  return false;
}

function processDirectory(dir: string): number {
  let fixedCount = 0;
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      fixedCount += processDirectory(filePath);
    } else if (file.endsWith('.js') || file.endsWith('.d.ts')) {
      if (fixFile(filePath)) {
        fixedCount++;
      }
    }
  }

  return fixedCount;
}

console.log('🔧 Fixing Splice API namespace references in lib/...');
const fixedCount = processDirectory(LIB_DIR);
console.log(`✅ Fixed ${fixedCount} files`);
