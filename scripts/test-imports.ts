import fs from 'fs';
import path from 'path';
import { requirePackageConfig } from './packages';
import { getErrorMessage } from './types';

const ROOT_DIR = path.join(__dirname, '..');
const nftPkg = requirePackageConfig('nft');
const standaloneNftDir = path.join(ROOT_DIR, 'generated', 'js', `${nftPkg.name}-${nftPkg.version}`);

try {
  const rootPkg = require(ROOT_DIR);
  if (!rootPkg?.Fairmint) {
    throw new Error('Root export missing Fairmint');
  }
  const hasOcp = Boolean(rootPkg.Fairmint?.OpenCapTable);
  const hasReports = Boolean(rootPkg.Fairmint?.OpenCapTableReports);
  const hasNft = Boolean(rootPkg.Fairmint?.OpenCapTableNft);
  if (!hasOcp) console.warn('Warning: OpenCapTable namespace not detected');
  if (!hasReports) console.warn('Warning: OpenCapTableReports namespace not detected');
  if (!hasNft) throw new Error('Root export missing OpenCapTableNft namespace');

  // Verify JSON import via package subpath exports
  const ocp = require('@fairmint/open-captable-protocol-daml-js/ocp-factory-contract-id.json');
  if (!ocp?.mainnet?.ocpFactoryContractId) throw new Error('OCP Factory JSON missing expected fields');
  const reports = require('@fairmint/open-captable-protocol-daml-js/reports-factory-contract-id.json');
  if (!reports?.mainnet?.reportsFactoryContractId) throw new Error('Reports Factory JSON missing expected fields');

  if (!fs.existsSync(standaloneNftDir)) {
    throw new Error(`Standalone NFT package missing at ${standaloneNftDir}. Run npm run codegen first.`);
  }

  const standaloneNftPkg = require(standaloneNftDir);
  if (!standaloneNftPkg?.Fairmint?.OpenCapTableNft) {
    throw new Error('Standalone NFT package missing OpenCapTableNft namespace');
  }
  if (standaloneNftPkg?.Splice) {
    throw new Error('Standalone NFT package must not export Splice');
  }
  if (fs.existsSync(path.join(standaloneNftDir, 'lib', 'Splice'))) {
    throw new Error('Standalone NFT package must not bundle lib/Splice');
  }
  if (fs.existsSync(path.join(standaloneNftDir, 'lib', 'Fairmint', 'OpenCapTable'))) {
    throw new Error('Standalone NFT package must not bundle Fairmint/OpenCapTable');
  }

  console.log(
    'OK: Root package exports Fairmint aggregator including OpenCapTableNft, JSON subpaths are accessible, and standalone NFT package remains dependency-isolated'
  );
} catch (e) {
  console.error('Import test failed:', getErrorMessage(e));
  process.exit(1);
}
