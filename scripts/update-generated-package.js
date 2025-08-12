#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read the root package.json
const rootPackagePath = path.join(__dirname, '..', 'package.json');
const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));

// Read the generated package.json
const generatedPackagePath = path.join(__dirname, '..', 'generated', 'js', 'OpenCapTable-v02-0.0.2', 'package.json');
const generatedPackage = JSON.parse(fs.readFileSync(generatedPackagePath, 'utf8'));

// Update the version and name
generatedPackage.version = rootPackage.version;
generatedPackage.name = rootPackage.name;
delete generatedPackage.private;

// Add publishConfig if not present
if (!generatedPackage.publishConfig) {
    generatedPackage.publishConfig = {
        access: "public"
    };
}

// Write back the generated package.json
fs.writeFileSync(generatedPackagePath, JSON.stringify(generatedPackage, null, 4) + '\n');

// Create index files
const generatedDir = path.join(__dirname, '..', 'generated', 'js', 'OpenCapTable-v02-0.0.2');

// Create index.js that re-exports from lib/index.js
const indexJsContent = `"use strict";

// Re-export everything from the lib directory
const lib = require('./lib/index.js');

// Export all properties from lib
Object.keys(lib).forEach(key => {
    exports[key] = lib[key];
});

// Also export the lib object itself for backward compatibility
exports.lib = lib;
`;

// Create index.d.ts that re-exports from lib/index.d.ts
const indexDtsContent = `// Re-export everything from the lib directory
export * from './lib/index';

// Also export the lib object itself for backward compatibility
import * as lib from './lib/index';
export { lib };
`;

// Write the files
fs.writeFileSync(path.join(generatedDir, 'index.js'), indexJsContent);
fs.writeFileSync(path.join(generatedDir, 'index.d.ts'), indexDtsContent);

// Copy README if it exists
const readmePath = path.join(generatedDir, 'README.md');
if (fs.existsSync(readmePath)) {
    console.log('README.md already exists in generated directory');
} else {
    console.log('README.md will be created by the daml codegen process');
}

console.log(`Updated generated package.json: name=${generatedPackage.name}, version=${generatedPackage.version}`);
console.log('Created package index files (index.js and index.d.ts)'); 