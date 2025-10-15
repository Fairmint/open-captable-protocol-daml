#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';

// Paths
const PACKAGE_DIRS = [
	path.join(__dirname, '../generated/js/OpenCapTable-v25-0.0.1'),
	path.join(__dirname, '../generated/js/OpenCapTableReports-v01-0.0.2'),
	path.join(__dirname, '../generated/js/Subscriptions-v07-0.0.1'),
];
const DEPENDENCY_DIR = path.join(__dirname, '../generated/js/ghc-stdlib-DA-Internal-Template-1.0.0');
const SPLICE_DEPENDENCY_DIR = path.join(__dirname, '../generated/js/splice-api-featured-app-v1-1.0.0');
const SPLICE_AMULET_DIR = path.join(__dirname, '../generated/js/splice-amulet-0.1.14');
const DA_TIME_TYPES_DIR = path.join(__dirname, '../generated/js/daml-stdlib-DA-Time-Types-1.0.0');
const DA_TYPES_DIR = path.join(__dirname, '../generated/js/daml-prim-DA-Types-1.0.0');
const TOKEN_METADATA_DIR = path.join(__dirname, '../generated/js/splice-api-token-metadata-v1-1.0.0');
const TOKEN_HOLDING_DIR = path.join(__dirname, '../generated/js/splice-api-token-holding-v1-1.0.0');
const TOKEN_ALLOCATION_INSTRUCTION_DIR = path.join(__dirname, '../generated/js/splice-api-token-allocation-instruction-v1-1.0.0');
const TOKEN_TRANSFER_INSTRUCTION_DIR = path.join(__dirname, '../generated/js/splice-api-token-transfer-instruction-v1-1.0.0');
const TOKEN_ALLOCATION_DIR = path.join(__dirname, '../generated/js/splice-api-token-allocation-v1-1.0.0');
const DA_SET_TYPES_DIR = path.join(__dirname, '../generated/js/daml-stdlib-DA-Set-Types-1.0.0');

function createDirectoryIfNotExists(dirPath: string): void {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
}

function copyFile(src: string, dest: string): void {
	const destDir = path.dirname(dest);
	createDirectoryIfNotExists(destDir);
	fs.copyFileSync(src, dest);
}

function copyDirectory(src: string, dest: string): void {
	if (!fs.existsSync(dest)) {
		fs.mkdirSync(dest, { recursive: true });
	}
	const items = fs.readdirSync(src);
	for (const item of items) {
		const srcPath = path.join(src, item);
		const destPath = path.join(dest, item);
		const stat = fs.statSync(srcPath);
		if (stat.isDirectory()) {
			copyDirectory(srcPath, destPath);
		} else {
			copyFile(srcPath, destPath);
		}
	}
}

function createBundledFiles(targetDir: string): void {
	console.log('📦 Bundling DA.Internal.Template dependency...');
	const templateDir = path.join(targetDir, 'lib/DA/Internal/Template');
	createDirectoryIfNotExists(templateDir);

	const moduleSrc = path.join(DEPENDENCY_DIR, 'lib/DA/Internal/Template/module.js');
	const moduleDest = path.join(templateDir, 'module.js');
	const moduleDtsSrc = path.join(DEPENDENCY_DIR, 'lib/DA/Internal/Template/module.d.ts');
	const moduleDtsDest = path.join(templateDir, 'module.d.ts');

	if (fs.existsSync(moduleSrc)) {
		copyFile(moduleSrc, moduleDest);
		console.log('✅ Copied module.js');
	} else {
		console.log('⚠️  module.js not found in dependency, creating minimal version');
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

	const templateIndexDts = `export * from './module';
`;
	fs.writeFileSync(path.join(templateDir, 'index.d.ts'), templateIndexDts);

	const internalDir = path.join(targetDir, 'lib/DA/Internal');
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

	const internalIndexDts = `export * from './Template';
`;
	fs.writeFileSync(path.join(internalDir, 'index.d.ts'), internalIndexDts);

	const daDir = path.join(targetDir, 'lib/DA');
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

	const daIndexDts = `export * from './Internal';
`;
	fs.writeFileSync(path.join(daDir, 'index.d.ts'), daIndexDts);

	console.log('✅ Created bundled DA.Internal.Template structure');
}

function createBundledSpliceFiles(targetDir: string): void {
	console.log('📦 Bundling splice-api-featured-app-v1 dependency...');
	const spliceDir = path.join(targetDir, 'lib/Splice/Api/FeaturedAppRightV1');
	createDirectoryIfNotExists(spliceDir);

	const moduleSrc = path.join(SPLICE_DEPENDENCY_DIR, 'lib/Splice/Api/FeaturedAppRightV1/module.js');
	const moduleDest = path.join(spliceDir, 'module.js');
	const moduleDtsSrc = path.join(SPLICE_DEPENDENCY_DIR, 'lib/Splice/Api/FeaturedAppRightV1/module.d.ts');
	const moduleDtsDest = path.join(spliceDir, 'module.d.ts');

	if (fs.existsSync(moduleSrc)) {
		copyFile(moduleSrc, moduleDest);
		console.log('✅ Copied Splice module.js');
	} else {
		console.log('⚠️  Splice module.js not found in dependency, creating minimal version');
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

exports.FeaturedAppRight = {
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
		console.log('✅ Copied Splice module.d.ts');
	} else {
		console.log('⚠️  Splice module.d.ts not found in dependency, creating minimal version');
		const minimalModuleDts = `// Generated from Splice.Api.FeaturedAppRightV1.daml
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as jtv from '@mojotech/json-type-validation';
import * as damlTypes from '@daml/types';
/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
import * as damlLedger from '@daml/ledger';

export declare type FeaturedAppRight = {
};

export declare const FeaturedAppRight:
  damlTypes.Serializable<FeaturedAppRight> & {
  }
;
`;
		fs.writeFileSync(moduleDtsDest, minimalModuleDts);
	}

	const spliceIndex = `"use strict";
/* eslint-disable-next-line no-unused-vars */
function __export(m) {
/* eslint-disable-next-line no-prototype-builtins */
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });
__export(require('./module'));
`;
	fs.writeFileSync(path.join(spliceDir, 'index.js'), spliceIndex);

	const spliceIndexDts = `export * from './module';
`;
	fs.writeFileSync(path.join(spliceDir, 'index.d.ts'), spliceIndexDts);

	const apiDir = path.join(targetDir, 'lib/Splice/Api');
	createDirectoryIfNotExists(apiDir);
	const apiIndex = `"use strict";
/* eslint-disable-next-line no-unused-vars */
function __export(m) {
/* eslint-disable-next-line no-prototype-builtins */
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });
var FeaturedAppRightV1 = require('./FeaturedAppRightV1');
exports.FeaturedAppRightV1 = FeaturedAppRightV1;
`;
	fs.writeFileSync(path.join(apiDir, 'index.js'), apiIndex);

	const apiIndexDts = `export * from './FeaturedAppRightV1';
`;
	fs.writeFileSync(path.join(apiDir, 'index.d.ts'), apiIndexDts);

	const spliceMainDir = path.join(targetDir, 'lib/Splice');
	createDirectoryIfNotExists(spliceMainDir);
	const spliceMainIndex = `"use strict";
/* eslint-disable-next-line no-unused-vars */
function __export(m) {
/* eslint-disable-next-line no-prototype-builtins */
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });
var Api = require('./Api');
exports.Api = Api;
`;
	fs.writeFileSync(path.join(spliceMainDir, 'index.js'), spliceMainIndex);

	const spliceMainIndexDts = `export * from './Api';
`;
	fs.writeFileSync(path.join(spliceMainDir, 'index.d.ts'), spliceMainIndexDts);

	console.log('✅ Created bundled splice-api-featured-app-v1 structure');
}

function createBundledSpliceAmuletFiles(targetDir: string): void {
	console.log('📦 Bundling splice-amulet dependency...');
	const spliceDestDir = path.join(targetDir, 'lib/Splice');
	const spliceSourceDir = path.join(SPLICE_AMULET_DIR, 'lib/Splice');

	if (!fs.existsSync(spliceSourceDir)) {
		console.log('⚠️  splice-amulet Splice directory not found');
		return;
	}

	// Copy the entire Splice directory from splice-amulet
	copyDirectory(spliceSourceDir, spliceDestDir);
	console.log('✅ Copied splice-amulet Splice modules');
}

function createBundledDATimeTypesFiles(targetDir: string): void {
	console.log('📦 Bundling DA Time Types dependency...');
	const daDestDir = path.join(targetDir, 'lib/DA/Time');
	const daSourceDir = path.join(DA_TIME_TYPES_DIR, 'lib/DA/Time');

	if (!fs.existsSync(daSourceDir)) {
		console.log('⚠️  DA Time Types directory not found');
		return;
	}

	// Copy the DA/Time directory
	copyDirectory(daSourceDir, daDestDir);
	console.log('✅ Copied DA Time Types modules');
}

function createBundledDATypesFiles(targetDir: string): void {
	console.log('📦 Bundling DA Types dependency...');
	const daDestDir = path.join(targetDir, 'lib/DA/Types');
	const daSourceDir = path.join(DA_TYPES_DIR, 'lib/DA/Types');

	if (!fs.existsSync(daSourceDir)) {
		console.log('⚠️  DA Types directory not found');
		return;
	}

	// Copy the DA/Types directory
	copyDirectory(daSourceDir, daDestDir);
	console.log('✅ Copied DA Types modules');
}

function createBundledSpliceApiTokenDependencies(targetDir: string): void {
	console.log('📦 Bundling Splice API Token dependencies...');
	
	// Copy token metadata
	if (fs.existsSync(TOKEN_METADATA_DIR)) {
		const destDir = path.join(targetDir, 'lib/Splice/Api/Token/MetadataV1');
		const sourceDir = path.join(TOKEN_METADATA_DIR, 'lib/Splice/Api/Token/MetadataV1');
		if (fs.existsSync(sourceDir)) {
			copyDirectory(sourceDir, destDir);
			console.log('✅ Copied token-metadata-v1');
		}
	}
	
	// Copy token holding
	if (fs.existsSync(TOKEN_HOLDING_DIR)) {
		const destDir = path.join(targetDir, 'lib/Splice/Api/Token/HoldingV1');
		const sourceDir = path.join(TOKEN_HOLDING_DIR, 'lib/Splice/Api/Token/HoldingV1');
		if (fs.existsSync(sourceDir)) {
			copyDirectory(sourceDir, destDir);
			console.log('✅ Copied token-holding-v1');
		}
	}
	
	// Copy token allocation instruction
	if (fs.existsSync(TOKEN_ALLOCATION_INSTRUCTION_DIR)) {
		const destDir = path.join(targetDir, 'lib/Splice/Api/Token/AllocationInstructionV1');
		const sourceDir = path.join(TOKEN_ALLOCATION_INSTRUCTION_DIR, 'lib/Splice/Api/Token/AllocationInstructionV1');
		if (fs.existsSync(sourceDir)) {
			copyDirectory(sourceDir, destDir);
			console.log('✅ Copied token-allocation-instruction-v1');
		}
	}
	
	// Copy token transfer instruction
	if (fs.existsSync(TOKEN_TRANSFER_INSTRUCTION_DIR)) {
		const destDir = path.join(targetDir, 'lib/Splice/Api/Token/TransferInstructionV1');
		const sourceDir = path.join(TOKEN_TRANSFER_INSTRUCTION_DIR, 'lib/Splice/Api/Token/TransferInstructionV1');
		if (fs.existsSync(sourceDir)) {
			copyDirectory(sourceDir, destDir);
			console.log('✅ Copied token-transfer-instruction-v1');
		}
	}
	
	// Copy token allocation
	if (fs.existsSync(TOKEN_ALLOCATION_DIR)) {
		const destDir = path.join(targetDir, 'lib/Splice/Api/Token/AllocationV1');
		const sourceDir = path.join(TOKEN_ALLOCATION_DIR, 'lib/Splice/Api/Token/AllocationV1');
		if (fs.existsSync(sourceDir)) {
			copyDirectory(sourceDir, destDir);
			console.log('✅ Copied token-allocation-v1');
		}
	}
}

function createBundledDASetTypesFiles(targetDir: string): void {
	console.log('📦 Bundling DA Set Types dependency...');
	const daDestDir = path.join(targetDir, 'lib/DA/Set');
	const daSourceDir = path.join(DA_SET_TYPES_DIR, 'lib/DA/Set');

	if (!fs.existsSync(daSourceDir)) {
		console.log('⚠️  DA Set Types directory not found');
		return;
	}

	// Copy the DA/Set directory
	copyDirectory(daSourceDir, daDestDir);
	console.log('✅ Copied DA Set Types modules');
}

function updateMainIndex(targetDir: string): void {
	console.log('📝 Updating main index files...');

	const mainIndexPath = path.join(targetDir, 'lib/index.js');
	let mainIndex = fs.readFileSync(mainIndexPath, 'utf8');

	if (!mainIndex.includes("var DA = require('./DA')")) {
		const fairmintLine = mainIndex.indexOf('exports.Fairmint = Fairmint;');
		if (fairmintLine !== -1) {
			const insertPos = mainIndex.indexOf('\n', fairmintLine) + 1;
			const daImport = "var DA = require('./DA');\n";
			const daExport = 'exports.DA = DA\n'.replace('\n', '');
			mainIndex = mainIndex.slice(0, insertPos) + daImport + 'exports.DA = DA;\n' + mainIndex.slice(insertPos);
			fs.writeFileSync(mainIndexPath, mainIndex);
			console.log('✅ Updated main index.js with DA');
		}
	}

	if (!mainIndex.includes("var Splice = require('./Splice')")) {
		const fairmintLine = mainIndex.indexOf('exports.Fairmint = Fairmint;');
		if (fairmintLine !== -1) {
			const insertPos = mainIndex.indexOf('\n', fairmintLine) + 1;
			const spliceImport = "var Splice = require('./Splice');\n";
			mainIndex = mainIndex.slice(0, insertPos) + spliceImport + 'exports.Splice = Splice;\n' + mainIndex.slice(insertPos);
			fs.writeFileSync(mainIndexPath, mainIndex);
			console.log('✅ Updated main index.js with Splice');
		}
	}

	const mainIndexDtsPath = path.join(targetDir, 'lib/index.d.ts');
	let mainIndexDts = fs.readFileSync(mainIndexDtsPath, 'utf8');

	if (!mainIndexDts.includes("import * as DA from './DA'")) {
		const fairmintImport = mainIndexDts.indexOf("import * as Fairmint from './Fairmint';");
		if (fairmintImport !== -1) {
			const insertPos = mainIndexDts.indexOf('\n', fairmintImport) + 1;
			const daImport = "import * as DA from './DA';\n";
			mainIndexDts = mainIndexDts.slice(0, insertPos) + daImport + mainIndexDts.slice(insertPos);
			mainIndexDts = mainIndexDts.replace('export { Fairmint } ;', 'export { Fairmint, DA } ;');
			fs.writeFileSync(mainIndexDtsPath, mainIndexDts);
			console.log('✅ Updated main index.d.ts with DA');
		}
	}

	if (!mainIndexDts.includes("import * as Splice from './Splice'")) {
		const fairmintImport = mainIndexDts.indexOf("import * as Fairmint from './Fairmint';");
		if (fairmintImport !== -1) {
			const insertPos = mainIndexDts.indexOf('\n', fairmintImport) + 1;
			const spliceImport = "import * as Splice from './Splice';\n";
			mainIndexDts = mainIndexDts.slice(0, insertPos) + spliceImport + mainIndexDts.slice(insertPos);
			mainIndexDts = mainIndexDts.replace('export { Fairmint, DA } ;', 'export { Fairmint, DA, Splice } ;');
			fs.writeFileSync(mainIndexDtsPath, mainIndexDts);
			console.log('✅ Updated main index.d.ts with Splice');
		}
	}
}

function replaceDependencyReferences(targetDir: string): void {
	console.log('🔄 Replacing dependency references in generated files...');

	const filesToProcess: string[] = [];
	const findFiles = (dir: string) => {
		const files = fs.readdirSync(dir);
		for (const file of files) {
			const filePath = path.join(dir, file);
			const stat = fs.statSync(filePath);
			if (stat.isDirectory()) {
				findFiles(filePath);
			} else if (file.endsWith('.js') || file.endsWith('.d.ts')) {
				filesToProcess.push(filePath);
			}
		}
	};

	findFiles(path.join(targetDir, 'lib'));

	let replacedCount = 0;
	for (const filePath of filesToProcess) {
		let content = fs.readFileSync(filePath, 'utf8');
		const originalContent = content;
		const isDts = filePath.endsWith('.d.ts');

		if (content.includes('@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0')) {
			const relativePath = path
				.relative(path.dirname(filePath), path.join(targetDir, 'lib/DA/Internal/Template'))
				.replace(/\\/g, '/');
			console.log(`  Updating ${path.relative(targetDir, filePath)} with DA path: ${relativePath}`);
			if (isDts) {
				content = content.replace(
					/from '@daml\.js\/ghc-stdlib-DA-Internal-Template-1\.0\.0';/g,
					`from '${relativePath}';`,
				);
			} else {
				content = content.replace(
					/require\('@daml\.js\/ghc-stdlib-DA-Internal-Template-1\.0\.0'\)/g,
					`require('${relativePath}')`,
				);
			}
		}

		if (content.includes('@daml.js/splice-api-featured-app-v1-1.0.0')) {
			const relativePath = path
				.relative(path.dirname(filePath), path.join(targetDir, 'lib/Splice/Api/FeaturedAppRightV1'))
				.replace(/\\/g, '/');
			console.log(`  Updating ${path.relative(targetDir, filePath)} with Splice path: ${relativePath}`);
			if (isDts) {
				content = content.replace(
					/from '@daml\.js\/splice-api-featured-app-v1-1\.0\.0';/g,
					`from '${relativePath}';`,
				);
			} else {
				content = content.replace(
					/require\('@daml\.js\/splice-api-featured-app-v1-1\.0\.0'\)/g,
					`require('${relativePath}')`,
				);
			}
		}

		if (content.includes('@daml.js/splice-amulet-0.1.14')) {
			const relativePath = path
				.relative(path.dirname(filePath), path.join(targetDir, 'lib'))
				.replace(/\\/g, '/');
			console.log(`  Updating ${path.relative(targetDir, filePath)} with splice-amulet path: ${relativePath}`);
			if (isDts) {
				content = content.replace(
					/from '@daml\.js\/splice-amulet-0\.1\.14';/g,
					`from '${relativePath}';`,
				);
			} else {
				content = content.replace(
					/require\('@daml\.js\/splice-amulet-0\.1\.14'\)/g,
					`require('${relativePath}')`,
				);
			}
		}

		if (content.includes('@daml.js/daml-stdlib-DA-Time-Types-1.0.0')) {
			const relativePath = path
				.relative(path.dirname(filePath), path.join(targetDir, 'lib/DA/Time/Types'))
				.replace(/\\/g, '/');
			console.log(`  Updating ${path.relative(targetDir, filePath)} with DA Time Types path: ${relativePath}`);
			if (isDts) {
				content = content.replace(
					/from '@daml\.js\/daml-stdlib-DA-Time-Types-1\.0\.0';/g,
					`from '${relativePath}';`,
				);
			} else {
				content = content.replace(
					/require\('@daml\.js\/daml-stdlib-DA-Time-Types-1\.0\.0'\)/g,
					`require('${relativePath}')`,
				);
			}
		}

		if (content.includes('@daml.js/daml-prim-DA-Types-1.0.0')) {
			const relativePath = path
				.relative(path.dirname(filePath), path.join(targetDir, 'lib/DA/Types'))
				.replace(/\\/g, '/');
			console.log(`  Updating ${path.relative(targetDir, filePath)} with DA Types path: ${relativePath}`);
			if (isDts) {
				content = content.replace(
					/from '@daml\.js\/daml-prim-DA-Types-1\.0\.0';/g,
					`from '${relativePath}';`,
				);
			} else {
				content = content.replace(
					/require\('@daml\.js\/daml-prim-DA-Types-1\.0\.0'\)/g,
					`require('${relativePath}')`,
				);
			}
		}

		if (content.includes('@daml.js/splice-api-token-metadata-v1-1.0.0')) {
			const relativePath = path
				.relative(path.dirname(filePath), path.join(targetDir, 'lib/Splice/Api/Token/MetadataV1'))
				.replace(/\\/g, '/');
			if (isDts) {
				content = content.replace(
					/from '@daml\.js\/splice-api-token-metadata-v1-1\.0\.0';/g,
					`from '${relativePath}';`,
				);
			} else {
				content = content.replace(
					/require\('@daml\.js\/splice-api-token-metadata-v1-1\.0\.0'\)/g,
					`require('${relativePath}')`,
				);
			}
		}

		if (content.includes('@daml.js/splice-api-token-holding-v1-1.0.0')) {
			const relativePath = path
				.relative(path.dirname(filePath), path.join(targetDir, 'lib/Splice/Api/Token/HoldingV1'))
				.replace(/\\/g, '/');
			if (isDts) {
				content = content.replace(
					/from '@daml\.js\/splice-api-token-holding-v1-1\.0\.0';/g,
					`from '${relativePath}';`,
				);
			} else {
				content = content.replace(
					/require\('@daml\.js\/splice-api-token-holding-v1-1\.0\.0'\)/g,
					`require('${relativePath}')`,
				);
			}
		}

		if (content.includes('@daml.js/splice-api-token-allocation-instruction-v1-1.0.0')) {
			const relativePath = path
				.relative(path.dirname(filePath), path.join(targetDir, 'lib/Splice/Api/Token/AllocationInstructionV1'))
				.replace(/\\/g, '/');
			if (isDts) {
				content = content.replace(
					/from '@daml\.js\/splice-api-token-allocation-instruction-v1-1\.0\.0';/g,
					`from '${relativePath}';`,
				);
			} else {
				content = content.replace(
					/require\('@daml\.js\/splice-api-token-allocation-instruction-v1-1\.0\.0'\)/g,
					`require('${relativePath}')`,
				);
			}
		}

		if (content.includes('@daml.js/splice-api-token-transfer-instruction-v1-1.0.0')) {
			const relativePath = path
				.relative(path.dirname(filePath), path.join(targetDir, 'lib/Splice/Api/Token/TransferInstructionV1'))
				.replace(/\\/g, '/');
			if (isDts) {
				content = content.replace(
					/from '@daml\.js\/splice-api-token-transfer-instruction-v1-1\.0\.0';/g,
					`from '${relativePath}';`,
				);
			} else {
				content = content.replace(
					/require\('@daml\.js\/splice-api-token-transfer-instruction-v1-1\.0\.0'\)/g,
					`require('${relativePath}')`,
				);
			}
		}

		if (content.includes('@daml.js/splice-api-token-allocation-v1-1.0.0')) {
			const relativePath = path
				.relative(path.dirname(filePath), path.join(targetDir, 'lib/Splice/Api/Token/AllocationV1'))
				.replace(/\\/g, '/');
			if (isDts) {
				content = content.replace(
					/from '@daml\.js\/splice-api-token-allocation-v1-1\.0\.0';/g,
					`from '${relativePath}';`,
				);
			} else {
				content = content.replace(
					/require\('@daml\.js\/splice-api-token-allocation-v1-1\.0\.0'\)/g,
					`require('${relativePath}')`,
				);
			}
		}

		if (content.includes('@daml.js/daml-stdlib-DA-Set-Types-1.0.0')) {
			const relativePath = path
				.relative(path.dirname(filePath), path.join(targetDir, 'lib/DA/Set/Types'))
				.replace(/\\/g, '/');
			if (isDts) {
				content = content.replace(
					/from '@daml\.js\/daml-stdlib-DA-Set-Types-1\.0\.0';/g,
					`from '${relativePath}';`,
				);
			} else {
				content = content.replace(
					/require\('@daml\.js\/daml-stdlib-DA-Set-Types-1\.0\.0'\)/g,
					`require('${relativePath}')`,
				);
			}
		}

		if (content !== originalContent) {
			fs.writeFileSync(filePath, content);
			replacedCount++;
		}
	}

	console.log(`✅ Replaced dependency references in ${replacedCount} files`);
}

function removeLocalDependency(targetDir: string): void {
	console.log('🗑️  Removing local dependencies from package.json...');
	const packageJsonPath = path.join(targetDir, 'package.json');
	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as any;
	const localDependencies = [
		'@daml.js/ghc-stdlib-DA-Internal-Template-1.0.0',
		'@daml.js/splice-api-featured-app-v1-1.0.0',
		'@daml.js/splice-amulet-0.1.14',
		'@daml.js/daml-stdlib-DA-Time-Types-1.0.0',
		'@daml.js/daml-prim-DA-Types-1.0.0',
		'@daml.js/splice-api-token-metadata-v1-1.0.0',
		'@daml.js/splice-api-token-holding-v1-1.0.0',
		'@daml.js/splice-api-token-allocation-instruction-v1-1.0.0',
		'@daml.js/splice-api-token-transfer-instruction-v1-1.0.0',
		'@daml.js/splice-api-token-allocation-v1-1.0.0',
		'@daml.js/daml-stdlib-DA-Set-Types-1.0.0',
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

function main(): void {
	try {
		console.log('🚀 Starting dependency bundling process (TS)...');
		for (const targetDir of PACKAGE_DIRS) {
			if (!fs.existsSync(targetDir)) {
				console.log(`ℹ️  Skipping missing package dir: ${targetDir}`);
				continue;
			}
			console.log(`📦 Processing package: ${targetDir}`);
			createBundledFiles(targetDir);
			createBundledSpliceFiles(targetDir);
			// Only bundle splice-amulet and additional dependencies for Subscriptions package
			if (targetDir.includes('Subscriptions-v07')) {
				createBundledSpliceAmuletFiles(targetDir);
				createBundledDATimeTypesFiles(targetDir);
				createBundledDATypesFiles(targetDir);
				createBundledSpliceApiTokenDependencies(targetDir);
				createBundledDASetTypesFiles(targetDir);
			}
			updateMainIndex(targetDir);
			replaceDependencyReferences(targetDir);
			removeLocalDependency(targetDir);
		}
		console.log('✅ Dependency bundling completed successfully (TS)!');
		console.log('📦 Package is now ready for publishing to npm');
	} catch (error: any) {
		console.error('❌ Error during dependency bundling:', error?.message || error);
		process.exit(1);
	}
}

if (require.main === module) {
	main();
}

export { createBundledFiles, createBundledSpliceFiles, createBundledSpliceAmuletFiles, createBundledDATimeTypesFiles, createBundledDATypesFiles, createBundledSpliceApiTokenDependencies, createBundledDASetTypesFiles, updateMainIndex, replaceDependencyReferences, removeLocalDependency, main };
