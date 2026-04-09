/**
 * Absolute path to the OpenCapTable DAR shipped in this package (`published-dars/OpenCapTable.dar`).
 *
 * Published as `@fairmint/open-captable-protocol-daml-js/openCapTableDarPath` so tools and tests do not duplicate
 * `createRequire` / subpath strings.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Npm `exports` subpath for the raw DAR file (for tools that need `require.resolve` / bundler parity).
 *
 * @see package.json `exports["./opencaptable.dar"]`
 */
export const OPEN_CAP_TABLE_DAR_EXPORT_SUBPATH = './opencaptable.dar' as const;

/**
 * Return the absolute path to the staged OpenCapTable DAR on disk.
 *
 * @throws If the file is missing (corrupt install or pre-staging checkout without `npm run codegen`).
 */
export function getOpenCapTableDarPath(): string {
  const darPath = path.join(__dirname, '..', 'published-dars', 'OpenCapTable.dar');
  if (!fs.existsSync(darPath)) {
    throw new Error(
      `OpenCapTable DAR not found at ${darPath}. ` +
        'Expected published-dars/OpenCapTable.dar (run npm run codegen before pack, or use a published tarball).'
    );
  }
  return darPath;
}
