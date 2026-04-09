import fs from 'fs';
import path from 'path';
import {
  createBundledDASetTypesFiles,
  createBundledSpliceApiTokenDependencies,
  ensureBundledDANamespaceIndexes,
  ensureBundledSpliceNamespaceIndexes,
} from './bundle-dependencies';
import { prepareMergedNftNamespace } from './nft-reference-bridge-rewrite';
import { requirePackageConfig } from './packages';

const ocpPkg = requirePackageConfig('ocp');
const reportsPkg = requirePackageConfig('reports');
const nftApiPkg = requirePackageConfig('nftApi');
const nftReferencePkg = requirePackageConfig('nftReference');
const paymentStreamsPkg = requirePackageConfig('paymentStreams');

const ROOT_DIR = path.join(__dirname, '..');
const OCP_DIR = path.join(ROOT_DIR, 'generated', 'js', `${ocpPkg.name}-${ocpPkg.version}`);
const REPORTS_DIR = path.join(ROOT_DIR, 'generated', 'js', `${reportsPkg.name}-${reportsPkg.version}`);
const NFT_API_DIR = path.join(ROOT_DIR, 'generated', 'js', `${nftApiPkg.name}-${nftApiPkg.version}`);
const NFT_REFERENCE_DIR = path.join(ROOT_DIR, 'generated', 'js', `${nftReferencePkg.name}-${nftReferencePkg.version}`);
const SUBSCRIPTIONS_DIR = path.join(
  ROOT_DIR,
  'generated',
  'js',
  `${paymentStreamsPkg.name}-${paymentStreamsPkg.version}`
);
const OCP_LIB = path.join(OCP_DIR, 'lib');
const REPORTS_LIB = path.join(REPORTS_DIR, 'lib');
const NFT_API_LIB = path.join(NFT_API_DIR, 'lib');
const NFT_REFERENCE_LIB = path.join(NFT_REFERENCE_DIR, 'lib');
const SUBSCRIPTIONS_LIB = path.join(SUBSCRIPTIONS_DIR, 'lib');
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

  const replacements = [
    {
      from: 'daml.js/ghc-stdlib-DA-Internal-Template-1.0.0',
      toDir: path.join(destLib, 'DA', 'Internal', 'Template'),
    },
    {
      from: 'daml.js/daml-stdlib-DA-Time-Types-1.0.0',
      toDir: path.join(destLib, 'DA', 'Time', 'Types'),
    },
    {
      from: 'daml.js/daml-prim-DA-Types-1.0.0',
      toDir: path.join(destLib, 'DA', 'Types'),
    },
    {
      from: 'daml.js/splice-api-token-metadata-v1-1.0.0',
      toDir: path.join(destLib, 'Splice', 'Api', 'Token', 'MetadataV1'),
    },
    {
      from: 'daml.js/splice-api-token-holding-v1-1.0.0',
      toDir: path.join(destLib, 'Splice', 'Api', 'Token', 'HoldingV1'),
    },
    {
      from: 'daml.js/splice-api-token-allocation-v1-1.0.0',
      toDir: path.join(destLib, 'Splice', 'Api', 'Token', 'AllocationV1'),
    },
  ];

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
  console.log('🧩 Building combined lib/ from generated packages...');
  rimraf(DEST_LIB);
  fs.mkdirSync(DEST_LIB, { recursive: true });

  // Copy DA and Splice from OCP first
  copyDir(path.join(OCP_LIB, 'DA'), path.join(DEST_LIB, 'DA'));
  copyDir(path.join(OCP_LIB, 'Splice'), path.join(DEST_LIB, 'Splice'));

  // Copy additional DA and Splice modules from Subscriptions (DA/Types, DA/Time/Types, etc.)
  // This will merge with what was already copied from OCP
  copyDir(path.join(SUBSCRIPTIONS_LIB, 'DA'), path.join(DEST_LIB, 'DA'));
  copyDir(path.join(SUBSCRIPTIONS_LIB, 'Splice'), path.join(DEST_LIB, 'Splice'));
  copyDir(path.join(REPORTS_LIB, '__bundled__'), path.join(DEST_LIB, '__bundled__'));
  copyDir(path.join(NFT_API_LIB, '__bundled__'), path.join(DEST_LIB, '__bundled__'));
  copyDir(path.join(NFT_REFERENCE_LIB, '__bundled__'), path.join(DEST_LIB, '__bundled__'));
  copyDir(path.join(SUBSCRIPTIONS_LIB, '__bundled__'), path.join(DEST_LIB, '__bundled__'));

  // Combine Fairmint sub-namespaces
  const destFairmint = path.join(DEST_LIB, 'Fairmint');
  copyDir(path.join(OCP_LIB, 'Fairmint', 'OpenCapTable'), path.join(destFairmint, 'OpenCapTable'));
  copyDir(path.join(REPORTS_LIB, 'Fairmint', 'OpenCapTableReports'), path.join(destFairmint, 'OpenCapTableReports'));

  // Combine NFT namespaces at root level
  const destNft = path.join(DEST_LIB, 'Nft');
  copyDir(path.join(NFT_API_LIB, 'Nft'), destNft);
  copyDir(path.join(NFT_REFERENCE_LIB, 'Nft'), destNft);

  // Copy CantonPayments at root level (not under Fairmint)
  copyDir(path.join(SUBSCRIPTIONS_LIB, 'CantonPayments'), path.join(DEST_LIB, 'CantonPayments'));

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

  const patchedNftReferenceFiles = prepareMergedNftNamespace(destNft, DEST_LIB);

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
var Nft = require('./Nft');
exports.Nft = Nft;
var CantonPayments = require('./CantonPayments');
exports.CantonPayments = CantonPayments;
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
import * as Nft from './Nft';
import * as CantonPayments from './CantonPayments';
import * as Splice from './Splice';
import * as DA from './DA';
import * as Fairmint_OpenCapTable_CapTable from './Fairmint/OpenCapTable/CapTable/module';
import * as Fairmint_OpenCapTable_IssuerAuthorization from './Fairmint/OpenCapTable/IssuerAuthorization/module';
import * as Fairmint_OpenCapTable_OcpFactory from './Fairmint/OpenCapTable/OcpFactory/module';
export { Fairmint, Nft, CantonPayments, DA, Splice } ;
export declare const OCP_TEMPLATES: {
  readonly capTable: typeof Fairmint_OpenCapTable_CapTable.CapTable.templateId;
  readonly issuerAuthorization: typeof Fairmint_OpenCapTable_IssuerAuthorization.IssuerAuthorization.templateId;
  readonly ocpFactory: typeof Fairmint_OpenCapTable_OcpFactory.OcpFactory.templateId;
};
`
  );

  if (patchedNftReferenceFiles > 0) {
    console.log(
      `✅ Patched ${patchedNftReferenceFiles} merged lib Nft/Reference files to use nft-api-v01 bridge import`
    );
  }

  // Merged `lib/Splice` can include Amulet without `Splice/Api/Token/*` (splice-amulet imports).
  // Bundle those token modules into the combined lib/ (same as CantonPayments package build).
  createBundledSpliceApiTokenDependencies(ROOT_DIR);
  createBundledDASetTypesFiles(ROOT_DIR);
  patchCombinedBundledDependencyImports(DEST_LIB);
  ensureBundledDANamespaceIndexes(ROOT_DIR);
  ensureBundledSpliceNamespaceIndexes(ROOT_DIR);

  console.log('✅ Combined lib/ created (factory JSON typings: types/*-factory-contract-id-json.d.ts)');
}

buildCombinedLib();
