import fs from 'fs';
import path from 'path';
import { requirePackageConfig } from './packages';
import { getErrorMessage, type PackageJson } from './types';

const ROOT_DIR = path.join(__dirname, '..');
const rootPackagePath = path.join(ROOT_DIR, 'package.json');
const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8')) as PackageJson;
const ocpPackage = requirePackageConfig('ocp');

try {
  const rootPkg = require(ROOT_DIR);
  const hasOcp = Boolean(rootPkg?.Fairmint?.OpenCapTable);
  if (!hasOcp) throw new Error('Root export missing Fairmint.OpenCapTable');
  if (rootPkg?.Fairmint?.OpenCapTableReports) {
    throw new Error('This package must not export Fairmint.OpenCapTableReports (use @fairmint/daml-js)');
  }
  if (typeof rootPkg.Nft !== 'undefined') {
    throw new Error('This package must not export Nft (use @fairmint/daml-js)');
  }
  if (typeof rootPkg.CantonPayments !== 'undefined') {
    throw new Error('This package must not export CantonPayments (use @fairmint/daml-js)');
  }
  if (
    !rootPkg.OCP_TEMPLATES?.capTable ||
    !rootPkg.OCP_TEMPLATES?.issuerAuthorization ||
    !rootPkg.OCP_TEMPLATES?.ocpFactory
  ) {
    throw new Error('Root package missing OCP_TEMPLATES (capTable, issuerAuthorization, ocpFactory)');
  }

  // The v35 factory is consumed per authorization, so the JSON records identities, never a contract ID. A network is
  // absent until its factory exists; any entry present must belong to the current package (no v34 leftovers).
  const ocp = require(`${rootPackage.name}/ocp-factory-contract-id.json`);
  if (ocp === null || typeof ocp !== 'object' || Array.isArray(ocp)) {
    throw new Error('OCP Factory JSON must be an object keyed by network');
  }
  for (const [network, entry] of Object.entries(ocp as Record<string, Record<string, unknown> | undefined>)) {
    if (network !== 'devnet' && network !== 'mainnet')
      throw new Error(`OCP Factory JSON has unknown network ${network}`);
    for (const field of ['templateId', 'system_operator', 'factory_id']) {
      if (typeof entry?.[field] !== 'string' || entry[field] === '') {
        throw new Error(`OCP Factory JSON ${network} entry missing ${field}`);
      }
    }
    if ('ocpFactoryContractId' in (entry ?? {})) {
      throw new Error(`OCP Factory JSON ${network} entry records a contract ID; the v35 factory is consumed per use`);
    }
    if (entry?.packageName !== ocpPackage.name) {
      throw new Error(`OCP Factory JSON ${network} entry is for ${String(entry?.packageName)}, not ${ocpPackage.name}`);
    }
  }

  const openCapTableDarPathMod = require(`${rootPackage.name}/openCapTableDarPath`);
  if (typeof openCapTableDarPathMod.getOpenCapTableDarPath !== 'function') {
    throw new Error('openCapTableDarPath export missing getOpenCapTableDarPath');
  }
  if (openCapTableDarPathMod.OPEN_CAP_TABLE_DAR_EXPORT_SUBPATH !== './opencaptable.dar') {
    throw new Error(
      `openCapTableDarPath OPEN_CAP_TABLE_DAR_EXPORT_SUBPATH mismatch: ${String(openCapTableDarPathMod.OPEN_CAP_TABLE_DAR_EXPORT_SUBPATH)}`
    );
  }
  if (openCapTableDarPathMod.OPEN_CAP_TABLE_DAR_PATH_ENV !== 'OPEN_CAP_TABLE_DAR_PATH') {
    throw new Error(
      `openCapTableDarPath OPEN_CAP_TABLE_DAR_PATH_ENV mismatch: ${String(openCapTableDarPathMod.OPEN_CAP_TABLE_DAR_PATH_ENV)}`
    );
  }
  if (typeof openCapTableDarPathMod.resolveOpenCapTableDarPath !== 'function') {
    throw new Error('openCapTableDarPath export missing resolveOpenCapTableDarPath');
  }

  const darPath = openCapTableDarPathMod.getOpenCapTableDarPath() as string;
  if (!darPath || !path.isAbsolute(darPath) || !fs.existsSync(darPath)) {
    throw new Error(`getOpenCapTableDarPath() must return an absolute path to an existing file; got: ${darPath}`);
  }

  const resolvedDefault = openCapTableDarPathMod.resolveOpenCapTableDarPath() as string;
  if (resolvedDefault !== darPath) {
    throw new Error(
      `resolveOpenCapTableDarPath() should match getOpenCapTableDarPath(); ${resolvedDefault} vs ${darPath}`
    );
  }

  const resolvedWithDummySibling = openCapTableDarPathMod.resolveOpenCapTableDarPath({
    siblingSearchFrom: '/nonexistent-does-not-matter-when-packaged-dar-exists',
  }) as string;
  if (resolvedWithDummySibling !== darPath) {
    throw new Error(
      'resolveOpenCapTableDarPath({ siblingSearchFrom }) must not change result when packaged DAR exists'
    );
  }

  if (typeof rootPkg.resolveOpenCapTableDarPath !== 'undefined') {
    throw new Error('Root package must not export resolveOpenCapTableDarPath (use openCapTableDarPath subpath)');
  }
  if (typeof rootPkg.getOpenCapTableDarPath !== 'undefined') {
    throw new Error('Root package must not export getOpenCapTableDarPath (use openCapTableDarPath subpath)');
  }

  process.env.OPEN_CAP_TABLE_DAR_PATH = darPath;
  try {
    if (openCapTableDarPathMod.resolveOpenCapTableDarPath() !== darPath) {
      throw new Error('OPEN_CAP_TABLE_DAR_PATH should take precedence when set to packaged DAR path');
    }
  } finally {
    delete process.env.OPEN_CAP_TABLE_DAR_PATH;
  }

  process.env.OPEN_CAP_TABLE_DAR_PATH = path.join(ROOT_DIR, 'this-file-should-not-exist-for-import-test.dar');
  try {
    openCapTableDarPathMod.resolveOpenCapTableDarPath();
    throw new Error('expected resolveOpenCapTableDarPath to throw when OPEN_CAP_TABLE_DAR_PATH is invalid');
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes('OPEN_CAP_TABLE_DAR_PATH')) {
      throw e;
    }
  } finally {
    delete process.env.OPEN_CAP_TABLE_DAR_PATH;
  }

  console.log('OK: Root package exports OpenCapTable + OCP_TEMPLATES; OCP factory JSON + DAR path subpath work');
} catch (e) {
  console.error('Import test failed:', getErrorMessage(e));
  process.exit(1);
}
