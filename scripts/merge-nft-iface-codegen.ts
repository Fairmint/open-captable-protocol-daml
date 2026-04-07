/**
 * After codegen, OpenCapTableNft-v01 JS omits Fairmint.OpenCapTableNft.{Nft,Types} (they live in OpenCapTableNftIface-v01).
 * Copy those modules into the v01 generated lib and rewrite OpenCapTableNft/index so standalone NFT bindings stay complete.
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

const nftIfacePkg = requirePackageConfig('nftIface');
const nftPkg = requirePackageConfig('nft');

const rootDir = path.join(__dirname, '..');
const ifaceFairmintNft = path.join(
  rootDir,
  'generated',
  'js',
  `${nftIfacePkg.name}-${nftIfacePkg.version}`,
  'lib',
  'Fairmint',
  'OpenCapTableNft'
);
const nftFairmintNft = path.join(
  rootDir,
  'generated',
  'js',
  `${nftPkg.name}-${nftPkg.version}`,
  'lib',
  'Fairmint',
  'OpenCapTableNft'
);

if (!fs.existsSync(ifaceFairmintNft)) {
  console.error(`merge-nft-iface-codegen: missing ${ifaceFairmintNft}; run OpenCapTableNftIface-v01 codegen first`);
  process.exit(1);
}
if (!fs.existsSync(nftFairmintNft)) {
  console.error(`merge-nft-iface-codegen: missing ${nftFairmintNft}; run OpenCapTableNft-v01 codegen first`);
  process.exit(1);
}

for (const sub of ['Nft', 'Types'] as const) {
  copyDir(path.join(ifaceFairmintNft, sub), path.join(nftFairmintNft, sub));
}

const mergedIndexJs = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Nft = require('./Nft');
exports.Nft = Nft;
var Types = require('./Types');
exports.Types = Types;
var NftAsset = require('./NftAsset');
exports.NftAsset = NftAsset;
var NftRegistry = require('./NftRegistry');
exports.NftRegistry = NftRegistry;
var ReceiveAuthorization = require('./ReceiveAuthorization');
exports.ReceiveAuthorization = ReceiveAuthorization;
`;

const mergedIndexDts = `export * as Nft from './Nft';
export * as Types from './Types';
export * as NftAsset from './NftAsset';
export * as NftRegistry from './NftRegistry';
export * as ReceiveAuthorization from './ReceiveAuthorization';
`;

fs.writeFileSync(path.join(nftFairmintNft, 'index.js'), mergedIndexJs);
fs.writeFileSync(path.join(nftFairmintNft, 'index.d.ts'), mergedIndexDts);

console.log('✅ Merged OpenCapTableNftIface-v01 Fairmint modules into OpenCapTableNft-v01 generated lib');
