import fs from 'fs';
import path from 'path';
import {
  createBundledDASetTypesFiles,
  createBundledDATimeTypesFiles,
  createBundledDATypesFiles,
  createBundledSpliceApiTokenDependencies,
  ensureBundledDANamespaceIndexes,
  ensureBundledSpliceNamespaceIndexes,
} from './bundle-dependencies';
import { requirePackageConfig } from './packages';

const ocpPkg = requirePackageConfig('ocp');

const ROOT_DIR = path.join(__dirname, '..');
const OCP_DIR = path.join(ROOT_DIR, 'generated', 'js', `${ocpPkg.name}-${ocpPkg.version}`);
const OCP_LIB = path.join(OCP_DIR, 'lib');
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
function patchCombinedBundledDependencyImports(destLib: string) {
  const spliceRoot = path.join(destLib, 'Splice');
  if (!fs.existsSync(spliceRoot)) {
    return;
  }

  const dependencyTargets = [
    {
      packageName: 'ghc-stdlib-DA-Internal-Template-1.0.0',
      toDir: path.join(destLib, 'DA', 'Internal', 'Template'),
    },
    {
      packageName: 'daml-stdlib-DA-Time-Types-1.0.0',
      toDir: path.join(destLib, 'DA', 'Time', 'Types'),
    },
    {
      packageName: 'daml-prim-DA-Types-1.0.0',
      toDir: path.join(destLib, 'DA', 'Types'),
    },
    {
      packageName: 'daml-stdlib-DA-Set-Types-1.0.0',
      toDir: path.join(destLib, 'DA', 'Set', 'Types'),
    },
    {
      packageName: 'splice-api-token-burn-mint-v1-1.0.0',
      toDir: path.join(destLib, 'Splice', 'Api', 'Token', 'BurnMintV1'),
    },
    {
      packageName: 'splice-api-token-metadata-v1-1.0.0',
      toDir: path.join(destLib, 'Splice', 'Api', 'Token', 'MetadataV1'),
    },
    {
      packageName: 'splice-api-token-holding-v1-1.0.0',
      toDir: path.join(destLib, 'Splice', 'Api', 'Token', 'HoldingV1'),
    },
    {
      packageName: 'splice-api-token-allocation-instruction-v1-1.0.0',
      toDir: path.join(destLib, 'Splice', 'Api', 'Token', 'AllocationInstructionV1'),
    },
    {
      packageName: 'splice-api-token-transfer-instruction-v1-1.0.0',
      toDir: path.join(destLib, 'Splice', 'Api', 'Token', 'TransferInstructionV1'),
    },
    {
      packageName: 'splice-api-token-allocation-v1-1.0.0',
      toDir: path.join(destLib, 'Splice', 'Api', 'Token', 'AllocationV1'),
    },
    {
      packageName: 'splice-api-featured-app-v1-1.0.0',
      toDir: path.join(destLib, 'Splice', 'Api', 'FeaturedAppRightV1'),
    },
    {
      packageName: 'splice-api-featured-app-v2-1.0.0',
      toDir: path.join(destLib, 'Splice', 'Api', 'FeaturedAppRightV2'),
    },
  ];
  const replacements = dependencyTargets.flatMap(({ packageName, toDir }) => [
    { from: `daml.js/${packageName}`, toDir },
    { from: `@daml.js/${packageName}`, toDir },
  ]);

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts')) {
        continue;
      }

      const text = fs.readFileSync(full, 'utf8');
      let next = text;
      for (const replacement of replacements) {
        if (!next.includes(replacement.from)) {
          continue;
        }
        const relativePath = path.relative(path.dirname(full), replacement.toDir).replace(/\\/g, '/');
        next = next
          .split(`require('${replacement.from}')`)
          .join(`require('${relativePath}')`)
          .split(`require("${replacement.from}")`)
          .join(`require("${relativePath}")`)
          .split(`from '${replacement.from}'`)
          .join(`from '${relativePath}'`)
          .split(`from "${replacement.from}"`)
          .join(`from "${relativePath}"`);
      }

      if (next !== text) {
        fs.writeFileSync(full, next);
      }
    }
  };

  walk(spliceRoot);
}

function buildCombinedLib() {
  console.log('🧩 Building combined lib/ from OpenCapTable-v36 codegen only...');
  rimraf(DEST_LIB);
  fs.mkdirSync(DEST_LIB, { recursive: true });

  copyDir(path.join(OCP_LIB, 'DA'), path.join(DEST_LIB, 'DA'));
  copyDir(path.join(OCP_LIB, 'Splice'), path.join(DEST_LIB, 'Splice'));

  const featuredAppV2Dest = path.join(DEST_LIB, 'Splice', 'Api', 'FeaturedAppRightV2');
  const featuredAppV2Src = path.join(
    ROOT_DIR,
    'generated/js/splice-api-featured-app-v2-1.0.0/lib/Splice/Api/FeaturedAppRightV2'
  );
  if (!fs.existsSync(featuredAppV2Dest) && fs.existsSync(featuredAppV2Src)) {
    copyDir(featuredAppV2Src, featuredAppV2Dest);
  }

  copyDir(path.join(OCP_LIB, '__bundled__'), path.join(DEST_LIB, '__bundled__'));

  const destFairmint = path.join(DEST_LIB, 'Fairmint');
  copyDir(path.join(OCP_LIB, 'Fairmint', 'OpenCapTable'), path.join(destFairmint, 'OpenCapTable'));

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
`
  );
  ensureFile(
    path.join(destFairmint, 'index.d.ts'),
    `export * as OpenCapTable from './OpenCapTable';
`
  );

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
var Fairmint_OpenCapTable_CapTable = require('./Fairmint/OpenCapTable/CapTable/module');
var Fairmint_OpenCapTable_IssuerAuthorization = require('./Fairmint/OpenCapTable/IssuerAuthorization/module');
var Fairmint_OpenCapTable_OcpFactory = require('./Fairmint/OpenCapTable/OcpFactory/module');
exports.OCP_TEMPLATES = Object.freeze({
    capTable: Fairmint_OpenCapTable_CapTable.CapTable.templateId,
    issuerAuthorization: Fairmint_OpenCapTable_IssuerAuthorization.IssuerAuthorization.templateId,
    ocpFactory: Fairmint_OpenCapTable_OcpFactory.OcpFactory.templateId,
});
`
  );
  ensureFile(
    path.join(DEST_LIB, 'index.d.ts'),
    `import * as Fairmint from './Fairmint';
import * as Splice from './Splice';
import * as DA from './DA';
import * as Fairmint_OpenCapTable_CapTable from './Fairmint/OpenCapTable/CapTable/module';
import * as Fairmint_OpenCapTable_IssuerAuthorization from './Fairmint/OpenCapTable/IssuerAuthorization/module';
import * as Fairmint_OpenCapTable_OcpFactory from './Fairmint/OpenCapTable/OcpFactory/module';
export { Fairmint, DA, Splice } ;
export declare const OCP_TEMPLATES: {
  readonly capTable: typeof Fairmint_OpenCapTable_CapTable.CapTable.templateId;
  readonly issuerAuthorization: typeof Fairmint_OpenCapTable_IssuerAuthorization.IssuerAuthorization.templateId;
  readonly ocpFactory: typeof Fairmint_OpenCapTable_OcpFactory.OcpFactory.templateId;
};
`
  );

  createBundledDATimeTypesFiles(ROOT_DIR);
  createBundledDATypesFiles(ROOT_DIR);
  createBundledSpliceApiTokenDependencies(ROOT_DIR);
  createBundledDASetTypesFiles(ROOT_DIR);
  patchCombinedBundledDependencyImports(DEST_LIB);
  ensureBundledDANamespaceIndexes(ROOT_DIR);
  ensureBundledSpliceNamespaceIndexes(ROOT_DIR);

  console.log('✅ Combined lib/ created (OpenCapTable-v36 + OCP_TEMPLATES)');
}

buildCombinedLib();
