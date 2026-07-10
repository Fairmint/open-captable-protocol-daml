#!/usr/bin/env tsx

import assert from 'assert/strict';

import { convertToDaml, type OcfEquityCompensationIssuance } from '@open-captable-protocol/canton';

import {
  groupRowsByPortal,
  hashIdentifier,
  matchesLedgerTemplateId,
  parseReplayOptions,
  preparePortal,
  prepareReplaySnapshot,
  renderPrivateReplayFailure,
  renderReplayMarkdown,
  ReplayPhaseError,
  resolveDatabaseUrl,
  toPublicReplayReport,
  toReplayFailure,
  type DatabaseOcfRow,
  type ReplayReport,
} from './localnet-replay/core';

const PORTAL_ID = '550e8400-e29b-41d4-a716-446655440000';
const SECOND_PORTAL_ID = 'a8b6b453-c3b0-4c97-8631-0df9bb11f51a';

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
  assert.equal(defaults.validationMode, 'ledger-backed');
  assert.equal(defaults.preflightOnly, false);
  assert.match(defaults.reportDir, /artifacts\/ocf-localnet-replay$/);

  const production = parseReplayOptions([
    '--database',
    'production',
    '--validation-mode',
    'require-ledger-coverage',
    '--preflight-only',
    '--portal-id',
    PORTAL_ID,
    '--report-dir',
    'tmp/report',
  ]);
  assert.equal(production.database, 'production');
  assert.equal(production.validationMode, 'require-ledger-coverage');
  assert.equal(production.preflightOnly, true);
  assert.equal(production.portalId, PORTAL_ID);
  assert.match(production.reportDir, /tmp\/report$/);
  assert.throws(() => parseReplayOptions(['--database', 'mainnet']), /dev or production/);
  assert.throws(() => parseReplayOptions(['--validation-mode', 'strict']), /ledger-backed or require-ledger-coverage/);

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
  const allInvalidRowsPlan = prepareReplaySnapshot([
    invalidSchemaRows[0],
    {
      ...validRows[1],
      data: {
        object_type: 'STAKEHOLDER',
        stakeholder_type: 'INDIVIDUAL',
        name: { legal_name: 'Another Sensitive Person' },
      },
    },
  ]);
  assert.deepEqual(allInvalidRowsPlan.failures[0].diagnostics, [
    { code: 'MISSING_REQUIRED_FIELD', path: 'id' },
    {
      code: 'SCHEMA_VALIDATION_FAILED',
      objectType: 'ISSUER',
      path: 'legal_name',
      objectAlias: hashIdentifier('invalid-issuer-id', 'object'),
    },
  ]);
  const schemaFailureText = JSON.stringify(allInvalidRowsPlan.failures[0]);
  assert.match(schemaFailureText, /ISSUER.*legal_name/);
  assert.doesNotMatch(schemaFailureText, /invalid-issuer-id|Another Sensitive Person/);

  const mismatchedMappingRows: DatabaseOcfRow[] = [{ ...validRows[0], type: 'STAKEHOLDER' }];
  expectReplayPhase(() => preparePortal(mismatchedMappingRows), 'mapping');

  const unknownSchemaRows: DatabaseOcfRow[] = [
    { ...validRows[0], data: { id: 'unknown-schema-id', object_type: 'NOT_AN_OCF_OBJECT' } },
  ];
  expectReplayPhase(() => preparePortal(unknownSchemaRows), 'schema');

  const planSecurityPortal = preparePortal([
    validRows[0],
    validRows[1],
    {
      portalId: PORTAL_ID,
      type: 'STOCK_CLASS',
      subtype: null,
      data: {
        object_type: 'STOCK_CLASS',
        id: 'plan-stock-class',
        class_type: 'COMMON',
        default_id_prefix: 'CS-',
        initial_shares_authorized: '1000000',
        name: 'Plan Common Stock',
        seniority: '1',
        votes_per_share: '1',
      },
    },
    {
      portalId: PORTAL_ID,
      type: 'STOCK_PLAN',
      subtype: null,
      data: {
        object_type: 'STOCK_PLAN',
        id: 'plan-1',
        plan_name: 'Synthetic Plan',
        initial_shares_reserved: '1000',
        stock_class_ids: ['plan-stock-class'],
      },
    },
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
  const normalizedPlanSecurity = planSecurityPortal.creates.find((item) => item.objectId === 'grant-1');
  assert.ok(normalizedPlanSecurity);
  assert.equal(normalizedPlanSecurity.entityType, 'equityCompensationIssuance');
  assert.equal(normalizedPlanSecurity.data.object_type, 'TX_EQUITY_COMPENSATION_ISSUANCE');
  const convertedPlanSecurity = convertToDaml(
    'equityCompensationIssuance',
    normalizedPlanSecurity.data as unknown as OcfEquityCompensationIssuance
  );
  assert.equal(convertedPlanSecurity.id, 'grant-1');
  assert.equal(convertedPlanSecurity.compensation_type, 'OcfCompensationTypeRSU');

  const orphanedStockIssuanceRows: DatabaseOcfRow[] = [
    validRows[0],
    {
      portalId: PORTAL_ID,
      type: 'STOCK_CLASS',
      subtype: null,
      data: {
        object_type: 'STOCK_CLASS',
        id: 'stock-class-common',
        class_type: 'COMMON',
        default_id_prefix: 'CS-',
        initial_shares_authorized: '1000000',
        name: 'Common Stock',
        seniority: '1',
        votes_per_share: '1',
      },
    },
    {
      portalId: PORTAL_ID,
      type: 'OBJECT',
      subtype: 'STOCK_LEGEND_TEMPLATE',
      data: {
        object_type: 'STOCK_LEGEND_TEMPLATE',
        id: 'legend-standard',
        name: 'Standard legend',
        text: 'Synthetic legend text',
      },
    },
    {
      portalId: PORTAL_ID,
      type: 'TRANSACTION',
      subtype: 'TX_STOCK_ISSUANCE',
      data: {
        object_type: 'TX_STOCK_ISSUANCE',
        id: 'stock-issuance-orphaned',
        date: '2024-02-01',
        security_id: 'security-orphaned',
        custom_id: 'CS-1',
        stakeholder_id: 'stakeholder-moved-to-another-portal',
        stock_class_id: 'stock-class-common',
        security_law_exemptions: [],
        share_price: { amount: '1', currency: 'USD' },
        quantity: '100',
        stock_legend_ids: ['legend-standard'],
      },
    },
  ];
  const orphanedPlan = prepareReplaySnapshot(orphanedStockIssuanceRows);
  assert.equal(orphanedPlan.portals.length, 0);
  assert.deepEqual(
    orphanedPlan.failures.map((failure) => failure.phase),
    ['snapshot']
  );
  assert.deepEqual(orphanedPlan.failures[0].diagnostics, [
    {
      code: 'MISSING_REFERENCE',
      objectType: 'TX_STOCK_ISSUANCE',
      path: 'stakeholder_id',
      objectAlias: hashIdentifier('stock-issuance-orphaned', 'object'),
    },
  ]);

  const financingRow: DatabaseOcfRow = {
    portalId: PORTAL_ID,
    type: 'FINANCING',
    subtype: null,
    data: {
      object_type: 'FINANCING',
      id: 'financing-secret-id',
      name: 'Sensitive Series A',
      issuance_ids: ['historical-issuance-id'],
      date: '2024-03-01',
    },
  };
  const ledgerBackedPlan = prepareReplaySnapshot([...validRows, financingRow]);
  assert.equal(ledgerBackedPlan.failures.length, 0);
  assert.equal(ledgerBackedPlan.portals.length, 1);
  assert.equal(ledgerBackedPlan.portals[0].creates.length, 1);
  assert.deepEqual(
    ledgerBackedPlan.warnings.map((warning) => warning.code),
    ['SCHEMA_ONLY_OBJECT_EXCLUDED']
  );
  const coveragePlan = prepareReplaySnapshot([...validRows, financingRow], 'require-ledger-coverage');
  assert.equal(coveragePlan.portals.length, 0);
  assert.deepEqual(
    coveragePlan.failures.map((failure) => failure.phase),
    ['capability']
  );
  assert.deepEqual(coveragePlan.failures[0].diagnostics, [
    {
      code: 'SCHEMA_ONLY_OBJECT_EXCLUDED',
      objectType: 'FINANCING',
      objectAlias: hashIdentifier('financing-secret-id', 'object'),
    },
  ]);
  const invalidFinancingPlan = prepareReplaySnapshot([
    ...validRows,
    {
      ...financingRow,
      data: { ...(financingRow.data as Record<string, unknown>), issuance_ids: [] },
    },
  ]);
  assert.deepEqual(
    invalidFinancingPlan.failures.map((failure) => failure.phase),
    ['schema']
  );
  assert.equal(invalidFinancingPlan.warnings.length, 0);

  const issuerlessRows: DatabaseOcfRow[] = [{ ...validRows[1], portalId: SECOND_PORTAL_ID }];
  const issuerlessDefaultPlan = prepareReplaySnapshot(issuerlessRows);
  assert.equal(issuerlessDefaultPlan.failures.length, 0);
  assert.equal(issuerlessDefaultPlan.excludedPortalCount, 1);
  assert.deepEqual(
    issuerlessDefaultPlan.warnings.map((warning) => warning.code),
    ['ISSUERLESS_PORTAL_EXCLUDED']
  );
  const issuerlessCoveragePlan = prepareReplaySnapshot(issuerlessRows, 'require-ledger-coverage');
  assert.equal(issuerlessCoveragePlan.excludedPortalCount, 0);
  assert.deepEqual(
    issuerlessCoveragePlan.failures.map((failure) => failure.phase),
    ['snapshot']
  );

  const duplicateIssuerPlan = prepareReplaySnapshot([
    validRows[0],
    {
      ...validRows[0],
      data: {
        id: 'second-issuer-secret-id',
        object_type: 'ISSUER',
        legal_name: 'Second Sensitive Company Name',
        formation_date: '2022-01-15',
        country_of_formation: 'US',
      },
    },
  ]);
  assert.deepEqual(
    duplicateIssuerPlan.failures.map((failure) => failure.phase),
    ['snapshot']
  );
  assert.equal(duplicateIssuerPlan.failures[0].diagnostics?.length, 2);
  for (const diagnostic of duplicateIssuerPlan.failures[0].diagnostics ?? []) {
    assert.equal(diagnostic.code, 'ISSUER_CARDINALITY');
    assert.equal(diagnostic.objectType, 'ISSUER');
    assert.match(diagnostic.objectAlias ?? '', /^object-[0-9a-f]{12}$/);
  }

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

  const failurePortalAlias = hashIdentifier(PORTAL_ID, 'portal');
  const failureObjectAlias = hashIdentifier('stakeholder-secret-id', 'object');
  const failure = toReplayFailure(
    failurePortalAlias,
    new ReplayPhaseError('batch', 'Sensitive Person and stakeholder-secret-id failed', {
      objectAlias: failureObjectAlias,
      diagnostics: [
        {
          code: 'MISSING_REFERENCE',
          objectType: 'TX_STOCK_ISSUANCE',
          path: 'stakeholder_id',
          objectAlias: failureObjectAlias,
        },
      ],
    })
  );
  assert.equal(failure.phase, 'batch');
  assert.doesNotMatch(failure.message, /Sensitive Person|stakeholder-secret-id/);
  const privateFailureText = renderPrivateReplayFailure(failure);
  assert.match(privateFailureText, new RegExp(`${failurePortalAlias}.*${failureObjectAlias}`));
  assert.match(privateFailureText, /MISSING_REFERENCE \(TX_STOCK_ISSUANCE\.stakeholder_id\)/);
  assert.doesNotMatch(privateFailureText, /stakeholder-secret-id|Sensitive Person/);

  const privateReport: ReplayReport = {
    database: 'production',
    validationMode: 'ledger-backed',
    executionMode: 'replay',
    gitRef: 'main',
    gitSha: 'abc123',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1_000,
    sourceObjectCount: 456,
    portalCount: 13,
    passedPortalCount: 11,
    failedPortalCount: 1,
    excludedPortalCount: 1,
    notRunPortalCount: 0,
    createdObjectCount: 444,
    status: 'failed',
    warnings: [
      {
        portalAlias: 'portal-sensitive-alias',
        objectAlias: 'object-sensitive-alias',
        phase: 'capability',
        code: 'SCHEMA_ONLY_OBJECT_EXCLUDED',
        message: 'Sensitive Series A was excluded',
        objectType: 'FINANCING',
      },
    ],
    results: [
      {
        portalAlias: failurePortalAlias,
        sourceObjectCount: 456,
        createdObjectCount: 0,
        durationMs: 10,
        success: false,
        failure,
      },
    ],
  };
  const publicReportText = JSON.stringify(toPublicReplayReport(privateReport));
  assert.doesNotMatch(
    publicReportText,
    new RegExp(
      `${failurePortalAlias}|${failureObjectAlias}|portal-sensitive-alias|object-sensitive-alias|Sensitive Person|Sensitive Series A|stakeholder-secret-id|456|444`
    )
  );
  assert.doesNotMatch(publicReportText, /notRunPortalCount|objectAlias|portalAlias/);
  assert.match(publicReportText, /"failurePhases":\["batch"\]/);
  assert.match(
    publicReportText,
    /"diagnostics":\[\{"code":"MISSING_REFERENCE","objectType":"TX_STOCK_ISSUANCE","path":"stakeholder_id"\}\]/
  );
  assert.match(publicReportText, /"warningCodes":\["SCHEMA_ONLY_OBJECT_EXCLUDED"\]/);
  const publicMarkdown = renderReplayMarkdown(privateReport);
  assert.doesNotMatch(publicMarkdown, /portal-sensitive-alias|object-sensitive-alias|Sensitive Series A|456|444/);
  assert.match(publicMarkdown, /MISSING_REFERENCE \(TX_STOCK_ISSUANCE\.stakeholder_id\)/);
  const preflightMarkdown = renderReplayMarkdown({
    ...privateReport,
    executionMode: 'preflight',
    portalCount: 11,
    passedPortalCount: 0,
    failedPortalCount: 0,
    excludedPortalCount: 0,
    notRunPortalCount: 11,
    createdObjectCount: 0,
    status: 'passed',
    warnings: [],
    results: [],
  });
  assert.match(preflightMarkdown, /database replay preflight/);
  assert.match(preflightMarkdown, /ready for LocalNet/);
  assert.doesNotMatch(preflightMarkdown, /converged on LocalNet/);

  const portalAlias = hashIdentifier(PORTAL_ID, 'portal');
  assert.match(portalAlias, /^portal-[0-9a-f]{12}$/);
  assert.notEqual(portalAlias, PORTAL_ID);

  console.log('OK: LocalNet replay planning, strict schema gate, template identity, and payload-free reports');
}

run();
