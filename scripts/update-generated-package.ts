import fs from 'fs';
import path from 'path';

// Read the root package.json
const rootPackagePath = path.join(__dirname, '..', 'package.json');
const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8')) as {
	name: string;
	version: string;
	peerDependencies?: Record<string, string>;
};

// Read the generated package.json
const generatedPackagePath = path.join(
	__dirname,
	'..',
	'generated',
	'js',
	'OpenCapTable-v03-0.0.1',
	'package.json',
);
const generatedPackage = JSON.parse(fs.readFileSync(generatedPackagePath, 'utf8')) as any;

// Update the version and name
generatedPackage.version = rootPackage.version;
generatedPackage.name = rootPackage.name;
// Ensure the package can be published
delete generatedPackage.private;

// Ensure publishConfig exists
if (!generatedPackage.publishConfig) {
	generatedPackage.publishConfig = { access: 'public' };
}

// Normalize peerDependencies: move from non-standard 'peer-dependencies' to 'peerDependencies'
if (generatedPackage['peer-dependencies']) {
	generatedPackage.peerDependencies = {
		...(generatedPackage.peerDependencies || {}),
		...generatedPackage['peer-dependencies'],
	};
	delete generatedPackage['peer-dependencies'];
}

// If root specifies peerDependencies, prefer those (so the published package matches repo policy)
if (rootPackage.peerDependencies) {
	generatedPackage.peerDependencies = { ...rootPackage.peerDependencies };
}

// Write back the generated package.json
fs.writeFileSync(generatedPackagePath, JSON.stringify(generatedPackage, null, 4) + '\n');

// Create index files in generated dir
const generatedDir = path.join(__dirname, '..', 'generated', 'js', 'OpenCapTable-v03-0.0.1');

// index.js that re-exports from lib/index.js
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

// index.d.ts that re-exports from lib/index.d.ts
const indexDtsContent = `// Re-export everything from the lib directory
export * from './lib/index';

// Also export the lib object itself for backward compatibility
import * as lib from './lib/index';
export { lib };
`;

fs.writeFileSync(path.join(generatedDir, 'index.js'), indexJsContent);
fs.writeFileSync(path.join(generatedDir, 'index.d.ts'), indexDtsContent);

console.log(`Updated generated package.json: name=${generatedPackage.name}, version=${generatedPackage.version}`);
console.log('Created package index files (index.js and index.d.ts)'); 