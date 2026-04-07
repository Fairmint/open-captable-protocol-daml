/**
 * NftReference codegen imports the merged package root via `../../../../index.js` from files under
 * `lib/Nft/Reference/...` (depth matches DAML module nesting). That pulls in the full `index.js` graph and creates a
 * circular dependency. Rewrite those imports to `nft-api-v01-package-namespace.js` using the **same** relative prefix
 * as the original `index.js` import so resolution stays correct for both `.../V1/Foo.js` and
 * `.../V1/NftAsset/module.js` depths.
 */

import fs from 'fs';
import path from 'path';

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

export function patchNftReferenceGeneratedTree(referenceSubtreeRoot: string): number {
  if (!fs.existsSync(referenceSubtreeRoot)) {
    return 0;
  }

  let count = 0;
  const walk = (dir: string): void => {
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
      const next = rewriteNftReferencePackageRootIndexImports(text);
      if (next !== text) {
        fs.writeFileSync(full, next);
        count++;
      }
    }
  };

  walk(referenceSubtreeRoot);
  return count;
}

/** Bridge files live under `lib/` next to `Nft/` (standalone generated package or merged repo `lib/`). */
export function hasNftApiPackageNamespaceBridgeUnderLib(packageRoot: string): boolean {
  const js = path.join(packageRoot, 'lib', 'nft-api-v01-package-namespace.js');
  const dts = path.join(packageRoot, 'lib', 'nft-api-v01-package-namespace.d.ts');
  return fs.existsSync(js) && fs.existsSync(dts);
}

/** If tooling ever emits the bridge at package root, bundle step still finds it. */
export function hasNftApiPackageNamespaceBridgeAtPackageRoot(packageRoot: string): boolean {
  const js = path.join(packageRoot, 'nft-api-v01-package-namespace.js');
  const dts = path.join(packageRoot, 'nft-api-v01-package-namespace.d.ts');
  return fs.existsSync(js) && fs.existsSync(dts);
}
