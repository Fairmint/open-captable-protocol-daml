/**
 * After codegen, NftReference-v01 JS omits Nft.Api.* modules because they live in NftApi-v01. Copy the generated
 * Nft/Api subtree into the NftReference-v01 lib and rewrite Nft/index so the standalone reference package exports both
 * Nft.Api and Nft.Reference.
 */
import fs from 'fs';
import path from 'path';
import { prepareMergedNftNamespace } from './nft-reference-bridge-rewrite';
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
const patched = prepareMergedNftNamespace(referenceNftDir, path.join(referenceNftDir, '..'));
if (patched > 0) {
  console.log(`✅ Patched ${patched} Nft/Reference files to use nft-api-v01 bridge import`);
}

console.log('✅ Merged NftApi-v01 bindings into NftReference-v01 generated lib');
