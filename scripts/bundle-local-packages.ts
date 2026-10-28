#!/usr/bin/env tsx
/**
 * Bundle this repository's sibling Daml packages into the merged `lib/`.
 *
 * `canton-dev-tools create-root-index` builds `lib/` from one codegen package (`rootIndex.sourcePackage` in
 * `daml-js-bundle.json`, OpenCapTable-v36). That package's generated JS imports its data-dependencies from this
 * repository (OpenCapTableApi-v01) as `daml.js/<name>-<version>`, which no canton-dev-tools preset bundles. This step,
 * run between `create-root-index` and `fix-splice-refs --target lib`:
 *
 * 1. Copies each sibling's `lib/Fairmint/<Namespace>` trees into `lib/Fairmint/`, and any `lib/__bundled__/<dep>` the
 *    merged lib lacks;
 * 2. Writes `lib/__bundled__/<name-without-version>/index.{js,d.ts}`, exporting `Fairmint.<Namespace>` from those copies
 *    and the sibling's `packageId`;
 * 3. Regenerates `lib/Fairmint/index.{js,d.ts}` so the root `Fairmint` export includes every namespace.
 *
 * `fix-splice-refs --target lib` then rewrites the `daml.js/<name>-<version>` imports onto `lib/__bundled__/<name>`.
 *
 * Usage: tsx scripts/bundle-local-packages.ts
 */

import {
  copyDirectory,
  discoverCodegenPackages,
  getImmediateChildDirs,
  resolveDamlJsBundleConfig,
  writeNamespaceIndexFiles,
} from '@fairmint/canton-dev-tools/daml';
import * as fs from 'fs';
import * as path from 'path';
import { getErrorMessage } from './types';

const ROOT_DIR = path.join(__dirname, '..');

/** Top-level entries of a sibling's generated `lib/` that this step knows how to merge. */
const MERGEABLE_TOP_LEVEL = new Set(['Fairmint', 'DA', '__bundled__', 'index.js', 'index.d.ts']);

export interface BundledSibling {
  name: string;
  version: string;
  bundledName: string;
  namespaces: string[];
  packageId: string;
}

export function stripTrailingSemver(packageName: string): string {
  return packageName.replace(/-\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]*)?$/, '');
}

/** Read `exports.packageId = '<hex>'` from a generated package's `lib/index.js`. */
export function readGeneratedPackageId(indexJs: string): string {
  const match = /exports\.packageId\s*=\s*'([0-9a-f]{64})'/.exec(indexJs);
  if (!match) {
    throw new Error('generated lib/index.js does not export a packageId');
  }
  return match[1];
}

function indexJsHeader(): string {
  return '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n';
}

/** Index files for `lib/__bundled__/<bundledName>/`, which stands in for the sibling's generated package root. */
export function renderBundledIndex(namespaces: string[], packageId: string): Record<string, string> {
  const fairmintJs = namespaces
    .map((ns) => `var ${ns} = require('../../../Fairmint/${ns}');\nexports.${ns} = ${ns};`)
    .join('\n');
  const fairmintDts = namespaces.map((ns) => `export * as ${ns} from '../../../Fairmint/${ns}';`).join('\n');
  return {
    'index.js': `${indexJsHeader()}var Fairmint = require('./Fairmint');\nexports.Fairmint = Fairmint;\nexports.packageId = '${packageId}';\n`,
    'index.d.ts': `export * as Fairmint from './Fairmint';\nexport declare const packageId = '${packageId}';\n`,
    'Fairmint/index.js': `${indexJsHeader()}${fairmintJs}\n`,
    'Fairmint/index.d.ts': `${fairmintDts}\n`,
  };
}

function bundleSibling(libDir: string, siblingLib: string, name: string, version: string): BundledSibling {
  for (const entry of fs.readdirSync(siblingLib)) {
    if (!MERGEABLE_TOP_LEVEL.has(entry)) {
      throw new Error(`${name}: unsupported top-level entry lib/${entry} in generated JS`);
    }
  }

  const namespaces = getImmediateChildDirs(path.join(siblingLib, 'Fairmint'));
  if (namespaces.length === 0) {
    throw new Error(`${name}: generated lib/Fairmint has no namespaces`);
  }
  for (const ns of namespaces) {
    const dest = path.join(libDir, 'Fairmint', ns);
    if (fs.existsSync(dest)) {
      throw new Error(`${name}: lib/Fairmint/${ns} already exists; two packages define the same namespace`);
    }
    copyDirectory(path.join(siblingLib, 'Fairmint', ns), dest);
  }

  // The sibling's own bundled stdlib modules; the merged lib usually has them already.
  for (const dep of getImmediateChildDirs(path.join(siblingLib, '__bundled__'))) {
    const dest = path.join(libDir, '__bundled__', dep);
    if (!fs.existsSync(dest)) {
      copyDirectory(path.join(siblingLib, '__bundled__', dep), dest);
    }
  }
  for (const daNamespace of getImmediateChildDirs(path.join(siblingLib, 'DA'))) {
    if (!fs.existsSync(path.join(libDir, 'DA', daNamespace))) {
      throw new Error(
        `${name}: needs lib/DA/${daNamespace}, which the merged lib lacks; add its preset to daml-js-bundle.json`
      );
    }
  }

  const packageId = readGeneratedPackageId(fs.readFileSync(path.join(siblingLib, 'index.js'), 'utf8'));
  const bundledName = stripTrailingSemver(`${name}-${version}`);
  const bundledDir = path.join(libDir, '__bundled__', bundledName);
  if (fs.existsSync(bundledDir)) {
    throw new Error(`${name}: lib/__bundled__/${bundledName} already exists`);
  }
  for (const [rel, contents] of Object.entries(renderBundledIndex(namespaces, packageId))) {
    const file = path.join(bundledDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return { name, version, bundledName, namespaces, packageId };
}

export function bundleLocalPackages(rootDir: string = ROOT_DIR): BundledSibling[] {
  const config = resolveDamlJsBundleConfig({ rootDir });
  const { rootIndex } = config;
  const sourceName = rootIndex?.sourcePackage.name;
  if (!rootIndex || !sourceName) {
    throw new Error('daml-js-bundle.json rootIndex.sourcePackage must name the source package exactly ("name")');
  }
  const libDir = path.resolve(rootDir, rootIndex.outputDir ?? 'lib');
  if (!fs.existsSync(path.join(libDir, 'Fairmint'))) {
    throw new Error(
      `${path.relative(rootDir, libDir)}/Fairmint not found. Run canton-dev-tools create-root-index first.`
    );
  }

  const siblings = discoverCodegenPackages({ rootDir, generatedJsRoot: config.generatedJsDir }).filter(
    (pkg) => pkg.name !== sourceName
  );
  const bundled = siblings.map((pkg) => {
    if (!fs.existsSync(pkg.absoluteGeneratedLibDir)) {
      throw new Error(`${pkg.name}: generated JS not found at ${pkg.absoluteGeneratedLibDir}. Run codegen-js first.`);
    }
    return bundleSibling(libDir, pkg.absoluteGeneratedLibDir, pkg.name, pkg.version);
  });

  writeNamespaceIndexFiles(path.join(libDir, 'Fairmint'), getImmediateChildDirs(path.join(libDir, 'Fairmint')));
  return bundled;
}

function main(): void {
  try {
    const bundled = bundleLocalPackages();
    for (const pkg of bundled) {
      console.log(
        `📦 Bundled ${pkg.name} ${pkg.version} as lib/__bundled__/${pkg.bundledName} (Fairmint.${pkg.namespaces.join(', Fairmint.')})`
      );
    }
    console.log(`✅ Bundled ${bundled.length} sibling package(s) into lib/`);
  } catch (error) {
    console.error(`❌ bundle-local-packages failed: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
