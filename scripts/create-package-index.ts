import fs from 'fs';
import path from 'path';

const packageDirs = [
  path.join(__dirname, '..', 'generated', 'js', 'OpenCapTable-v25-0.0.1'),
  path.join(__dirname, '..', 'generated', 'js', 'OpenCapTableReports-v01-0.0.2'),
  path.join(__dirname, '..', 'generated', 'js', 'Subscriptions-v09-0.0.3'),
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
