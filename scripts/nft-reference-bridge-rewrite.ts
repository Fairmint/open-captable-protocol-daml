/**
 * NftReference codegen imports the merged package root via `../../../../index.js` from files under
 * `lib/Nft/Reference/...` (depth matches DAML module nesting). That pulls in the full `index.js` graph and creates a
 * circular dependency. Rewrite those imports to `nft-api-v01-package-namespace.js` using the **same** relative prefix
 * as the original `index.js` import so resolution stays correct for both `.../V1/Foo.js` and
 * `.../V1/NftAsset/module.js` depths.
 */

import path from 'path';
import {
  findGeneratedOutputFilesContainingAny,
  hasGeneratedOutputPair,
  rewriteGeneratedOutputFiles,
  writeGeneratedOutputPair,
} from './generated-output-helpers';

export const NFT_API_PACKAGE_NAMESPACE_BRIDGE_BASENAME = 'nft-api-v01-package-namespace';
export const NFT_API_PACKAGE_NAMESPACE_BRIDGE_REQUIRED_RELATIVE_FILES = [
  `${NFT_API_PACKAGE_NAMESPACE_BRIDGE_BASENAME}.js`,
  `${NFT_API_PACKAGE_NAMESPACE_BRIDGE_BASENAME}.d.ts`,
] as const;

const NFT_API_PACKAGE_NAMESPACE_BRIDGE_JS = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var NftApi = require("./Nft/Api");
exports.Nft = { Api: NftApi };
`;

const NFT_API_PACKAGE_NAMESPACE_BRIDGE_DTS = `import type * as NftApi from "./Nft/Api";
export declare const Nft: {
  Api: typeof NftApi;
};
`;

const MERGED_NFT_INDEX_JS = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Api = require('./Api');
exports.Api = Api;
var Reference = require('./Reference');
exports.Reference = Reference;
`;

const MERGED_NFT_INDEX_DTS = `export * as Api from './Api';
export * as Reference from './Reference';
`;

const BAD_PACKAGE_ROOT_IMPORTS = [
  "require('../../../../index.js')",
  'require("../../../../index.js")',
  "from '../../../../index.js'",
  'from "../../../../index.js"',
] as const;

export function rewriteNftReferencePackageRootIndexImports(source: string): string {
  let next = source
    .split("require('../../../../index.js')")
    .join("require('../../../../nft-api-v01-package-namespace.js')")
    .split('require("../../../../index.js")')
    .join('require("../../../../nft-api-v01-package-namespace.js")')
    .split("from '../../../../index.js'")
    .join("from '../../../../nft-api-v01-package-namespace.js'")
    .split('from "../../../../index.js"')
    .join('from "../../../../nft-api-v01-package-namespace.js"');

  // Reference template modules live under lib/Nft/Reference/V1/<Template>/module.js; bridge must use the
  // same depth as other lib-level imports (e.g. ../../../../DA/...) — not ../../../.
  next = next
    .split("require('../../../nft-api-v01-package-namespace.js')")
    .join("require('../../../../nft-api-v01-package-namespace.js')")
    .split('require("../../../nft-api-v01-package-namespace.js")')
    .join('require("../../../../nft-api-v01-package-namespace.js")')
    .split("from '../../../nft-api-v01-package-namespace.js'")
    .join("from '../../../../nft-api-v01-package-namespace.js'")
    .split('from "../../../nft-api-v01-package-namespace.js"')
    .join('from "../../../../nft-api-v01-package-namespace.js"');

  return next;
}

export function writeMergedNftNamespaceIndex(nftDir: string): void {
  writeGeneratedOutputPair(nftDir, 'index', {
    js: MERGED_NFT_INDEX_JS,
    dts: MERGED_NFT_INDEX_DTS,
  });
}

/** Bridge files live under `lib/` next to `Nft/` (standalone generated package or merged repo `lib/`). */
export function writeNftApiPackageNamespaceBridge(libDir: string): void {
  writeGeneratedOutputPair(libDir, NFT_API_PACKAGE_NAMESPACE_BRIDGE_BASENAME, {
    js: NFT_API_PACKAGE_NAMESPACE_BRIDGE_JS,
    dts: NFT_API_PACKAGE_NAMESPACE_BRIDGE_DTS,
  });
}

export function prepareMergedNftNamespace(nftDir: string, libDir: string): number {
  writeMergedNftNamespaceIndex(nftDir);
  writeNftApiPackageNamespaceBridge(libDir);
  return patchNftReferenceGeneratedNftDir(nftDir);
}

export function patchNftReferenceGeneratedTree(referenceSubtreeRoot: string): number {
  return rewriteGeneratedOutputFiles(referenceSubtreeRoot, (source) =>
    rewriteNftReferencePackageRootIndexImports(source)
  );
}

export function patchNftReferenceGeneratedNftDir(nftDir: string): number {
  return patchNftReferenceGeneratedTree(path.join(nftDir, 'Reference'));
}

export function hasNftApiPackageNamespaceBridgeUnderLib(packageRoot: string): boolean {
  return hasGeneratedOutputPair(path.join(packageRoot, 'lib'), NFT_API_PACKAGE_NAMESPACE_BRIDGE_BASENAME);
}

/** If tooling ever emits the bridge at package root, bundle step still finds it. */
export function hasNftApiPackageNamespaceBridgeAtPackageRoot(packageRoot: string): boolean {
  return hasGeneratedOutputPair(packageRoot, NFT_API_PACKAGE_NAMESPACE_BRIDGE_BASENAME);
}

export function findNftReferenceFilesRequiringPackageRootIndex(referenceSubtreeRoot: string): string[] {
  return findGeneratedOutputFilesContainingAny(referenceSubtreeRoot, BAD_PACKAGE_ROOT_IMPORTS);
}
