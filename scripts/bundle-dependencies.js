#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Script to bundle DA.Internal.Template dependency into the generated package
 * This eliminates the local file dependency that prevents publishing to npm
 */

const PACKAGE_DIR = path.join(__dirname, '../generated/js/OpenCapTable-v03-0.0.1');
const DEPENDENCY_DIR = path.join(__dirname, '../generated/js/ghc-stdlib-DA-Internal-Template-1.0.0');

function createDirectoryIfNotExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyFile(src, dest) {
  const destDir = path.dirname(dest);
  createDirectoryIfNotExists(destDir);
  fs.copyFileSync(src, dest);
}

function createBundledFiles() {
  console.log('📦 Bundling DA.Internal.Template dependency...');

  // Create the DA/Internal/Template directory structure
  const templateDir = path.join(PACKAGE_DIR, 'lib/DA/Internal/Template');
  createDirectoryIfNotExists(templateDir);

  // Copy the module files from the dependency
  const moduleSrc = path.join(DEPENDENCY_DIR, 'lib/DA/Internal/Template/module.js');
  const moduleDest = path.join(templateDir, 'module.js');
  const moduleDtsSrc = path.join(DEPENDENCY_DIR, 'lib/DA/Internal/Template/module.d.ts');
  const moduleDtsDest = path.join(templateDir, 'module.d.ts');

  if (fs.existsSync(moduleSrc)) {
    copyFile(moduleSrc, moduleDest);
    console.log('✅ Copied module.js');
  } else {
    console.log('⚠️  module.js not found in dependency, creating minimal version');
    // Create minimal module.js if dependency doesn't exist
    const minimalModule = `"use strict";
/* eslint-disable-next-line no-unused-vars */
function __export(m) {
/* eslint-disable-next-line no-prototype-builtins */
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable-next-line no-unused-vars */
var jtv = require('@mojotech/json-type-validation');
/* eslint-disable-next-line no-unused-vars */
var damlTypes = require('@daml/types');
/* eslint-disable-next-line no-unused-vars */
var damlLedger = require('@daml/ledger');


exports.Archive = {
  decoder: damlTypes.lazyMemo(function () { return jtv.object({}); }),
  encode: function (__typed__) {
  return {
  };
}
,
};
`;
    fs.writeFileSync(moduleDest, minimalModule);
  }

  if (fs.existsSync(moduleDtsSrc)) {
    copyFile(moduleDtsSrc, moduleDtsDest);
    console.log('✅ Copied module.d.ts');
  } else {
    console.log('⚠️  module.d.ts not found in dependency, creating minimal version');
    // Create minimal module.d.ts if dependency doesn't exist
    const minimalModuleDts = `// Generated from DA.Internal.Template.daml
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';
/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
import * as damlLedger from '@daml/ledger';

export declare type Archive = {
};

export declare const Archive:
  damlTypes.Serializable<Archive> & {
  }
;
`;
    fs.writeFileSync(moduleDtsDest, minimalModuleDts);
  }

  // Create index.js for Template
  const templateIndex = `"use strict";
/* eslint-disable-next-line no-unused-vars */
function __export(m) {
/* eslint-disable-next-line no-prototype-builtins */
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });
__export(require('./module'));
`;
  fs.writeFileSync(path.join(templateDir, 'index.js'), templateIndex);

  // Create index.d.ts for Template
  const templateIndexDts = `export * from './module';
`;
  fs.writeFileSync(path.join(templateDir, 'index.d.ts'), templateIndexDts);

  // Create Internal/index.js
  const internalDir = path.join(PACKAGE_DIR, 'lib/DA/Internal');
  createDirectoryIfNotExists(internalDir);
  const internalIndex = `"use strict";
/* eslint-disable-next-line no-unused-vars */
function __export(m) {
/* eslint-disable-next-line no-prototype-builtins */
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });
var Template = require('./Template');
exports.Template = Template;
`;
  fs.writeFileSync(path.join(internalDir, 'index.js'), internalIndex);

  // Create Internal/index.d.ts
  const internalIndexDts = `export * from './Template';
`;
  fs.writeFileSync(path.join(internalDir, 'index.d.ts'), internalIndexDts);

  // Create DA/index.js
  const daDir = path.join(PACKAGE_DIR, 'lib/DA');
  createDirectoryIfNotExists(daDir);
  const daIndex = `"use strict";
/* eslint-disable-next-line no-unused-vars */
function __export(m) {
/* eslint-disable-next-line no-prototype-builtins */
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });
var Internal = require('./Internal');
exports.Internal = Internal;
`;
  fs.writeFileSync(path.join(daDir, 'index.js'), daIndex);

  // Create DA/index.d.ts
  const daIndexDts = `export * from './Internal';
`;
  fs.writeFileSync(path.join(daDir, 'index.d.ts'), daIndexDts);

  console.log('✅ Created bundled DA.Internal.Template structure');
}

function updateMainIndex() {
  console.log('📝 Updating main index files...');

  // Update main index.js to include DA export
  const mainIndexPath = path.join(PACKAGE_DIR, 'lib/index.js');
  let mainIndex = fs.readFileSync(mainIndexPath, 'utf8');
  
  // Add DA import and export if not already present
  if (!mainIndex.includes('var DA = require(\'./DA\')')) {
    const fairmintLine = mainIndex.indexOf('exports.Fairmint = Fairmint;');
    if (fairmintLine !== -1) {
      const insertPos = mainIndex.indexOf('\n', fairmintLine) + 1;
      const daImport = 'var DA = require(\'./DA\');\n';
      const daExport = 'exports.DA = DA;\n';
      mainIndex = mainIndex.slice(0, insertPos) + daImport + daExport + mainIndex.slice(insertPos);
      fs.writeFileSync(mainIndexPath, mainIndex);
      console.log('✅ Updated main index.js');
    }
  }

  // Update main index.d.ts to include DA export
  const mainIndexDtsPath = path.join(PACKAGE_DIR, 'lib/index.d.ts');
  let mainIndexDts = fs.readFileSync(mainIndexDtsPath, 'utf8');
  
  // Add DA import and export if not already present
  if (!mainIndexDts.includes('import * as DA from \'./DA\'')) {
    const fairmintImport = mainIndexDts.indexOf('import * as Fairmint from \'./Fairmint\';');
    if (fairmintImport !== -1) {
      const insertPos = mainIndexDts.indexOf('\n', fairmintImport) + 1;
      const daImport = 'import * as DA from \'./DA\';\n';
      mainIndexDts = mainIndexDts.slice(0, insertPos) + daImport + mainIndexDts.slice(insertPos);
      
      // Update export line
      mainIndexDts = mainIndexDts.replace(
        'export { Fairmint } ;',
        'export { Fairmint, DA } ;'
      );
      
      fs.writeFileSync(mainIndexDtsPath, mainIndexDts);
      console.log('✅ Updated main index.d.ts');
    }
  }
}

function replaceDependencyReferences() {
  console.log('🔄 Replacing dependency references in generated files...');
  
  // Find all JavaScript files that reference the old dependency
  const jsFiles = [];
  const findJsFiles = (dir) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        findJsFiles(filePath);
      } else if (file.endsWith('.js')) {
        jsFiles.push(filePath);
      }
    }
  };
  
  findJsFiles(path.join(PACKAGE_DIR, 'lib'));
  
  let replacedCount = 0;
  for (const filePath of jsFiles) {
    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;
    
    // Check if this file contains the old dependency reference
    if (content.includes('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0')) {
      // Calculate relative path from current file to DA/Internal/Template
      const relativePath = path.relative(path.dirname(filePath), path.join(PACKAGE_DIR, 'lib/DA/Internal/Template'));
      const normalizedPath = relativePath.replace(/\\/g, '/'); // Ensure forward slashes for require
      
      console.log(`  Updating ${path.relative(PACKAGE_DIR, filePath)} with path: ${normalizedPath}`);
      
      // Replace the require statement
      content = content.replace(
        /require\('@daml\.js\/ghc-stdlib-DA-Internal-Template-1\.0\.0'\)/g,
        `require('${normalizedPath}')`
      );
      
      // If content changed, write it back
      if (content !== originalContent) {
        fs.writeFileSync(filePath, content);
        replacedCount++;
      }
    }
  }
  
  console.log(`✅ Replaced dependency references in ${replacedCount} files`);
}

function removeLocalDependency() {
  console.log('🗑️  Removing local dependencies from package.json...');
  
  const packageJsonPath = path.join(PACKAGE_DIR, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  // Remove local file dependencies
  const localDependencies = [
    '@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0',
    '@daml.js/splice-api-featured-app-v1-1.0.0'
  ];
  
  let removedCount = 0;
  for (const dep of localDependencies) {
    if (packageJson.dependencies && packageJson.dependencies[dep]) {
      delete packageJson.dependencies[dep];
      removedCount++;
      console.log(`✅ Removed local dependency: ${dep}`);
    }
  }
  
  if (removedCount > 0) {
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 4));
    console.log(`✅ Removed ${removedCount} local dependencies from package.json`);
  } else {
    console.log('ℹ️  No local dependencies found in package.json');
  }
}

function main() {
  try {
    console.log('🚀 Starting dependency bundling process...');
    
    createBundledFiles();
    updateMainIndex();
    replaceDependencyReferences();
    removeLocalDependency();
    
    console.log('✅ Dependency bundling completed successfully!');
    console.log('📦 Package is now ready for publishing to npm');
    
  } catch (error) {
    console.error('❌ Error during dependency bundling:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { createBundledFiles, updateMainIndex, replaceDependencyReferences, removeLocalDependency }; 