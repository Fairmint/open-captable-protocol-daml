/**
 * Typings for `ocp-factory-contract-id.json` (committed snapshot; updated by `create-factory:ocp`).
 *
 * The OpenCapTable-v35 OcpFactory is consumed by each `OcpFactory_AuthorizeIssuer`, which recreates it with the next
 * cap table number, so this file records the factory's identity rather than a contract ID. Find the live factory with an
 * active-contracts query for `templateId`, filtered on the `system_operator` and `factory_id` create arguments.
 *
 * A network is absent until its factory is created. MainNet is out of scope for v35 (ADR-040).
 */
export interface OcpFactoryIdentity {
  templateId: string;
  system_operator: string;
  factory_id: string;
  packageName?: string;
  packageVersion?: string;
  sourceDir?: string;
  updatedAt?: string;
}
declare const data: {
  devnet?: OcpFactoryIdentity;
  mainnet?: OcpFactoryIdentity;
};
export default data;
