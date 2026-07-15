#!/usr/bin/env tsx

import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';

import { Canton, type LedgerJsonApiClient, type ScanApiClient } from '@fairmint/canton-node-sdk';
import { createFactory, OcpClient, toCantonConfig } from '@open-captable-protocol/canton';

const LOCALNET_USER_ID = 'ledger-api-user';
// Stock LocalNet includes a 400 KB free base allowance per participant. Repeat a real
// two-sided OCP flow until both authoritative extra-traffic counters become non-zero.
const MAX_INTERACTIONS = 125;
const TRAFFIC_POLL_INTERVAL = 5;

interface CreatedEventValue {
  contractId: string;
  templateId: string;
}

interface TrafficSnapshot {
  extraConsumed: number;
  limit: number;
  purchased: number;
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function localnetClient(provider: 'app-provider' | 'app-user'): Canton {
  const portPrefix = provider === 'app-provider' ? '3' : '2';
  return new Canton(
    toCantonConfig({
      environment: 'localnet',
      provider,
      ledgerApiUrl: `http://localhost:${portPrefix}975`,
      validatorApiUrl: `http://localhost:${portPrefix}903`,
      scanApiUrl: 'http://scan.localhost:4000/api/scan',
    })
  );
}

function findCreatedEvent(response: unknown, expectedTemplateId: string): CreatedEventValue {
  const { transactionTree } = response as { transactionTree?: { eventsById?: Record<string, unknown> } };
  for (const event of Object.values(transactionTree?.eventsById ?? {})) {
    if (!event || typeof event !== 'object' || !('CreatedTreeEvent' in event)) continue;
    const created = (event as { CreatedTreeEvent?: { value?: CreatedEventValue } }).CreatedTreeEvent?.value;
    if (created?.templateId.endsWith(expectedTemplateId.slice(expectedTemplateId.indexOf(':')))) return created;
  }
  throw new Error(`Expected ${expectedTemplateId} creation was not present in the transaction tree`);
}

async function findLocalParty(ledger: LedgerJsonApiClient, marker: string): Promise<string> {
  const { partyDetails } = await ledger.listParties({});
  const party = partyDetails.find((candidate) => candidate.isLocal && candidate.party.includes(marker))?.party;
  assert(party, `LocalNet has no local ${marker} party`);
  return party;
}

async function ensureActAsRight(ledger: LedgerJsonApiClient, party: string): Promise<void> {
  const { rights = [] } = await ledger.listUserRights({ userId: LOCALNET_USER_ID });
  const alreadyGranted = rights.some((right) => 'CanActAs' in right.kind && right.kind.CanActAs.value.party === party);
  if (alreadyGranted) return;
  await ledger.grantUserRights({
    userId: LOCALNET_USER_ID,
    rights: [{ kind: { CanActAs: { value: { party } } } }],
  });
}

async function readTraffic(scan: ScanApiClient, synchronizerId: string, partyId: string): Promise<TrafficSnapshot> {
  const { participant_id: memberId } = await scan.getPartyToParticipant({
    domainId: synchronizerId,
    partyId,
  });
  const response = await scan.getMemberTrafficStatus({ domainId: synchronizerId, memberId });
  return {
    extraConsumed: response.traffic_status.actual.total_consumed,
    limit: response.traffic_status.actual.total_limit,
    purchased: response.traffic_status.target.total_purchased,
  };
}

async function waitForPurchasedTraffic(
  scan: ScanApiClient,
  synchronizerId: string,
  partyId: string
): Promise<TrafficSnapshot> {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const snapshot = await readTraffic(scan, synchronizerId, partyId);
    if (snapshot.limit > 0 && snapshot.purchased > 0) return snapshot;
    await sleep(2_000);
  }
  throw new Error(`Timed out waiting for purchased LocalNet traffic for ${partyId}`);
}

async function main(): Promise<void> {
  process.env['DISABLE_FILE_LOGGER'] = 'true';
  process.env['CANTON_DEBUG'] = 'false';

  const provider = localnetClient('app-provider');
  const user = localnetClient('app-user');
  const systemOperatorParty = await findLocalParty(provider.ledger, 'app_provider');
  const issuerParty = await findLocalParty(user.ledger, 'app_user');
  provider.setPartyId(systemOperatorParty);
  user.setPartyId(issuerParty);
  await Promise.all([
    ensureActAsRight(provider.ledger, systemOperatorParty),
    ensureActAsRight(user.ledger, issuerParty),
  ]);

  const darPath = path.resolve('published-dars/OpenCapTable.dar');
  await access(darPath);
  await Promise.all([
    provider.ledger.uploadDarFile({ filePath: darPath }),
    user.ledger.uploadDarFile({ filePath: darPath }),
  ]);

  const generated = require(path.resolve('lib/index.js')) as {
    OCP_TEMPLATES: { ocpFactory: string; issuerAuthorization: string; capTable: string };
  };
  const templates = generated.OCP_TEMPLATES;
  const { amulet_rules: amuletRules } = await provider.validator.getAmuletRules();
  const synchronizerId = amuletRules.domain_id;
  const factory = await createFactory(provider.ledger, {
    systemOperator: systemOperatorParty,
    templateId: templates.ocpFactory,
  });

  const ocp = new OcpClient({ ledger: user.ledger, validator: user.validator, environment: 'localnet' });
  const before = {
    provider: await waitForPurchasedTraffic(provider.scan, synchronizerId, systemOperatorParty),
    user: await waitForPurchasedTraffic(user.scan, synchronizerId, issuerParty),
  };
  let after = before;
  let interactions = 0;

  for (let index = 1; index <= MAX_INTERACTIONS; index += 1) {
    const authorizationResponse = await provider.ledger.submitAndWaitForTransactionTree({
      commands: [
        {
          ExerciseCommand: {
            templateId: factory.templateId,
            contractId: factory.contractId,
            choice: 'AuthorizeIssuer',
            choiceArgument: { issuer: issuerParty },
          },
        },
      ],
      actAs: [systemOperatorParty],
    });
    const authorization = findCreatedEvent(authorizationResponse, templates.issuerAuthorization);
    const authorizationEvents = await provider.ledger.getEventsByContractId({
      contractId: authorization.contractId,
      readAs: [systemOperatorParty],
    });
    const authorizationBlob = authorizationEvents.created?.createdEvent.createdEventBlob;
    assert(authorizationBlob, 'IssuerAuthorization created-event blob is unavailable');

    const built = ocp.OpenCapTable.issuer.buildCreate({
      issuerAuthorizationContractDetails: {
        contractId: authorization.contractId,
        templateId: authorization.templateId,
        createdEventBlob: authorizationBlob,
        synchronizerId: authorizationResponse.transactionTree.synchronizerId,
      },
      issuerParty,
      issuerData: {
        id: `issuer-localnet-cross-participant-traffic-${index}`,
        object_type: 'ISSUER',
        legal_name: `LocalNet Cross-Participant Traffic Test ${index}`,
        formation_date: '2026-01-01',
        country_of_formation: 'US',
      },
    });
    const capTableResponse = await user.ledger.submitAndWaitForTransactionTree({
      commands: [built.command],
      actAs: [issuerParty],
      disclosedContracts: built.disclosedContracts,
    });
    const capTable = findCreatedEvent(capTableResponse, templates.capTable);
    if (index === 1) {
      const batch = ocp.OpenCapTable.capTable.update({
        capTableContractId: capTable.contractId,
        capTableContractDetails: { templateId: capTable.templateId },
        actAs: [issuerParty],
        readAs: [],
      });
      batch.createOperation({
        type: 'stakeholder',
        data: {
          id: 'stakeholder-localnet-cross-participant-traffic',
          object_type: 'STAKEHOLDER',
          stakeholder_type: 'INDIVIDUAL',
          name: { legal_name: 'LocalNet Traffic Test Stakeholder' },
          current_relationships: ['EMPLOYEE'],
        },
      });
      await batch.execute();
    }
    interactions = index;

    if (index % TRAFFIC_POLL_INTERVAL === 0) {
      await sleep(1_000);
      after = {
        provider: await readTraffic(provider.scan, synchronizerId, systemOperatorParty),
        user: await readTraffic(user.scan, synchronizerId, issuerParty),
      };
      if (
        after.provider.extraConsumed > before.provider.extraConsumed &&
        after.user.extraConsumed > before.user.extraConsumed
      ) {
        break;
      }
    }
  }

  after = {
    provider: await readTraffic(provider.scan, synchronizerId, systemOperatorParty),
    user: await readTraffic(user.scan, synchronizerId, issuerParty),
  };
  const providerDelta = after.provider.extraConsumed - before.provider.extraConsumed;
  const userDelta = after.user.extraConsumed - before.user.extraConsumed;
  const totalDelta = providerDelta + userDelta;

  assert(providerDelta > 0, `Expected app-provider traffic to increase; observed ${providerDelta} bytes`);
  assert(userDelta > 0, `Expected app-user traffic to increase; observed ${userDelta} bytes`);
  assert(totalDelta > 0, `Expected cross-participant traffic to increase; observed ${totalDelta} bytes`);

  console.log(
    JSON.stringify(
      {
        synchronizerId,
        appProviderExtraTrafficBytes: providerDelta,
        appUserExtraTrafficBytes: userDelta,
        totalExtraTrafficBytes: totalDelta,
        interactions,
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
