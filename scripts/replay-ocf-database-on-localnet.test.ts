#!/usr/bin/env tsx

import assert from 'assert/strict';
import { readFileSync } from 'fs';
import path from 'path';

import { parse as parseYaml } from 'yaml';

import {
  groupRowsByPortal,
  hashIdentifier,
  matchesLedgerTemplateId,
  parseReplayOptions,
  preparePortal,
  ReplayPhaseError,
  resolveDatabaseUrl,
  resolveReplayRevisionContext,
  toOcfCreateOperation,
  toPublicReplayReport,
  toReplayFailure,
  type DatabaseOcfRow,
  type ReplayReport,
} from './localnet-replay/core';

const PORTAL_ID = '550e8400-e29b-41d4-a716-446655440000';
const WORKFLOW_SHA = '1111111111111111111111111111111111111111';
const CONTRACT_SHA = '2222222222222222222222222222222222222222';

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

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function requireSteps(job: Record<string, unknown>, label: string): Array<Record<string, unknown>> {
  const { steps } = job;
  assert(Array.isArray(steps), `${label}.steps must be an array`);
  return steps.map((step, index) => requireRecord(step, `${label}.steps[${index}]`));
}

function findStep(steps: Array<Record<string, unknown>>, name: string): Record<string, unknown> {
  const step = steps.find((candidate) => candidate['name'] === name);
  assert(step, `Missing workflow step: ${name}`);
  return step;
}

function verifyWorkflowTrustBoundary(): void {
  const workflowText = readFileSync(path.resolve('.github/workflows/replay-ocf-database.yml'), 'utf8');
  const workflow = requireRecord(parseYaml(workflowText) as unknown, 'workflow');
  assert.deepEqual(requireRecord(workflow['permissions'], 'workflow permissions'), {});
  const jobs = requireRecord(workflow['jobs'], 'workflow.jobs');
  const validateJob = requireRecord(jobs['validate-request'], 'validate-request');
  const buildJob = requireRecord(jobs['build-target-dar'], 'build-target-dar');
  const replayJob = requireRecord(jobs['replay'], 'replay');

  assert.equal(validateJob['environment'], undefined);
  assert.equal(buildJob['environment'], undefined);
  assert.doesNotMatch(JSON.stringify(buildJob), /secrets\./);
  assert.deepEqual(requireRecord(buildJob['permissions'], 'build permissions'), { contents: 'read' });
  assert.equal(
    requireRecord(buildJob['outputs'], 'build outputs')['artifact_id'],
    '${{ steps.upload-dar.outputs.artifact-id }}'
  );
  assert.deepEqual(requireRecord(replayJob['permissions'], 'replay permissions'), {
    actions: 'read',
    contents: 'read',
  });

  const validateSteps = requireSteps(validateJob, 'validate-request');
  const defaultBranchGuard = findStep(validateSteps, 'Require the trusted default-branch workflow');
  assert.match(String(defaultBranchGuard['run']), /GITHUB_REF.*EXPECTED_REF/);
  assert.doesNotMatch(String(defaultBranchGuard['run']), /inputs\.database/);

  const buildSteps = requireSteps(buildJob, 'build-target-dar');
  const targetCheckout = findStep(buildSteps, 'Checkout the pinned contract commit');
  const targetCheckoutInputs = requireRecord(targetCheckout['with'], 'target checkout inputs');
  assert.equal(targetCheckoutInputs['ref'], '${{ needs.validate-request.outputs.target-sha }}');
  assert.equal(targetCheckoutInputs['persist-credentials'], false);
  assert.equal(findStep(buildSteps, 'Upload the single target DAR')['id'], 'upload-dar');
  assert.match(String(findStep(buildSteps, 'Generate and build only the target OpenCapTable DAR')['run']), /dpm build/);

  const replaySteps = requireSteps(replayJob, 'replay');
  const trustedCheckout = findStep(replaySteps, 'Checkout the trusted replay harness');
  const trustedCheckoutInputs = requireRecord(trustedCheckout['with'], 'trusted checkout inputs');
  assert.equal(trustedCheckoutInputs['ref'], '${{ github.sha }}');
  assert.equal(trustedCheckoutInputs['persist-credentials'], false);

  const downloadDarInputs = requireRecord(
    findStep(replaySteps, 'Download the pinned target DAR')['with'],
    'download DAR inputs'
  );
  assert.equal(downloadDarInputs['artifact-ids'], '${{ needs.build-target-dar.outputs.artifact_id }}');
  assert.equal(downloadDarInputs['path'], 'target-dar');
  assert.equal(downloadDarInputs['digest-mismatch'], 'error');

  const artifactValidation = findStep(replaySteps, 'Validate and install the pinned DAR');
  const artifactValidationScript = String(artifactValidation['run']);
  assert.match(artifactValidationScript, /artifact_entries/);
  assert.match(artifactValidationScript, /EXPECTED_DAR_SIZE/);
  assert.match(artifactValidationScript, /EXPECTED_DAR_SHA256/);
  assert.match(artifactValidationScript, /inspect-dar/);
  assert.match(artifactValidationScript, /OpenCapTable-v34/);
  assert.match(artifactValidationScript, /Fairmint\.OpenCapTable\.OcpFactory/);
  assert.match(artifactValidationScript, /Fairmint\.OpenCapTable\.IssuerAuthorization/);
  assert.match(artifactValidationScript, /Fairmint\.OpenCapTable\.CapTable/);
  assert.match(artifactValidationScript, /published-dars\/OpenCapTable\.dar/);

  const replayStep = findStep(replaySteps, 'Replay every committed OCF object');
  const replayEnvironment = requireRecord(replayStep['env'], 'replay environment');
  assert.equal(replayEnvironment['OCP_REPLAY_CONTRACT_SHA'], '${{ needs.validate-request.outputs.target-sha }}');
  assert.match(String(replayStep['run']), /RUNNER_TEMP\/ocf-replay\.log.*2>&1/);
  assert.doesNotMatch(workflowText, /path:.*ocf-replay\.log/);

  const environment = requireRecord(replayJob['environment'], 'replay environment gate');
  assert.match(String(environment['name']), /production-data/);
  assert.match(String(environment['name']), /development-data/);
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

  assert.deepEqual(
    resolveReplayRevisionContext({
      GITHUB_REF_NAME: 'main',
      GITHUB_SHA: WORKFLOW_SHA.toUpperCase(),
      OCP_REPLAY_CONTRACT_SHA: CONTRACT_SHA.toUpperCase(),
    }),
    { gitRef: 'main', workflowSha: WORKFLOW_SHA, contractSha: CONTRACT_SHA }
  );
  assert.deepEqual(resolveReplayRevisionContext({ GITHUB_SHA: WORKFLOW_SHA }), {
    gitRef: null,
    workflowSha: WORKFLOW_SHA,
    contractSha: WORKFLOW_SHA,
  });
  expectReplayPhase(() => resolveReplayRevisionContext({ GITHUB_SHA: 'abc123' }), 'infrastructure');

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

  const failure = toReplayFailure(
    'portal-run-local',
    new ReplayPhaseError('batch', 'Sensitive Person and stakeholder-secret-id failed')
  );
  assert.equal(failure.phase, 'batch');
  assert.doesNotMatch(failure.message, /Sensitive Person|stakeholder-secret-id/);

  const privateReport: ReplayReport = {
    database: 'production',
    gitRef: 'main',
    gitSha: WORKFLOW_SHA,
    contractSha: CONTRACT_SHA,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1_000,
    sourceObjectCount: 456,
    portalCount: 12,
    passedPortalCount: 11,
    failedPortalCount: 1,
    createdObjectCount: 444,
    status: 'failed',
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
  assert.match(publicReportText, /"failurePhases":\["batch"\]/);
  assert.match(publicReportText, new RegExp(`"gitSha":"${WORKFLOW_SHA}"`));
  assert.match(publicReportText, new RegExp(`"contractSha":"${CONTRACT_SHA}"`));

  const portalAlias = hashIdentifier(PORTAL_ID, 'portal');
  assert.match(portalAlias, /^portal-[0-9a-f]{12}$/);
  assert.notEqual(portalAlias, PORTAL_ID);

  verifyWorkflowTrustBoundary();

  console.log(
    'OK: LocalNet replay planning, strict schema gate, trusted workflow boundary, template identity, and payload-free reports'
  );
}

run();
