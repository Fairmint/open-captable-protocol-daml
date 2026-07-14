#!/usr/bin/env tsx

import assert from 'assert/strict';

import {
  groupRowsByPortal,
  hashIdentifier,
  matchesLedgerTemplateId,
  parseReplayOptions,
  preparePortal,
  renderReplayMarkdown,
  ReplayPhaseError,
  resolveDatabaseUrl,
  toOcfCreateOperation,
  toPublicReplayReport,
  toReplayFailure,
  type DatabaseOcfRow,
  type ReplayReport,
} from './localnet-replay/core';
import {
  buildNetworkTrafficPricing,
  buildReplayTrafficReport,
  getPaidTrafficCostBytes,
  getParticipantTrafficConsumedBytes,
} from './localnet-replay/traffic';

const PORTAL_ID = '550e8400-e29b-41d4-a716-446655440000';

const validRows: DatabaseOcfRow[] = [
  {
    portalId: PORTAL_ID,
    type: 'ISSUER',
    subtype: null,
    data: {
      id: 'issuer-secret-id',
      object_type: 'ISSUER',
      legal_name: 'Sensitive Company Name',
      formation_date: '2022-01-15',
      country_of_formation: 'US',
    },
  },
  {
    portalId: PORTAL_ID,
    type: 'STAKEHOLDER',
    subtype: null,
    data: {
      id: 'stakeholder-secret-id',
      object_type: 'STAKEHOLDER',
      stakeholder_type: 'INDIVIDUAL',
      name: { legal_name: 'Sensitive Person' },
      current_relationships: ['EMPLOYEE'],
    },
  },
];

function expectReplayPhase(fn: () => unknown, phase: ReplayPhaseError['phase']): void {
  assert.throws(fn, (error: unknown) => error instanceof ReplayPhaseError && error.phase === phase);
}

function run(): void {
  const defaults = parseReplayOptions([]);
  assert.equal(defaults.database, 'dev');
  assert.match(defaults.reportDir, /artifacts\/ocf-localnet-replay$/);

  const production = parseReplayOptions([
    '--database',
    'production',
    '--portal-id',
    PORTAL_ID,
    '--report-dir',
    'tmp/report',
  ]);
  assert.equal(production.database, 'production');
  assert.equal(production.portalId, PORTAL_ID);
  assert.match(production.reportDir, /tmp\/report$/);
  assert.throws(() => parseReplayOptions(['--database', 'mainnet']), /dev or production/);

  assert.deepEqual(resolveDatabaseUrl('dev', { POSTGRES_DB_URL_DEVNET: 'postgres://dev' }), {
    url: 'postgres://dev',
    envName: 'POSTGRES_DB_URL_DEVNET',
  });
  assert.deepEqual(resolveDatabaseUrl('production', { POSTGRES_DB_URL_MAINNET: 'postgres://prod' }), {
    url: 'postgres://prod',
    envName: 'POSTGRES_DB_URL_MAINNET',
  });

  const grouped = groupRowsByPortal(validRows);
  assert.equal(grouped.size, 1);
  assert.equal(grouped.get(PORTAL_ID)?.length, 2);

  const portal = preparePortal(validRows);
  assert.equal(portal.portalAlias, hashIdentifier(PORTAL_ID, 'portal'));
  assert.equal(portal.issuer.entityType, 'issuer');
  assert.equal(portal.creates.length, 1);
  assert.equal(portal.creates[0].entityType, 'stakeholder');
  expectReplayPhase(() => toOcfCreateOperation(portal.issuer), 'mapping');

  const invalidSchemaRows: DatabaseOcfRow[] = [
    {
      ...validRows[0],
      data: {
        id: 'invalid-issuer-id',
        object_type: 'ISSUER',
        formation_date: '2022-01-15',
        country_of_formation: 'US',
      },
    },
  ];
  expectReplayPhase(() => preparePortal(invalidSchemaRows), 'schema');

  const mismatchedMappingRows: DatabaseOcfRow[] = [{ ...validRows[0], type: 'STAKEHOLDER' }];
  expectReplayPhase(() => preparePortal(mismatchedMappingRows), 'mapping');

  const unknownSchemaRows: DatabaseOcfRow[] = [
    { ...validRows[0], data: { id: 'unknown-schema-id', object_type: 'NOT_AN_OCF_OBJECT' } },
  ];
  expectReplayPhase(() => preparePortal(unknownSchemaRows), 'schema');

  const planSecurityPortal = preparePortal([
    validRows[0],
    {
      portalId: PORTAL_ID,
      type: 'TRANSACTION',
      subtype: 'TX_PLAN_SECURITY_ISSUANCE',
      data: {
        object_type: 'TX_PLAN_SECURITY_ISSUANCE',
        id: 'grant-1',
        custom_id: 'grant-1',
        security_id: 'security-1',
        stakeholder_id: 'stakeholder-secret-id',
        stock_plan_id: 'plan-1',
        compensation_type: 'RSU',
        quantity: '1000',
        date: '2024-01-01',
        expiration_date: null,
        termination_exercise_windows: [],
        security_law_exemptions: [],
      },
    },
  ]);
  assert.equal(planSecurityPortal.creates[0].entityType, 'equityCompensationIssuance');
  const planSecurityOperation = toOcfCreateOperation(planSecurityPortal.creates[0]);
  assert.equal(planSecurityOperation.type, 'equityCompensationIssuance');
  assert.equal(planSecurityOperation.data.object_type, 'TX_EQUITY_COMPENSATION_ISSUANCE');

  const financingPortal = preparePortal([
    validRows[0],
    {
      portalId: PORTAL_ID,
      type: 'FINANCING',
      subtype: null,
      data: {
        object_type: 'FINANCING',
        id: 'financing-1',
        name: 'Series A',
        issuance_ids: ['stock-issuance-1'],
        date: '2024-01-02',
      },
    },
  ]);
  assert.equal(financingPortal.creates[0].entityType, 'financing');
  const financingOperation = toOcfCreateOperation(financingPortal.creates[0]);
  assert.equal(financingOperation.type, 'financing');
  assert.equal(financingOperation.data.object_type, 'FINANCING');
  assert.deepEqual(financingOperation.data.issuance_ids, ['stock-issuance-1']);

  assert.equal(
    matchesLedgerTemplateId(
      '534319ff0f8e273fce07984ee471fa86c19b15528e177f7e3e42ba858d89ed8d:Fairmint.OpenCapTable.CapTable:CapTable',
      '#OpenCapTable-v34:Fairmint.OpenCapTable.CapTable:CapTable'
    ),
    true
  );
  assert.equal(
    matchesLedgerTemplateId(
      '534319ff0f8e273fce07984ee471fa86c19b15528e177f7e3e42ba858d89ed8d:Fairmint.OpenCapTable.OCF.Issuer:Issuer',
      '#OpenCapTable-v34:Fairmint.OpenCapTable.CapTable:CapTable'
    ),
    false
  );

  assert.equal(getPaidTrafficCostBytes({ paidTrafficCost: 12_345 }), 12_345);
  assert.equal(getPaidTrafficCostBytes({ paidTrafficCost: '67890' }), 67_890);
  assert.equal(getPaidTrafficCostBytes({ paidTrafficCost: Number.MAX_SAFE_INTEGER + 1 }), undefined);
  assert.equal(
    getParticipantTrafficConsumedBytes({ traffic_status: { actual: { total_consumed: 987_654 } } }),
    987_654
  );

  const observedAt = new Date('2026-01-01T00:00:00.000Z');
  const pricing = buildNetworkTrafficPricing(
    {
      amulet_rules: {
        contract: {
          payload: {
            configSchedule: {
              initialValue: {
                decentralizedSynchronizer: { fees: { extraTrafficPrice: '60.0' } },
              },
              futureValues: [
                {
                  _1: '2025-12-31T00:00:00.000Z',
                  _2: { decentralizedSynchronizer: { fees: { extraTrafficPrice: '50.0' } } },
                },
                {
                  _1: '2026-02-01T00:00:00.000Z',
                  _2: { decentralizedSynchronizer: { fees: { extraTrafficPrice: '40.0' } } },
                },
              ],
            },
          },
        },
      },
    },
    {
      open_mining_rounds: [
        {
          contract: {
            payload: {
              opensAt: '2025-12-30T00:00:00.000Z',
              round: { number: '10' },
              amuletPrice: '0.005',
            },
          },
        },
        {
          contract: {
            payload: {
              opensAt: '2025-12-31T00:00:00.000Z',
              round: { number: '11' },
              amuletPrice: '0.01',
            },
          },
        },
        {
          contract: {
            payload: {
              opensAt: '2026-01-02T00:00:00.000Z',
              round: { number: '12' },
              amuletPrice: '0.02',
            },
          },
        },
      ],
    },
    observedAt
  );
  assert.deepEqual(pricing, {
    observedAt: observedAt.toISOString(),
    extraTrafficPriceUsdPerMegabyte: 50,
    cantonCoinPriceUsd: 0.01,
  });

  const traffic = buildReplayTrafficReport({
    participantTrafficBeforeBytes: 1_000,
    participantTrafficAfterBytes: 2_001_000,
    committedTransactionCount: 4,
    measuredTransactionCount: 4,
    confirmationRequestTrafficBytes: 1_800_000,
    pricingAtStart: pricing,
    pricingAtEnd: { ...pricing, observedAt: '2026-01-01T00:01:00.000Z' },
  });
  assert.equal(traffic.measurementStatus, 'complete');
  assert.equal(traffic.measurementScope, 'participant-replay-window');
  assert.equal(traffic.totalTrafficBytes, 2_000_000);
  assert.equal(traffic.totalTrafficMegabytes, 2);
  assert.equal(traffic.equivalentExtraTrafficCostUsd, 100);
  assert.equal(traffic.equivalentExtraTrafficCostCantonCoin, 10_000);

  const changedPricingTraffic = buildReplayTrafficReport({
    committedTransactionCount: 1,
    measuredTransactionCount: 1,
    confirmationRequestTrafficBytes: 1_000_000,
    pricingAtStart: pricing,
    pricingAtEnd: { ...pricing, extraTrafficPriceUsdPerMegabyte: 55 },
  });
  assert.equal(changedPricingTraffic.measurementScope, 'confirmation-requests');
  assert.equal(changedPricingTraffic.pricingChangedDuringReplay, true);
  assert.equal(changedPricingTraffic.equivalentExtraTrafficCostCantonCoin, undefined);

  const failure = toReplayFailure(
    'portal-run-local',
    new ReplayPhaseError('batch', 'Sensitive Person and stakeholder-secret-id failed')
  );
  assert.equal(failure.phase, 'batch');
  assert.doesNotMatch(failure.message, /Sensitive Person|stakeholder-secret-id/);

  const privateReport: ReplayReport = {
    database: 'production',
    gitRef: 'main',
    gitSha: 'abc123',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1_000,
    sourceObjectCount: 456,
    portalCount: 12,
    passedPortalCount: 11,
    failedPortalCount: 1,
    createdObjectCount: 444,
    status: 'failed',
    traffic,
    results: [
      {
        portalAlias: 'portal-run-local',
        sourceObjectCount: 456,
        createdObjectCount: 0,
        durationMs: 10,
        success: false,
        failure,
      },
    ],
  };
  const publicReportText = JSON.stringify(toPublicReplayReport(privateReport));
  assert.doesNotMatch(publicReportText, /portal-run-local|Sensitive Person|stakeholder-secret-id|456|444/);
  assert.doesNotMatch(publicReportText, /committedTransactionCount|measuredTransactionCount/);
  assert.match(publicReportText, /"failurePhases":\["batch"\]/);
  assert.match(publicReportText, /"totalTrafficMegabytes":2/);

  const markdown = renderReplayMarkdown(privateReport);
  assert.match(markdown, /Total participant traffic consumed during the replay window/);
  assert.match(markdown, /10000\.000000 CC/);

  const portalAlias = hashIdentifier(PORTAL_ID, 'portal');
  assert.match(portalAlias, /^portal-[0-9a-f]{12}$/);
  assert.notEqual(portalAlias, PORTAL_ID);

  console.log('OK: LocalNet replay planning, strict schema gate, template identity, and payload-free reports');
}

run();
