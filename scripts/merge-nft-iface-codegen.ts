/**
 * After codegen, NftReference-v01 JS omits Nft.Api.* modules because they live in NftApi-v01. Copy the generated
 * Nft/Api subtree into the NftReference-v01 lib and rewrite Nft/index so the standalone reference package exports both
 * Nft.Api and Nft.Reference.
 */
import fs from 'fs';
import path from 'path';
import { requirePackageConfig } from './packages';

function copyDir(src: string, dest: string): void {
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

function patchReferenceImports(referenceNftDir: string): void {
  const refRoot = path.join(referenceNftDir, 'Reference');
  if (!fs.existsSync(refRoot)) {
    return;
  }

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
      const next = text
        .split("require('../../../../index.js')")
        .join("require('../../../../nft-api-v01-package-namespace.js')")
        .split('require("../../../../index.js")')
        .join('require("../../../../nft-api-v01-package-namespace.js")')
        .split("from '../../../../index.js'")
        .join("from '../../../../nft-api-v01-package-namespace.js'")
        .split('from "../../../../index.js"')
        .join('from "../../../../nft-api-v01-package-namespace.js"');

      if (next !== text) {
        fs.writeFileSync(full, next);
      }
    }
  };

  walk(refRoot);
}

const nftApiPkg = requirePackageConfig('nftApi');
const nftReferencePkg = requirePackageConfig('nftReference');

const rootDir = path.join(__dirname, '..');
const apiNftDir = path.join(rootDir, 'generated', 'js', `${nftApiPkg.name}-${nftApiPkg.version}`, 'lib', 'Nft');
const referenceNftDir = path.join(
  rootDir,
  'generated',
  'js',
  `${nftReferencePkg.name}-${nftReferencePkg.version}`,
  'lib',
  'Nft'
);

if (!fs.existsSync(apiNftDir)) {
  console.error(`merge-nft-iface-codegen: missing ${apiNftDir}; run NftApi-v01 codegen first`);
  process.exit(1);
}
if (!fs.existsSync(referenceNftDir)) {
  console.error(`merge-nft-iface-codegen: missing ${referenceNftDir}; run NftReference-v01 codegen first`);
  process.exit(1);
}

copyDir(path.join(apiNftDir, 'Api'), path.join(referenceNftDir, 'Api'));

const mergedIndexJs = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Api = require('./Api');
exports.Api = Api;
var Reference = require('./Reference');
exports.Reference = Reference;
`;

const mergedIndexDts = `export * as Api from './Api';
export * as Reference from './Reference';
`;

fs.writeFileSync(path.join(referenceNftDir, 'index.js'), mergedIndexJs);
fs.writeFileSync(path.join(referenceNftDir, 'index.d.ts'), mergedIndexDts);
fs.writeFileSync(
  path.join(referenceNftDir, '..', 'nft-api-v01-package-namespace.js'),
  `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var NftApi = require("./Nft/Api");
exports.Nft = { Api: NftApi };
`
);
fs.writeFileSync(
  path.join(referenceNftDir, '..', 'nft-api-v01-package-namespace.d.ts'),
  `import type * as NftApi from "./Nft/Api";
export declare const Nft: {
  Api: typeof NftApi;
};
`
);
patchReferenceImports(referenceNftDir);

console.log('✅ Merged NftApi-v01 bindings into NftReference-v01 generated lib');
