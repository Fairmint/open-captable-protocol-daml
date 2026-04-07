import fs from 'fs';
import path from 'path';
import { requirePackageConfig } from './packages';

const ocpPkg = requirePackageConfig('ocp');
const reportsPkg = requirePackageConfig('reports');
const nftApiPkg = requirePackageConfig('nftApi');
const nftReferencePkg = requirePackageConfig('nftReference');
const paymentStreamsPkg = requirePackageConfig('paymentStreams');

const packageDirs = [
  path.join(__dirname, '..', 'generated', 'js', `${ocpPkg.name}-${ocpPkg.version}`),
  path.join(__dirname, '..', 'generated', 'js', `${reportsPkg.name}-${reportsPkg.version}`),
  path.join(__dirname, '..', 'generated', 'js', `${nftApiPkg.name}-${nftApiPkg.version}`),
  path.join(__dirname, '..', 'generated', 'js', `${nftReferencePkg.name}-${nftReferencePkg.version}`),
  path.join(__dirname, '..', 'generated', 'js', `${paymentStreamsPkg.name}-${paymentStreamsPkg.version}`),
];

// Create index.js and index.d.ts that re-export from lib/index.js if the directory exists
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

const indexDtsContent = `// Re-export everything from the lib directory
export * from './lib/index';

// Also export the lib object itself for backward compatibility
import * as lib from './lib/index';
export { lib };
`;

for (const generatedDir of packageDirs) {
  if (!fs.existsSync(generatedDir)) continue;
  fs.writeFileSync(path.join(generatedDir, 'index.js'), indexJsContent);
  fs.writeFileSync(path.join(generatedDir, 'index.d.ts'), indexDtsContent);
  console.log(`Created package index files (index.js and index.d.ts) in ${generatedDir}`);
}
