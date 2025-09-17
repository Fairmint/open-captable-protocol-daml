import fs from 'fs';
import path from 'path';

const ROOT_DIR = path.join(__dirname, '..');
const OCP_DIR = path.join(ROOT_DIR, 'generated', 'js', 'OpenCapTable-v20-0.0.1');
const REPORTS_DIR = path.join(ROOT_DIR, 'generated', 'js', 'OpenCapTableReports-v01-0.0.2');
const OCP_LIB = path.join(OCP_DIR, 'lib');
const REPORTS_LIB = path.join(REPORTS_DIR, 'lib');
const DEST_LIB = path.join(ROOT_DIR, 'lib');

function rimraf(dir: string) {
	if (fs.existsSync(dir)) {
		for (const entry of fs.readdirSync(dir)) {
			const p = path.join(dir, entry);
			const stat = fs.lstatSync(p);
			if (stat.isDirectory()) rimraf(p);
			else fs.unlinkSync(p);
		}
		fs.rmdirSync(dir);
	}
}

function copyDir(src: string, dest: string) {
	if (!fs.existsSync(src)) return;
	fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src)) {
		const from = path.join(src, entry);
		const to = path.join(dest, entry);
		const stat = fs.lstatSync(from);
		if (stat.isDirectory()) copyDir(from, to);
		else fs.copyFileSync(from, to);
	}
}

function ensureFile(filePath: string, content: string) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
}

function buildCombinedLib() {
	console.log('🧩 Building combined lib/ from generated packages...');
	rimraf(DEST_LIB);
	fs.mkdirSync(DEST_LIB, { recursive: true });

	// Copy DA and Splice from OCP (identical across packages)
	copyDir(path.join(OCP_LIB, 'DA'), path.join(DEST_LIB, 'DA'));
	copyDir(path.join(OCP_LIB, 'Splice'), path.join(DEST_LIB, 'Splice'));

	// Combine Fairmint sub-namespaces
	const destFairmint = path.join(DEST_LIB, 'Fairmint');
	copyDir(path.join(OCP_LIB, 'Fairmint', 'OpenCapTable'), path.join(destFairmint, 'OpenCapTable'));
	copyDir(path.join(REPORTS_LIB, 'Fairmint', 'OpenCapTableReports'), path.join(destFairmint, 'OpenCapTableReports'));

	// Write Fairmint index.js and index.d.ts
	ensureFile(
		path.join(destFairmint, 'index.js'),
		`"use strict";
/* eslint-disable-next-line no-unused-vars */
function __export(m) {
/* eslint-disable-next-line no-prototype-builtins */
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });
var OpenCapTable = require('./OpenCapTable');
exports.OpenCapTable = OpenCapTable;
var OpenCapTableReports = require('./OpenCapTableReports');
exports.OpenCapTableReports = OpenCapTableReports;
`
	);
	ensureFile(
		path.join(destFairmint, 'index.d.ts'),
		`export * as OpenCapTable from './OpenCapTable';
export * as OpenCapTableReports from './OpenCapTableReports';
`
	);

	// Write root lib index.js and index.d.ts
	ensureFile(
		path.join(DEST_LIB, 'index.js'),
		`"use strict";
/* eslint-disable-next-line no-unused-vars */
function __export(m) {
/* eslint-disable-next-line no-prototype-builtins */
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });
var Fairmint = require('./Fairmint');
exports.Fairmint = Fairmint;
var DA = require('./DA');
exports.DA = DA;
var Splice = require('./Splice');
exports.Splice = Splice;
`
	);
	ensureFile(
		path.join(DEST_LIB, 'index.d.ts'),
		`import * as Fairmint from './Fairmint';
import * as Splice from './Splice';
import * as DA from './DA';
export { Fairmint, DA, Splice } ;
`
	);

	console.log('✅ Combined lib/ created');
}

function ensureJsonDts() {
	// Ensure .d.ts exists next to the generated JSONs for TS consumers
	const ensureJson = (jsonPath: string, dtsPath: string, dtsContent: string) => {
		if (fs.existsSync(jsonPath)) {
			fs.writeFileSync(dtsPath, dtsContent);
		} else {
			console.warn(`Warning: ${path.relative(ROOT_DIR, jsonPath)} not found; skipping .d.ts creation`);
		}
	};

	ensureJson(
		path.join(ROOT_DIR, 'generated', 'ocp-factory-contract-id.json'),
		path.join(ROOT_DIR, 'generated', 'ocp-factory-contract-id.json.d.ts'),
		`declare const data: {\n    mainnet: {\n        ocpFactoryContractId: string;\n        templateId: string;\n    };\n    devnet: {\n        ocpFactoryContractId: string;\n        templateId: string;\n    };\n};\nexport default data;\n`
	);

	ensureJson(
		path.join(ROOT_DIR, 'generated', 'reports-factory-contract-id.json'),
		path.join(ROOT_DIR, 'generated', 'reports-factory-contract-id.json.d.ts'),
		`declare const data: {\n    devnet: {\n        reportsFactoryContractId: string;\n        templateId: string;\n    };\n    mainnet: {\n        reportsFactoryContractId: string;\n        templateId: string;\n    };\n};\nexport default data;\n`
	);
}

buildCombinedLib();
ensureJsonDts();
console.log('Created combined lib and ensured JSON typings');
