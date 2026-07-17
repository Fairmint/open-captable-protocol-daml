/**
 * OpenCapTable DAR path helpers. Published as `@fairmint/open-captable-protocol-daml-js/openCapTableDarPath` only (uses
 * Node `fs`; not re-exported from the package root so browser/Next bundles stay valid).
 *
 * @remarks
 *   User-facing documentation for `OPEN_CAP_TABLE_DAR_PATH`, the packaged DAR, and local development lives in
 *   `docs/development-and-releases.md`.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Env var: absolute or cwd-relative path to a `.dar` file; checked first when set. */
export const OPEN_CAP_TABLE_DAR_PATH_ENV = 'OPEN_CAP_TABLE_DAR_PATH' as const;

/**
 * Npm `exports` subpath for the raw DAR file (for tools that need `require.resolve` / bundler parity).
 *
 * @see package.json `exports["./opencaptable.dar"]`
 */
export const OPEN_CAP_TABLE_DAR_EXPORT_SUBPATH = './opencaptable.dar' as const;

/**
 * From a dependent repo root: sibling `open-captable-protocol-daml` staged DAR
 * (`../open-captable-protocol-daml/published-dars/OpenCapTable.dar`).
 */
const DEFAULT_SIBLING_DAR_SEGMENTS = [
  '..',
  'open-captable-protocol-daml',
  'published-dars',
  'OpenCapTable.dar',
] as const;

export interface ResolveOpenCapTableDarPathOptions {
  /**
   * Root of the consuming repository (e.g. SDK or app checkout). The parent directory should contain
   * `open-captable-protocol-daml` when using the default sibling layout.
   */
  siblingSearchFrom?: string;
  /**
   * Custom DAR path: absolute, or relative to `siblingSearchFrom` (required when relative). Use when the daml checkout
   * is not at the default sibling path.
   */
  siblingDarPath?: string;
}

function readEnvDarPath(): string | null {
  const raw = process.env[OPEN_CAP_TABLE_DAR_PATH_ENV]?.trim();
  if (!raw) {
    return null;
  }
  const resolved = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `${OPEN_CAP_TABLE_DAR_PATH_ENV} points to a missing file: ${resolved} (raw: ${JSON.stringify(raw)})`
    );
  }
  return resolved;
}

function resolveCustomSiblingDar(options: ResolveOpenCapTableDarPathOptions): string | null {
  const custom = options.siblingDarPath?.trim();
  if (!custom) {
    return null;
  }
  if (path.isAbsolute(custom)) {
    return fs.existsSync(custom) ? custom : null;
  }
  const from = options.siblingSearchFrom?.trim();
  if (!from) {
    return null;
  }
  const joined = path.resolve(from, custom);
  return fs.existsSync(joined) ? joined : null;
}

function defaultSiblingDar(siblingSearchFrom: string): string | null {
  const dar = path.join(siblingSearchFrom, ...DEFAULT_SIBLING_DAR_SEGMENTS);
  return fs.existsSync(dar) ? dar : null;
}

/**
 * Absolute path to the OpenCapTable DAR inside this npm package (`published-dars/OpenCapTable.dar`).
 *
 * @throws If the file is missing (corrupt install, or git checkout without `npm run codegen` / staging).
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

/**
 * Resolve the OpenCapTable DAR for local tooling and tests. Resolution order:
 *
 * 1. **`OPEN_CAP_TABLE_DAR_PATH`** (if set and the file exists).
 * 2. Packaged DAR via {@link getOpenCapTableDarPath}.
 * 3. **`siblingDarPath`** when it resolves to an existing file (absolute, or relative to `siblingSearchFrom`).
 * 4. Default sibling checkout: `{siblingSearchFrom}/../open-captable-protocol-daml/published-dars/OpenCapTable.dar`.
 *
 * On failure after step 2, the thrown error sets **`cause`** to the packaged-DAR error when it was an `Error`.
 */
export function resolveOpenCapTableDarPath(options?: ResolveOpenCapTableDarPathOptions): string {
  const opts = options ?? {};
  const customRaw = opts.siblingDarPath?.trim();
  if (customRaw && !path.isAbsolute(customRaw) && !opts.siblingSearchFrom?.trim()) {
    throw new Error(
      'resolveOpenCapTableDarPath: siblingDarPath is relative; set siblingSearchFrom to the dependent repository root.'
    );
  }

  const envPath = readEnvDarPath();
  if (envPath) {
    return envPath;
  }

  try {
    return getOpenCapTableDarPath();
  } catch (packagedCause) {
    const custom = resolveCustomSiblingDar(opts);
    if (custom) {
      return custom;
    }

    const from = opts.siblingSearchFrom?.trim();
    if (from) {
      const siblingDar = defaultSiblingDar(from);
      if (siblingDar) {
        return siblingDar;
      }
    }

    const base = packagedCause instanceof Error ? packagedCause.message : String(packagedCause);
    const hints: string[] = [];
    if (opts.siblingDarPath?.trim()) {
      hints.push('siblingDarPath did not resolve to an existing file.');
    }
    if (from) {
      hints.push('No DAR at ../open-captable-protocol-daml/published-dars/OpenCapTable.dar.');
    } else {
      hints.push(
        'Tip: set OPEN_CAP_TABLE_DAR_PATH, or pass siblingSearchFrom / siblingDarPath for monorepo development.'
      );
    }

    const msg = [base, hints.length ? ` ${hints.join(' ')}` : ''].join('');
    if (packagedCause instanceof Error) {
      const err = new Error(msg) as Error & { cause: Error };
      err.cause = packagedCause;
      throw err;
    }
    throw new Error(msg);
  }
}
