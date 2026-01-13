import path from 'path';
import { getErrorMessage } from './types';

try {
  const rootPkg = require(path.join('..'));
  if (!rootPkg?.Fairmint) {
    throw new Error('Root export missing Fairmint');
  }
  const hasOcp = Boolean(rootPkg.Fairmint?.OpenCapTable);
  const hasReports = Boolean(rootPkg.Fairmint?.OpenCapTableReports);
  if (!hasOcp) console.warn('Warning: OpenCapTable namespace not detected');
  if (!hasReports) console.warn('Warning: OpenCapTableReports namespace not detected');

  // Verify JSON import via package subpath exports
  const ocp = require('@fairmint/open-captable-protocol-daml-js/ocp-factory-contract-id.json');
  if (!ocp?.mainnet?.ocpFactoryContractId) throw new Error('OCP Factory JSON missing expected fields');
  const reports = require('@fairmint/open-captable-protocol-daml-js/reports-factory-contract-id.json');
  if (!reports?.mainnet?.reportsFactoryContractId) throw new Error('Reports Factory JSON missing expected fields');

  console.log('OK: Root package exports Fairmint aggregator and both JSON subpaths are accessible');
} catch (e) {
  console.error('Import test failed:', getErrorMessage(e));
  process.exit(1);
}
