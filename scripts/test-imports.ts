import fs from 'fs';
import path from 'path';
import { getGeneratedPackageDir } from './packages';
import { getErrorMessage, type PackageJson } from './types';

const ROOT_DIR = path.join(__dirname, '..');
const rootPackagePath = path.join(ROOT_DIR, 'package.json');
const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8')) as PackageJson;
const standaloneNftApiDir = getGeneratedPackageDir('nftApi');
const standaloneNftReferenceDir = getGeneratedPackageDir('nftReference');

try {
  const rootPkg = require(ROOT_DIR);
  const hasOcp = Boolean(rootPkg?.Fairmint?.OpenCapTable);
  const hasReports = Boolean(rootPkg?.Fairmint?.OpenCapTableReports);
  const hasNftApi = Boolean(rootPkg?.Nft?.Api?.V1);
  const hasNftReference = Boolean(rootPkg?.Nft?.Reference?.V1);
  if (!hasOcp) console.warn('Warning: OpenCapTable namespace not detected');
  if (!hasReports) console.warn('Warning: OpenCapTableReports namespace not detected');
  if (!hasNftApi) throw new Error('Root export missing Nft.Api.V1 namespace');
  if (!hasNftReference) throw new Error('Root export missing Nft.Reference.V1 namespace');
  if (
    !rootPkg.OCP_TEMPLATES?.capTable ||
    !rootPkg.OCP_TEMPLATES?.issuerAuthorization ||
    !rootPkg.OCP_TEMPLATES?.ocpFactory
  ) {
    throw new Error('Root package missing OCP_TEMPLATES (capTable, issuerAuthorization, ocpFactory)');
  }

  // Verify JSON import via package subpath exports
  const ocp = require(`${rootPackage.name}/ocp-factory-contract-id.json`);
  if (!ocp?.mainnet?.ocpFactoryContractId) throw new Error('OCP Factory JSON missing expected fields');
  const reports = require(`${rootPackage.name}/reports-factory-contract-id.json`);
  if (!reports?.mainnet?.reportsFactoryContractId) throw new Error('Reports Factory JSON missing expected fields');

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
    throw new Error(
      `getOpenCapTableDarPath() must return an absolute path to an existing file; got: ${darPath}`
    );
  }

  const resolvedDefault = openCapTableDarPathMod.resolveOpenCapTableDarPath() as string;
  if (resolvedDefault !== darPath) {
    throw new Error(`resolveOpenCapTableDarPath() should match getOpenCapTableDarPath(); ${resolvedDefault} vs ${darPath}`);
  }

  const resolvedWithDummySibling = openCapTableDarPathMod.resolveOpenCapTableDarPath({
    siblingSearchFrom: '/nonexistent-does-not-matter-when-packaged-dar-exists',
  }) as string;
  if (resolvedWithDummySibling !== darPath) {
    throw new Error('resolveOpenCapTableDarPath({ siblingSearchFrom }) must not change result when packaged DAR exists');
  }

  if (typeof rootPkg.resolveOpenCapTableDarPath !== 'function') {
    throw new Error('Root package must re-export resolveOpenCapTableDarPath');
  }
  if (typeof rootPkg.getOpenCapTableDarPath !== 'function') {
    throw new Error('Root package must re-export getOpenCapTableDarPath');
  }
  if (rootPkg.OPEN_CAP_TABLE_DAR_PATH_ENV !== 'OPEN_CAP_TABLE_DAR_PATH') {
    throw new Error('Root package must re-export OPEN_CAP_TABLE_DAR_PATH_ENV');
  }
  if ((rootPkg.getOpenCapTableDarPath() as string) !== darPath) {
    throw new Error('root getOpenCapTableDarPath() must match subpath module');
  }
  if ((rootPkg.resolveOpenCapTableDarPath() as string) !== darPath) {
    throw new Error('root resolveOpenCapTableDarPath() must match subpath module');
  }
  if (rootPkg.resolveOpenCapTableDarPath !== openCapTableDarPathMod.resolveOpenCapTableDarPath) {
    throw new Error('root resolveOpenCapTableDarPath must be same function as openCapTableDarPath subpath');
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

  if (!fs.existsSync(standaloneNftApiDir)) {
    throw new Error(`Standalone NFT API package missing at ${standaloneNftApiDir}. Run npm run codegen first.`);
  }
  if (!fs.existsSync(standaloneNftReferenceDir)) {
    throw new Error(
      `Standalone NFT reference package missing at ${standaloneNftReferenceDir}. Run npm run codegen first.`
    );
  }

  const standaloneNftApiPkg = require(standaloneNftApiDir);
  if (!standaloneNftApiPkg?.Nft?.Api?.V1) {
    throw new Error('Standalone NFT API package missing Nft.Api.V1 namespace');
  }
  if (standaloneNftApiPkg?.Nft?.Reference) {
    throw new Error('Standalone NFT API package must not export Nft.Reference');
  }
  if (standaloneNftApiPkg?.Splice || fs.existsSync(path.join(standaloneNftApiDir, 'lib', 'Splice'))) {
    throw new Error('Standalone NFT API package must not bundle Splice');
  }

  const standaloneNftReferencePkg = require(standaloneNftReferenceDir);
  if (!standaloneNftReferencePkg?.Nft?.Api?.V1) {
    throw new Error('Standalone NFT reference package missing Nft.Api.V1 namespace');
  }
  if (!standaloneNftReferencePkg?.Nft?.Reference?.V1) {
    throw new Error('Standalone NFT reference package missing Nft.Reference.V1 namespace');
  }
  if (standaloneNftReferencePkg?.Splice) {
    throw new Error('Standalone NFT reference package must not export Splice');
  }
  if (fs.existsSync(path.join(standaloneNftReferenceDir, 'lib', 'Splice'))) {
    throw new Error('Standalone NFT reference package must not bundle lib/Splice');
  }
  if (fs.existsSync(path.join(standaloneNftReferenceDir, 'lib', 'Fairmint'))) {
    throw new Error('Standalone NFT reference package must not bundle Fairmint namespaces');
  }

  console.log(
    'OK: Root package exports Nft.Api.V1 and Nft.Reference.V1, JSON subpaths are accessible, and standalone NFT packages remain correctly isolated'
  );
} catch (e) {
  console.error('Import test failed:', getErrorMessage(e));
  process.exit(1);
}
