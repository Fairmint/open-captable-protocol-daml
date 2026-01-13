#!/usr/bin/env node
/**
 * Create the initial CouponMinter contract.
 * Uses `intellect` as the operator.
 *
 * Note: CouponMinter uses consuming choices, so the contract ID changes on every
 * MintCoupons call. Clients must query for the current contract on demand.
 *
 * Usage: tsx scripts/create-couponMinter.ts --network <devnet|mainnet>
 */

import { createLedgerJsonApiClient } from './utils';
import { requireNetwork } from './packages';

const TEMPLATE_ID = 'Fairmint.CouponMinter:CouponMinter';
const DEFAULT_MAX_TPS = '100.0'; // Default TPS limit for minting coupons

async function main() {
  const network = requireNetwork('create-couponMinter.ts');

  console.log(`\n🔨 Creating CouponMinter on ${network}\n`);

  const client = createLedgerJsonApiClient(network, 'intellect');
  const operatorPartyId = client.getPartyId();

  console.log(`  Template: ${TEMPLATE_ID}`);
  console.log(`  Operator: ${operatorPartyId}`);
  console.log(`  Max TPS: ${DEFAULT_MAX_TPS}`);

  const response = await client.submitAndWaitForTransactionTree({
    commands: [{
      CreateCommand: {
        templateId: TEMPLATE_ID,
        createArguments: {
          operator: operatorPartyId,
          maxTps: DEFAULT_MAX_TPS,
          lastMint: null,
        },
      },
    }],
  });

  const eventsById = response.transactionTree?.eventsById;
  if (!eventsById || Object.keys(eventsById).length === 0) {
    throw new Error('No events in response');
  }

  const firstEvent = eventsById[Object.keys(eventsById)[0]];
  if (!firstEvent || !('CreatedTreeEvent' in firstEvent)) {
    throw new Error('Expected CreatedTreeEvent');
  }

  const contractId = firstEvent.CreatedTreeEvent.value.contractId;
  console.log(`\n✅ Created: ${contractId}`);
  console.log(`\n📝 Clients must query for current contract (ID changes on each MintCoupons call)\n`);
}

main().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
