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
  const hasReports = Boolean(rootPkg?.Fairmint?.OpenCapTableReports);
  const hasNftApi = Boolean(rootPkg?.Nft?.Api?.V1);
  const hasNftReference = Boolean(rootPkg?.Nft?.Reference?.V1);
  const ocpTemplates = rootPkg?.OCP_TEMPLATES;
  if (!hasReports) console.warn('Warning: OpenCapTableReports namespace not detected');
  if (!hasNftApi) throw new Error('Root export missing Nft.Api.V1 namespace');
  if (!hasNftReference) throw new Error('Root export missing Nft.Reference.V1 namespace');
  if (!ocpTemplates?.capTable) throw new Error('Root export missing OCP_TEMPLATES.capTable');
  if (!ocpTemplates?.issuerAuthorization) {
    throw new Error('Root export missing OCP_TEMPLATES.issuerAuthorization');
  }
  if (!ocpTemplates?.ocpFactory) throw new Error('Root export missing OCP_TEMPLATES.ocpFactory');
  const fairmintNamespace = rootPkg?.Fairmint;
  if (!fairmintNamespace) throw new Error('Root export missing Fairmint namespace');

  const openCapTableNamespace = fairmintNamespace?.OpenCapTable;
  if (!openCapTableNamespace) throw new Error('Root export missing Fairmint.OpenCapTable namespace');

  if (ocpTemplates.capTable !== openCapTableNamespace.CapTable.CapTable.templateId) {
    throw new Error('OCP_TEMPLATES.capTable does not match generated CapTable templateId');
  }
  if (ocpTemplates.issuerAuthorization !== openCapTableNamespace.IssuerAuthorization.IssuerAuthorization.templateId) {
    throw new Error('OCP_TEMPLATES.issuerAuthorization does not match generated IssuerAuthorization templateId');
  }
  if (ocpTemplates.ocpFactory !== openCapTableNamespace.OcpFactory.OcpFactory.templateId) {
    throw new Error('OCP_TEMPLATES.ocpFactory does not match generated OcpFactory templateId');
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
  const darPath = openCapTableDarPathMod.getOpenCapTableDarPath() as string;
  if (!darPath || !path.isAbsolute(darPath) || !fs.existsSync(darPath)) {
    throw new Error(
      `getOpenCapTableDarPath() must return an absolute path to an existing file; got: ${darPath}`
    );
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
    'OK: Root package exports OCP_TEMPLATES alongside Nft.Api.V1 and Nft.Reference.V1, JSON subpaths and openCapTableDarPath resolve, and standalone NFT packages remain correctly isolated'
  );
} catch (e) {
  console.error('Import test failed:', getErrorMessage(e));
  process.exit(1);
}
