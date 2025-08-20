import fs from 'fs';
import path from 'path';

const generatedDir = path.join(__dirname, '..', 'generated', 'js', 'OpenCapTable-v04-0.0.1');

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

console.log('Created package index files (index.js and index.d.ts)');
