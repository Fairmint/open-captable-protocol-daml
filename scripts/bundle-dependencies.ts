#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import {
  hasNftApiPackageNamespaceBridgeAtPackageRoot,
  hasNftApiPackageNamespaceBridgeUnderLib,
  patchNftReferenceGeneratedTree,
} from './nft-reference-bridge-rewrite';
import { requirePackageConfig } from './packages';
import { getErrorMessage, type PackageJson } from './types';

const ocpPkg = requirePackageConfig('ocp');
const reportsPkg = requirePackageConfig('reports');
const nftApiPkg = requirePackageConfig('nftApi');
const nftReferencePkg = requirePackageConfig('nftReference');
const nftIfacePkg = requirePackageConfig('nftIface');
const paymentStreamsPkg = requirePackageConfig('paymentStreams');

// Paths
const PACKAGE_DIRS = [
  path.join(__dirname, '../generated/js', `${ocpPkg.name}-${ocpPkg.version}`),
  path.join(__dirname, '../generated/js', `${reportsPkg.name}-${reportsPkg.version}`),
  path.join(__dirname, '../generated/js', `${nftApiPkg.name}-${nftApiPkg.version}`),
  path.join(__dirname, '../generated/js', `${nftReferencePkg.name}-${nftReferencePkg.version}`),
  path.join(__dirname, '../generated/js', `${paymentStreamsPkg.name}-${paymentStreamsPkg.version}`),
];
const DEPENDENCY_DIR = path.join(__dirname, '../generated/js/ghc-stdlib-DA-Internal-Template-1.0.0');
const SPLICE_DEPENDENCY_DIR = path.join(__dirname, '../generated/js/splice-api-featured-app-v1-1.0.0');
const SPLICE_AMULET_DIR = path.join(__dirname, '../generated/js/splice-amulet-0.1.14');
const DA_TIME_TYPES_DIR = path.join(__dirname, '../generated/js/daml-stdlib-DA-Time-Types-1.0.0');
const DA_TYPES_DIR = path.join(__dirname, '../generated/js/daml-prim-DA-Types-1.0.0');
const TOKEN_BURN_MINT_DIR = path.join(__dirname, '../generated/js/splice-api-token-burn-mint-v1-1.0.0');
const TOKEN_METADATA_DIR = path.join(__dirname, '../generated/js/splice-api-token-metadata-v1-1.0.0');
const TOKEN_HOLDING_DIR = path.join(__dirname, '../generated/js/splice-api-token-holding-v1-1.0.0');
const TOKEN_ALLOCATION_INSTRUCTION_DIR = path.join(
  __dirname,
  '../generated/js/splice-api-token-allocation-instruction-v1-1.0.0'
);
const TOKEN_TRANSFER_INSTRUCTION_DIR = path.join(
  __dirname,
  '../generated/js/splice-api-token-transfer-instruction-v1-1.0.0'
);
const TOKEN_ALLOCATION_DIR = path.join(__dirname, '../generated/js/splice-api-token-allocation-v1-1.0.0');
const DA_SET_TYPES_DIR = path.join(__dirname, '../generated/js/daml-stdlib-DA-Set-Types-1.0.0');
const OCP_PACKAGE_DIR = path.join(__dirname, '../generated/js', `${ocpPkg.name}-${ocpPkg.version}`);
const OCP_DAML_JS_IMPORT = `daml.js/${ocpPkg.name}-${ocpPkg.version}`;
/** Scoped package name from daml codegen (iface merged into NFT v01 lib/index). */
const NFT_IFACE_PACKAGE_IMPORT = `@daml.js/${nftIfacePkg.name}-${nftIfacePkg.version}`;
const NFT_IFACE_DAML_JS_IMPORT = `daml.js/${nftIfacePkg.name}-${nftIfacePkg.version}`;
const OCP_BUNDLED_WRAPPER_DIR = path.join('__bundled__', 'OpenCapTable');
const DA_INTERNAL_TEMPLATE_IMPORT = 'daml.js/ghc-stdlib-DA-Internal-Template-1.0.0';
const SPLICE_FEATURED_APP_IMPORT = 'daml.js/splice-api-featured-app-v1-1.0.0';
const SPLICE_AMULET_IMPORT = 'daml.js/splice-amulet-0.1.14';
const DA_TIME_TYPES_IMPORT = 'daml.js/daml-stdlib-DA-Time-Types-1.0.0';
const DA_TYPES_IMPORT = 'daml.js/daml-prim-DA-Types-1.0.0';
const TOKEN_BURN_MINT_IMPORT = 'daml.js/splice-api-token-burn-mint-v1-1.0.0';
const TOKEN_METADATA_IMPORT = 'daml.js/splice-api-token-metadata-v1-1.0.0';
const TOKEN_HOLDING_IMPORT = 'daml.js/splice-api-token-holding-v1-1.0.0';
const TOKEN_ALLOCATION_INSTRUCTION_IMPORT = 'daml.js/splice-api-token-allocation-instruction-v1-1.0.0';
const TOKEN_TRANSFER_INSTRUCTION_IMPORT = 'daml.js/splice-api-token-transfer-instruction-v1-1.0.0';
const TOKEN_ALLOCATION_IMPORT = 'daml.js/splice-api-token-allocation-v1-1.0.0';
const DA_SET_TYPES_IMPORT = 'daml.js/daml-stdlib-DA-Set-Types-1.0.0';

interface BundleRequirements {
  hasBundledOcp: boolean;
  hasBundledSpliceFeaturedApp: boolean;
  hasBundledSpliceAmulet: boolean;
  hasBundledDATimeTypes: boolean;
  hasBundledDATypes: boolean;
  hasBundledSpliceApiTokenDependencies: boolean;
  hasBundledDASetTypes: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function getImmediateChildDirs(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function writeNamespaceIndexFiles(dirPath: string, childNamespaces: string[]): void {
  if (childNamespaces.length === 0) {
    return;
  }

  createDirectoryIfNotExists(dirPath);

  const indexJs = `"use strict";
/* eslint-disable-next-line no-unused-vars */
function __export(m) {
/* eslint-disable-next-line no-prototype-builtins */
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });
${childNamespaces
  .map(
    (childNamespace) =>
      `var ${childNamespace} = require('./${childNamespace}');\nexports.${childNamespace} = ${childNamespace};`
  )
  .join('\n')}
`;
  fs.writeFileSync(path.join(dirPath, 'index.js'), indexJs);

  const indexDts = createNamespaceIndexDts(childNamespaces);
  fs.writeFileSync(path.join(dirPath, 'index.d.ts'), indexDts);
}

function createNamespaceIndexDts(childNamespaces: string[]): string {
  return `${childNamespaces
    .map((childNamespace) => `export * as ${childNamespace} from './${childNamespace}';`)
    .join('\n')}
`;
}

function removeDirectoryIfExists(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

function normalizeImportTarget(importPath: string): string {
  return path
    .normalize(importPath)
    .replace(/(\.d\.ts|\.js)$/, '')
    .replace(/[/\\]index$/, '');
}

function isWithinDir(dirPath: string, candidatePath: string): boolean {
  const normalizedDir = path.resolve(dirPath);
  const normalizedCandidate = path.resolve(candidatePath);
  return normalizedCandidate === normalizedDir || normalizedCandidate.startsWith(`${normalizedDir}${path.sep}`);
}

function getBundledArtifactDirs(targetDir: string): string[] {
  const bundledDirs = [
    path.join(targetDir, 'lib', 'Splice'),
    path.join(targetDir, 'lib', '__bundled__'),
    path.join(targetDir, 'lib', 'DA', 'Time'),
    path.join(targetDir, 'lib', 'DA', 'Types'),
    path.join(targetDir, 'lib', 'DA', 'Set'),
  ];

  if (path.resolve(targetDir) !== path.resolve(OCP_PACKAGE_DIR)) {
    bundledDirs.push(path.join(targetDir, 'lib', 'Fairmint', 'OpenCapTable'));
  }

  return bundledDirs;
}

function collectDependencyReferenceFiles(targetDir: string): string[] {
  const libDir = path.join(targetDir, 'lib');
  const ignoredDirs = getBundledArtifactDirs(targetDir);

  if (!fs.existsSync(libDir)) {
    return [];
  }

  const pendingDirs = [libDir];
  const files: string[] = [];

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop();
    if (!currentDir) continue;

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (ignoredDirs.some((ignoredDir) => isWithinDir(ignoredDir, entryPath))) {
          continue;
        }
        pendingDirs.push(entryPath);
        continue;
      }

      if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts'))) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function packageHasDependencyReference(targetDir: string, rawImports: string[], bundledTargets: string[]): boolean {
  const normalizedTargets = bundledTargets.map((bundledTarget) => normalizeImportTarget(bundledTarget));
  const moduleSpecifierPatterns = [/require\(['"]([^'"]+)['"]\)/g, /from ['"]([^'"]+)['"]/g];

  for (const filePath of collectDependencyReferenceFiles(targetDir)) {
    const fileContents = fs.readFileSync(filePath, 'utf8');

    if (rawImports.some((rawImport) => fileContents.includes(rawImport))) {
      return true;
    }

    for (const pattern of moduleSpecifierPatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null = pattern.exec(fileContents);

      while (match) {
        const specifier = match[1];
        if (specifier.startsWith('.')) {
          const resolvedImport = normalizeImportTarget(path.resolve(path.dirname(filePath), specifier));
          if (normalizedTargets.some((bundledTarget) => bundledTarget === resolvedImport)) {
            return true;
          }
        }

        match = pattern.exec(fileContents);
      }
    }
  }

  return false;
}

function collectBundleRequirements(targetDir: string): BundleRequirements {
  return {
    hasBundledOcp: packageHasDependencyReference(
      targetDir,
      [OCP_DAML_JS_IMPORT],
      [path.join(targetDir, 'lib', OCP_BUNDLED_WRAPPER_DIR)]
    ),
    hasBundledSpliceFeaturedApp: packageHasDependencyReference(
      targetDir,
      [SPLICE_FEATURED_APP_IMPORT],
      [path.join(targetDir, 'lib', 'Splice', 'Api', 'FeaturedAppRightV1')]
    ),
    hasBundledSpliceAmulet: packageHasDependencyReference(
      targetDir,
      [SPLICE_AMULET_IMPORT],
      [path.join(targetDir, 'lib')]
    ),
    hasBundledDATimeTypes: packageHasDependencyReference(
      targetDir,
      [DA_TIME_TYPES_IMPORT],
      [path.join(targetDir, 'lib', 'DA', 'Time', 'Types')]
    ),
    hasBundledDATypes: packageHasDependencyReference(
      targetDir,
      [DA_TYPES_IMPORT],
      [path.join(targetDir, 'lib', 'DA', 'Types')]
    ),
    hasBundledSpliceApiTokenDependencies: packageHasDependencyReference(
      targetDir,
      [
        TOKEN_BURN_MINT_IMPORT,
        TOKEN_METADATA_IMPORT,
        TOKEN_HOLDING_IMPORT,
        TOKEN_ALLOCATION_INSTRUCTION_IMPORT,
        TOKEN_TRANSFER_INSTRUCTION_IMPORT,
        TOKEN_ALLOCATION_IMPORT,
      ],
      [
        path.join(targetDir, 'lib', 'Splice', 'Api', 'Token', 'BurnMintV1'),
        path.join(targetDir, 'lib', 'Splice', 'Api', 'Token', 'MetadataV1'),
        path.join(targetDir, 'lib', 'Splice', 'Api', 'Token', 'HoldingV1'),
        path.join(targetDir, 'lib', 'Splice', 'Api', 'Token', 'AllocationInstructionV1'),
        path.join(targetDir, 'lib', 'Splice', 'Api', 'Token', 'TransferInstructionV1'),
        path.join(targetDir, 'lib', 'Splice', 'Api', 'Token', 'AllocationV1'),
      ]
    ),
    hasBundledDASetTypes: packageHasDependencyReference(
      targetDir,
      [DA_SET_TYPES_IMPORT],
      [path.join(targetDir, 'lib', 'DA', 'Set', 'Types')]
    ),
  };
}

function clearBundledArtifacts(targetDir: string): void {
  for (const bundledDir of getBundledArtifactDirs(targetDir)) {
    removeDirectoryIfExists(bundledDir);
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

  const internalIndexDts = createNamespaceIndexDts(['Template']);
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

  const daIndexDts = createNamespaceIndexDts(['Internal']);
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

  const apiIndexDts = createNamespaceIndexDts(['FeaturedAppRightV1']);
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

  const spliceMainIndexDts = createNamespaceIndexDts(['Api']);
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

  // Copy token burn/mint
  if (fs.existsSync(TOKEN_BURN_MINT_DIR)) {
    const destDir = path.join(targetDir, 'lib/Splice/Api/Token/BurnMintV1');
    const sourceDir = path.join(TOKEN_BURN_MINT_DIR, 'lib/Splice/Api/Token/BurnMintV1');
    if (fs.existsSync(sourceDir)) {
      copyDirectory(sourceDir, destDir);
      console.log('✅ Copied token-burn-mint-v1');
    }
  }

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

function ensureBundledSpliceNamespaceIndexes(targetDir: string): void {
  const spliceDir = path.join(targetDir, 'lib/Splice');
  const apiDir = path.join(spliceDir, 'Api');
  const tokenDir = path.join(apiDir, 'Token');

  const tokenNamespaces = getImmediateChildDirs(tokenDir);
  if (tokenNamespaces.length > 0) {
    writeNamespaceIndexFiles(tokenDir, tokenNamespaces);
  }

  const apiNamespaces = getImmediateChildDirs(apiDir);
  if (apiNamespaces.length > 0) {
    writeNamespaceIndexFiles(apiDir, apiNamespaces);
  }

  const spliceNamespaces = getImmediateChildDirs(spliceDir);
  if (spliceNamespaces.length > 0) {
    writeNamespaceIndexFiles(spliceDir, spliceNamespaces);
  }
}

/** Regenerate `lib/DA/index.js` and `index.d.ts` from actual child dirs (Internal, Time, Types, Set, …). */
function ensureBundledDANamespaceIndexes(targetDir: string): void {
  const daDir = path.join(targetDir, 'lib/DA');
  const daNamespaces = getImmediateChildDirs(daDir);
  if (daNamespaces.length > 0) {
    writeNamespaceIndexFiles(daDir, daNamespaces);
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

function createBundledOcpFiles(targetDir: string): void {
  console.log('📦 Bundling OpenCapTable dependency...');

  if (path.resolve(targetDir) !== path.resolve(OCP_PACKAGE_DIR)) {
    const ocpSourceDir = path.join(OCP_PACKAGE_DIR, 'lib/Fairmint/OpenCapTable');
    const ocpDestDir = path.join(targetDir, 'lib/Fairmint/OpenCapTable');

    if (!fs.existsSync(ocpSourceDir)) {
      console.log('⚠️  OpenCapTable dependency directory not found');
      return;
    }

    copyDirectory(ocpSourceDir, ocpDestDir);
    console.log('✅ Copied OpenCapTable modules');
  }

  const ocpWrapperDir = path.join(targetDir, 'lib', OCP_BUNDLED_WRAPPER_DIR);
  createDirectoryIfNotExists(ocpWrapperDir);

  const ocpWrapperIndex = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var OpenCapTable = require('../../Fairmint/OpenCapTable');
exports.Fairmint = {
  OpenCapTable: OpenCapTable,
};
`;
  fs.writeFileSync(path.join(ocpWrapperDir, 'index.js'), ocpWrapperIndex);

  const ocpWrapperIndexDts = `import * as OpenCapTable from '../../Fairmint/OpenCapTable';

export declare const Fairmint: {
  OpenCapTable: typeof OpenCapTable;
};
`;
  fs.writeFileSync(path.join(ocpWrapperDir, 'index.d.ts'), ocpWrapperIndexDts);
  console.log('✅ Created OpenCapTable dependency wrapper');
}

function normalizeMainIndexJs(content: string, hasSpliceDir: boolean): string {
  let normalizedContent = content
    .replace(/var DA = require\('\.\/DA'\);\nexports\.DA = DA;\n?/g, '')
    .replace(/var Splice = require\('\.\/Splice'\);\nexports\.Splice = Splice;\n?/g, '')
    .trimEnd();

  normalizedContent = `${normalizedContent}\nvar DA = require('./DA');\nexports.DA = DA;\n`;

  if (hasSpliceDir) {
    normalizedContent = `${normalizedContent}var Splice = require('./Splice');\nexports.Splice = Splice;\n`;
  }

  return normalizedContent;
}

function normalizeMainIndexDts(content: string, hasSpliceDir: boolean): string {
  const importsToAdd = ["import * as DA from './DA';"];
  if (hasSpliceDir) {
    importsToAdd.push("import * as Splice from './Splice';");
  }

  let normalizedContent = content
    .replace(/^import \* as DA from '\.\/DA';\n?/gm, '')
    .replace(/^import \* as Splice from '\.\/Splice';\n?/gm, '');

  const exportMatch = normalizedContent.match(/export \{([^}]*)\} ;/);
  const exportNames = exportMatch
    ? exportMatch[1]
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
        .filter((name) => name !== 'DA' && name !== 'Splice')
    : [];

  exportNames.push('DA');
  if (hasSpliceDir) {
    exportNames.push('Splice');
  }

  const exportLine = `export { ${[...new Set(exportNames)].join(', ')} } ;`;
  normalizedContent = exportMatch
    ? normalizedContent.replace(/export \{[^}]*\} ;/, exportLine)
    : `${normalizedContent.trimEnd()}\n${exportLine}\n`;

  const lines = normalizedContent.split('\n');
  const firstNonImportIndex = lines.findIndex((line) => line.trim() !== '' && !line.startsWith('import '));
  const insertIndex = firstNonImportIndex === -1 ? lines.length : firstNonImportIndex;
  lines.splice(insertIndex, 0, ...importsToAdd);

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

function updateMainIndex(targetDir: string): void {
  console.log('📝 Updating main index files...');
  const hasSpliceDir =
    fs.existsSync(path.join(targetDir, 'lib/Splice/index.js')) &&
    fs.existsSync(path.join(targetDir, 'lib/Splice/index.d.ts'));

  const mainIndexPath = path.join(targetDir, 'lib/index.js');
  const mainIndex = fs.readFileSync(mainIndexPath, 'utf8');
  const normalizedMainIndex = normalizeMainIndexJs(mainIndex, hasSpliceDir);
  if (normalizedMainIndex !== mainIndex) {
    fs.writeFileSync(mainIndexPath, normalizedMainIndex);
    console.log('✅ Updated main index.js');
  }

  const mainIndexDtsPath = path.join(targetDir, 'lib/index.d.ts');
  const mainIndexDts = fs.readFileSync(mainIndexDtsPath, 'utf8');
  const normalizedMainIndexDts = normalizeMainIndexDts(mainIndexDts, hasSpliceDir);
  if (normalizedMainIndexDts !== mainIndexDts) {
    fs.writeFileSync(mainIndexDtsPath, normalizedMainIndexDts);
    console.log('✅ Updated main index.d.ts');
  }
}

function replaceNftReferenceBridgeImports(targetDir: string): void {
  const referenceRoot = path.join(targetDir, 'lib', 'Nft', 'Reference');
  const bridgeOk =
    hasNftApiPackageNamespaceBridgeUnderLib(targetDir) || hasNftApiPackageNamespaceBridgeAtPackageRoot(targetDir);
  if (!fs.existsSync(referenceRoot) || !bridgeOk) {
    return;
  }

  const replacedCount = patchNftReferenceGeneratedTree(referenceRoot);
  if (replacedCount > 0) {
    console.log(`✅ Replaced NFT reference bridge imports in ${replacedCount} files`);
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

    if (content.includes('daml.js/ghc-stdlib-DA-Internal-Template-1.0.0')) {
      const relativePath = path
        .relative(path.dirname(filePath), path.join(targetDir, 'lib/DA/Internal/Template'))
        .replace(/\\/g, '/');
      console.log(`  Updating ${path.relative(targetDir, filePath)} with DA path: ${relativePath}`);
      if (isDts) {
        content = content.replace(
          /from 'daml.js\/ghc-stdlib-DA-Internal-Template-1\.0\.0';/g,
          `from '${relativePath}';`
        );
      } else {
        content = content.replace(
          /require\('daml.js\/ghc-stdlib-DA-Internal-Template-1\.0\.0'\)/g,
          `require('${relativePath}')`
        );
      }
    }

    if (content.includes(OCP_DAML_JS_IMPORT)) {
      const relativePath = path
        .relative(path.dirname(filePath), path.join(targetDir, 'lib', OCP_BUNDLED_WRAPPER_DIR))
        .replace(/\\/g, '/');
      // Package names include dots and other regex metacharacters, so escape before building the matcher.
      const escapedImport = escapeRegExp(OCP_DAML_JS_IMPORT);
      if (isDts) {
        content = content.replace(new RegExp(`from '${escapedImport}';`, 'g'), `from '${relativePath}';`);
      } else {
        content = content.replace(new RegExp(`require\\('${escapedImport}'\\)`, 'g'), `require('${relativePath}')`);
      }
    }

    if (content.includes(NFT_IFACE_PACKAGE_IMPORT) || content.includes(NFT_IFACE_DAML_JS_IMPORT)) {
      const indexEntry = path.join(targetDir, 'lib/index.js');
      const relativePath = path.relative(path.dirname(filePath), indexEntry).replace(/\\/g, '/');
      const escScoped = escapeRegExp(NFT_IFACE_PACKAGE_IMPORT);
      const escDamlJs = escapeRegExp(NFT_IFACE_DAML_JS_IMPORT);
      if (isDts) {
        content = content.replace(new RegExp(`from '${escScoped}';`, 'g'), `from '${relativePath}';`);
        content = content.replace(new RegExp(`from '${escDamlJs}';`, 'g'), `from '${relativePath}';`);
      } else {
        content = content.replace(new RegExp(`require\\('${escScoped}'\\)`, 'g'), `require('${relativePath}')`);
        content = content.replace(new RegExp(`require\\('${escDamlJs}'\\)`, 'g'), `require('${relativePath}')`);
      }
    }

    if (content.includes('daml.js/splice-api-featured-app-v1-1.0.0')) {
      const relativePath = path
        .relative(path.dirname(filePath), path.join(targetDir, 'lib/Splice/Api/FeaturedAppRightV1'))
        .replace(/\\/g, '/');
      console.log(`  Updating ${path.relative(targetDir, filePath)} with Splice path: ${relativePath}`);
      if (isDts) {
        content = content.replace(/from 'daml.js\/splice-api-featured-app-v1-1\.0\.0';/g, `from '${relativePath}';`);
      } else {
        content = content.replace(
          /require\('daml.js\/splice-api-featured-app-v1-1\.0\.0'\)/g,
          `require('${relativePath}')`
        );
      }
    }

    if (content.includes('daml.js/splice-amulet-0.1.14')) {
      const relativePath = path.relative(path.dirname(filePath), path.join(targetDir, 'lib')).replace(/\\/g, '/');
      console.log(`  Updating ${path.relative(targetDir, filePath)} with splice-amulet path: ${relativePath}`);
      if (isDts) {
        content = content.replace(/from 'daml.js\/splice-amulet-0\.1\.14';/g, `from '${relativePath}';`);
      } else {
        content = content.replace(/require\('daml.js\/splice-amulet-0\.1\.14'\)/g, `require('${relativePath}')`);
      }
    }

    if (content.includes('daml.js/daml-stdlib-DA-Time-Types-1.0.0')) {
      const relativePath = path
        .relative(path.dirname(filePath), path.join(targetDir, 'lib/DA/Time/Types'))
        .replace(/\\/g, '/');
      console.log(`  Updating ${path.relative(targetDir, filePath)} with DA Time Types path: ${relativePath}`);
      if (isDts) {
        content = content.replace(/from 'daml.js\/daml-stdlib-DA-Time-Types-1\.0\.0';/g, `from '${relativePath}';`);
      } else {
        content = content.replace(
          /require\('daml.js\/daml-stdlib-DA-Time-Types-1\.0\.0'\)/g,
          `require('${relativePath}')`
        );
      }
    }

    if (content.includes('daml.js/daml-prim-DA-Types-1.0.0')) {
      const relativePath = path
        .relative(path.dirname(filePath), path.join(targetDir, 'lib/DA/Types'))
        .replace(/\\/g, '/');
      console.log(`  Updating ${path.relative(targetDir, filePath)} with DA Types path: ${relativePath}`);
      if (isDts) {
        content = content.replace(/from 'daml.js\/daml-prim-DA-Types-1\.0\.0';/g, `from '${relativePath}';`);
      } else {
        content = content.replace(/require\('daml.js\/daml-prim-DA-Types-1\.0\.0'\)/g, `require('${relativePath}')`);
      }
    }

    if (content.includes('daml.js/splice-api-token-metadata-v1-1.0.0')) {
      const relativePath = path
        .relative(path.dirname(filePath), path.join(targetDir, 'lib/Splice/Api/Token/MetadataV1'))
        .replace(/\\/g, '/');
      if (isDts) {
        content = content.replace(/from 'daml.js\/splice-api-token-metadata-v1-1\.0\.0';/g, `from '${relativePath}';`);
      } else {
        content = content.replace(
          /require\('daml.js\/splice-api-token-metadata-v1-1\.0\.0'\)/g,
          `require('${relativePath}')`
        );
      }
    }

    if (content.includes('daml.js/splice-api-token-burn-mint-v1-1.0.0')) {
      const relativePath = path
        .relative(path.dirname(filePath), path.join(targetDir, 'lib/Splice/Api/Token/BurnMintV1'))
        .replace(/\\/g, '/');
      if (isDts) {
        content = content.replace(/from 'daml.js\/splice-api-token-burn-mint-v1-1\.0\.0';/g, `from '${relativePath}';`);
      } else {
        content = content.replace(
          /require\('daml.js\/splice-api-token-burn-mint-v1-1\.0\.0'\)/g,
          `require('${relativePath}')`
        );
      }
    }

    if (content.includes('daml.js/splice-api-token-holding-v1-1.0.0')) {
      const relativePath = path
        .relative(path.dirname(filePath), path.join(targetDir, 'lib/Splice/Api/Token/HoldingV1'))
        .replace(/\\/g, '/');
      if (isDts) {
        content = content.replace(/from 'daml.js\/splice-api-token-holding-v1-1\.0\.0';/g, `from '${relativePath}';`);
      } else {
        content = content.replace(
          /require\('daml.js\/splice-api-token-holding-v1-1\.0\.0'\)/g,
          `require('${relativePath}')`
        );
      }
    }

    if (content.includes('daml.js/splice-api-token-allocation-instruction-v1-1.0.0')) {
      const relativePath = path
        .relative(path.dirname(filePath), path.join(targetDir, 'lib/Splice/Api/Token/AllocationInstructionV1'))
        .replace(/\\/g, '/');
      if (isDts) {
        content = content.replace(
          /from 'daml.js\/splice-api-token-allocation-instruction-v1-1\.0\.0';/g,
          `from '${relativePath}';`
        );
      } else {
        content = content.replace(
          /require\('daml.js\/splice-api-token-allocation-instruction-v1-1\.0\.0'\)/g,
          `require('${relativePath}')`
        );
      }
    }

    if (content.includes('daml.js/splice-api-token-transfer-instruction-v1-1.0.0')) {
      const relativePath = path
        .relative(path.dirname(filePath), path.join(targetDir, 'lib/Splice/Api/Token/TransferInstructionV1'))
        .replace(/\\/g, '/');
      if (isDts) {
        content = content.replace(
          /from 'daml.js\/splice-api-token-transfer-instruction-v1-1\.0\.0';/g,
          `from '${relativePath}';`
        );
      } else {
        content = content.replace(
          /require\('daml.js\/splice-api-token-transfer-instruction-v1-1\.0\.0'\)/g,
          `require('${relativePath}')`
        );
      }
    }

    if (content.includes('daml.js/splice-api-token-allocation-v1-1.0.0')) {
      const relativePath = path
        .relative(path.dirname(filePath), path.join(targetDir, 'lib/Splice/Api/Token/AllocationV1'))
        .replace(/\\/g, '/');
      if (isDts) {
        content = content.replace(
          /from 'daml.js\/splice-api-token-allocation-v1-1\.0\.0';/g,
          `from '${relativePath}';`
        );
      } else {
        content = content.replace(
          /require\('daml.js\/splice-api-token-allocation-v1-1\.0\.0'\)/g,
          `require('${relativePath}')`
        );
      }
    }

    if (content.includes('daml.js/daml-stdlib-DA-Set-Types-1.0.0')) {
      const relativePath = path
        .relative(path.dirname(filePath), path.join(targetDir, 'lib/DA/Set/Types'))
        .replace(/\\/g, '/');
      if (isDts) {
        content = content.replace(/from 'daml.js\/daml-stdlib-DA-Set-Types-1\.0\.0';/g, `from '${relativePath}';`);
      } else {
        content = content.replace(
          /require\('daml.js\/daml-stdlib-DA-Set-Types-1\.0\.0'\)/g,
          `require('${relativePath}')`
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
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJson;
  const localDependencies = [
    DA_INTERNAL_TEMPLATE_IMPORT,
    OCP_DAML_JS_IMPORT,
    NFT_IFACE_PACKAGE_IMPORT,
    SPLICE_FEATURED_APP_IMPORT,
    SPLICE_AMULET_IMPORT,
    DA_TIME_TYPES_IMPORT,
    DA_TYPES_IMPORT,
    TOKEN_BURN_MINT_IMPORT,
    TOKEN_METADATA_IMPORT,
    TOKEN_HOLDING_IMPORT,
    TOKEN_ALLOCATION_INSTRUCTION_IMPORT,
    TOKEN_TRANSFER_INSTRUCTION_IMPORT,
    TOKEN_ALLOCATION_IMPORT,
    DA_SET_TYPES_IMPORT,
  ];
  let removedCount = 0;
  for (const dep of localDependencies) {
    if (packageJson.dependencies?.[dep]) {
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
      clearBundledArtifacts(targetDir);
      // Detect dependency references from the surviving generated modules after stale bundled output is removed.
      const bundleRequirements = collectBundleRequirements(targetDir);
      createBundledFiles(targetDir);

      if (bundleRequirements.hasBundledOcp) {
        createBundledOcpFiles(targetDir);
      }

      if (bundleRequirements.hasBundledSpliceFeaturedApp) {
        createBundledSpliceFiles(targetDir);
      }

      if (bundleRequirements.hasBundledSpliceAmulet) {
        createBundledSpliceAmuletFiles(targetDir);
      }

      if (bundleRequirements.hasBundledDATimeTypes) {
        createBundledDATimeTypesFiles(targetDir);
      }

      if (bundleRequirements.hasBundledDATypes) {
        createBundledDATypesFiles(targetDir);
      }

      if (bundleRequirements.hasBundledSpliceApiTokenDependencies) {
        createBundledSpliceApiTokenDependencies(targetDir);
      }

      if (bundleRequirements.hasBundledDASetTypes) {
        createBundledDASetTypesFiles(targetDir);
      }
      ensureBundledDANamespaceIndexes(targetDir);
      ensureBundledSpliceNamespaceIndexes(targetDir);
      updateMainIndex(targetDir);
      replaceDependencyReferences(targetDir);
      replaceNftReferenceBridgeImports(targetDir);
      removeLocalDependency(targetDir);
    }
    console.log('✅ Dependency bundling completed successfully (TS)!');
    console.log('📦 Package is now ready for publishing to npm');
  } catch (error) {
    console.error('❌ Error during dependency bundling:', getErrorMessage(error));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export {
  collectBundleRequirements,
  createBundledDASetTypesFiles,
  createBundledDATimeTypesFiles,
  createBundledDATypesFiles,
  createBundledFiles,
  createBundledOcpFiles,
  createBundledSpliceAmuletFiles,
  createBundledSpliceApiTokenDependencies,
  createBundledSpliceFiles,
  ensureBundledDANamespaceIndexes,
  ensureBundledSpliceNamespaceIndexes,
  main,
  removeLocalDependency,
  replaceDependencyReferences,
  updateMainIndex,
};
