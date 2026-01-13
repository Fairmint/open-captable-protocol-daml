#!/usr/bin/env node

import { createLedgerJsonApiClient } from './utils';
import { isContractNetwork, type ContractNetwork } from './types';

// CouponMinter template ID - matches CouponMinter/daml.yaml version 0.0.1
const COUPON_MINTER_TEMPLATE_ID = 'Fairmint.CouponMinter:CouponMinter';

function getNetworkFromArgs(): ContractNetwork {
  const args = process.argv.slice(2);
  const networkIndex = args.findIndex(arg => arg === '--network' || arg === '-n');

  if (networkIndex === -1 || networkIndex === args.length - 1) {
    console.error('❌ Please specify a network using --network or -n (e.g., --network mainnet or --network devnet)');
    process.exit(1);
  }

  const network = args[networkIndex + 1].toLowerCase();
  if (!isContractNetwork(network)) {
    console.error('❌ Network must be either "mainnet" or "devnet"');
    process.exit(1);
  }

  return network;
}

async function main() {
  const network = getNetworkFromArgs();
  console.log(`Creating CouponMinter contract for ${network}...`);

  // Use intellect as the provider/operator
  const client = createLedgerJsonApiClient(network, 'intellect');
  const intellectPartyId = client.getPartyId();

  console.log(`Template ID: ${COUPON_MINTER_TEMPLATE_ID}`);
  console.log(`Operator (intellect): ${intellectPartyId}`);

  // CouponMinter contract payload
  const couponMinterData = {
    operator: intellectPartyId,
    lastMintTime: null, // Optional Time - None
    lastMintCount: '0', // Int
  };

  const createCommand = {
    templateId: COUPON_MINTER_TEMPLATE_ID,
    createArguments: couponMinterData,
  };

  try {
    console.log('Submitting CouponMinter contract creation transaction...');

    const response = await client.submitAndWaitForTransactionTree({
      commands: [{ CreateCommand: createCommand }],
    });

    const eventsById = response.transactionTree?.eventsById;
    if (!eventsById || Object.keys(eventsById).length === 0) {
      throw new Error('No events found in transaction response');
    }

    const firstEvent = eventsById[Object.keys(eventsById)[0]];
    if (!firstEvent || !('CreatedTreeEvent' in firstEvent)) {
      throw new Error('First event is not a CreatedTreeEvent');
    }
    const createdTreeEvent = firstEvent.CreatedTreeEvent;

    const contractId = createdTreeEvent.value.contractId;
    if (!contractId) {
      throw new Error('Contract ID not found in CreatedTreeEvent');
    }

    console.log(`✅ CouponMinter contract created with ID: ${contractId}`);
    console.log(`   Template ID: ${createdTreeEvent.value.templateId}`);
    console.log(`\n📝 Note: CouponMinter uses consuming choices, so clients must query for the current contract on demand.`);
  } catch (error) {
    console.error('❌ Failed to create CouponMinter contract:', error);
    process.exit(1);
  }
}

main();
