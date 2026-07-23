#!/usr/bin/env tsx

import { access, appendFile, mkdir, writeFile } from 'fs/promises';
import path from 'path';

import {
  Canton,
  type LedgerJsonApiClient,
  type ScanApiClient,
  type ValidatorApiClient,
} from '@fairmint/canton-node-sdk';
import {
  buildCantonOcfDataMap,
  computeReplicationDiff,
  createFactory,
  extractCantonOcfManifest,
  getCapTableState,
  OcpClient,
  toCantonConfig,
  type OcfIssuer,
} from '@open-captable-protocol/canton';
import { Pool, type PoolConfig } from 'pg';

import {
  escapeWorkflowCommand,
  groupRowsByPortal,
  hashIdentifier,
  matchesLedgerTemplateId,
  parseReplayOptions,
  preparePortal,
  renderReplayMarkdown,
  ReplayHelpRequested,
  ReplayPhaseError,
  replayUsage,
  resolveDatabaseUrl,
  toOcfCreateOperation,
  toPublicReplayReport,
  toReplayFailure,
  type DatabaseOcfRow,
  type PortalReplayResult,
  type PreparedOcfObject,
  type PreparedPortal,
  type ReplayFailure,
  type ReplayOptions,
  type ReplayReport,
} from './localnet-replay/core';
import {
  buildNetworkTrafficPricing,
  buildReplayTrafficReport,
  getParticipantExtraTrafficConsumedBytes,
  type NetworkTrafficPricing,
  type ReplayTrafficReport,
} from './localnet-replay/traffic';

const LOCALNET_USER_ID = 'ledger-api-user';
const POSTGRES_SSL_QUERY_KEYS = ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert'] as const;
const CONVERGENCE_RETRY_DELAYS_MS = [0, 1_000, 2_000, 5_000, 10_000] as const;
const PARTY_VISIBILITY_RETRY_DELAYS_MS = [0, 250, 500, 1_000, 2_000, 5_000, 10_000] as const;
const TRAFFIC_SETTLEMENT_DELAYS_MS = [2_000, 1_000, 1_000, 1_000, 1_000, 2_000, 2_000] as const;
const TRAFFIC_SETTLEMENT_MINIMUM_WAIT_MS = 5_000;

export function buildReplayCantonConfig(
  provider: 'app-provider' | 'app-user' = 'app-provider'
): ConstructorParameters<typeof Canton>[0] {
  const portPrefix = provider === 'app-provider' ? '3' : '2';
  return toCantonConfig({
    environment: 'localnet',
    provider,
    ledgerApiUrl: `http://localhost:${portPrefix}975`,
    validatorApiUrl: `http://localhost:${portPrefix}903`,
    scanApiUrl: 'http://scan.localhost:4000/api/scan',
  });
}

interface LocalTemplates {
  ocpFactory: string;
  issuerAuthorization: string;
  capTable: string;
}

interface ReplayLedgerContext {
  issuerOcp: OcpClient;
  operatorLedger: LedgerJsonApiClient;
  issuerLedger: LedgerJsonApiClient;
  systemOperatorParty: string;
  issuerParticipantParty: string;
  synchronizerId: string;
  operatorActAsRights: Set<string>;
  issuerActAsRights: Set<string>;
  factory: {
    contractId: string;
    templateId: string;
  };
  templates: LocalTemplates;
  trafficMeter: ReplayTrafficMeter;
}

interface ContractDetails {
  contractId: string;
  templateId: string;
  createdEventBlob: string;
  synchronizerId: string;
}

interface CreatedEventValue {
  contractId: string;
  templateId: string;
  createdEventBlob?: string;
  createArgument?: unknown;
}

type TrafficCounters = readonly [number | undefined, number | undefined];

interface PollOptions {
  delaysMs?: readonly number[];
  minimumWaitMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function waitForStableTrafficCounters(
  readCounters: () => TrafficCounters | Promise<TrafficCounters>,
  options: PollOptions = {}
): Promise<TrafficCounters> {
  const delaysMs = options.delaysMs ?? TRAFFIC_SETTLEMENT_DELAYS_MS;
  const minimumWaitMs = options.minimumWaitMs ?? TRAFFIC_SETTLEMENT_MINIMUM_WAIT_MS;
  const wait = options.sleep ?? sleep;
  let elapsedMs = 0;
  let previous: TrafficCounters | undefined;

  for (const delayMs of delaysMs) {
    if (delayMs > 0) await wait(delayMs);
    elapsedMs += delayMs;
    const current = await readCounters();
    if (elapsedMs >= minimumWaitMs && previous?.[0] === current[0] && previous[1] === current[1]) return current;
    previous = current;
  }

  return previous ?? readCounters();
}

export async function waitForPartyVisibility(
  party: string,
  readPartyDetails: () =>
    | { partyDetails: Array<{ party: string }> }
    | Promise<{ partyDetails: Array<{ party: string }> }>,
  options: PollOptions = {}
): Promise<void> {
  const delaysMs = options.delaysMs ?? PARTY_VISIBILITY_RETRY_DELAYS_MS;
  const wait = options.sleep ?? sleep;

  for (const delayMs of delaysMs) {
    if (delayMs > 0) await wait(delayMs);
    try {
      const { partyDetails } = await readPartyDetails();
      if (partyDetails.some((details) => details.party === party)) return;
    } catch {
      // The remote participant can return not-found while topology propagates.
    }
  }

  throw new Error(`Party ${party} did not become visible to the operator participant`);
}

class ReplayTrafficMeter {
  private systemOperatorExtraTrafficBeforeBytes: number | undefined;
  private issuerExtraTrafficBeforeBytes: number | undefined;
  private pricingAtStart: NetworkTrafficPricing | undefined;
  private finalReport: ReplayTrafficReport | undefined;
  private readonly participantMemberIds = new Map<string, string>();

  constructor(
    private readonly validator: ValidatorApiClient,
    private readonly scan: ScanApiClient,
    private readonly synchronizerId: string,
    private readonly systemOperatorParty: string,
    private readonly issuerParticipantParty: string
  ) {}

  private async readParticipantTraffic(partyId: string, label: string): Promise<number | undefined> {
    try {
      let memberId = this.participantMemberIds.get(partyId);
      if (!memberId) {
        const lookup = await this.scan.getPartyToParticipant({
          domainId: this.synchronizerId,
          partyId,
        });
        memberId = lookup.participant_id;
        this.participantMemberIds.set(partyId, memberId);
      }
      return getParticipantExtraTrafficConsumedBytes(
        await this.scan.getMemberTrafficStatus({
          domainId: this.synchronizerId,
          memberId,
        })
      );
    } catch {
      console.warn(`Canton ${label} participant extra-traffic status is unavailable.`);
      return undefined;
    }
  }

  private async readPricing(initialAmuletRules?: unknown): Promise<NetworkTrafficPricing | undefined> {
    try {
      const observedAt = new Date();
      const [amuletRules, miningRounds] = await Promise.all([
        initialAmuletRules === undefined ? this.validator.getAmuletRules() : Promise.resolve(initialAmuletRules),
        this.scan.getOpenAndIssuingMiningRounds({
          body: {
            cached_open_mining_round_contract_ids: [],
            cached_issuing_round_contract_ids: [],
          },
        }),
      ]);
      return buildNetworkTrafficPricing(amuletRules, miningRounds, observedAt);
    } catch {
      console.warn('Canton network pricing is unavailable; traffic bytes will still be reported.');
      return undefined;
    }
  }

  async start(initialAmuletRules: unknown): Promise<void> {
    [this.systemOperatorExtraTrafficBeforeBytes, this.issuerExtraTrafficBeforeBytes, this.pricingAtStart] =
      await Promise.all([
        this.readParticipantTraffic(this.systemOperatorParty, 'system-operator'),
        this.readParticipantTraffic(this.issuerParticipantParty, 'issuer'),
        this.readPricing(initialAmuletRules),
      ]);
  }

  async finish(): Promise<ReplayTrafficReport> {
    if (this.finalReport) return this.finalReport;
    const [[systemOperatorExtraTrafficAfterBytes, issuerExtraTrafficAfterBytes], pricingAtEnd] = await Promise.all([
      waitForStableTrafficCounters(async () => {
        const counters = await Promise.all([
          this.readParticipantTraffic(this.systemOperatorParty, 'system-operator'),
          this.readParticipantTraffic(this.issuerParticipantParty, 'issuer'),
        ]);
        return counters;
      }),
      this.readPricing(),
    ]);
    this.finalReport = buildReplayTrafficReport({
      ...(this.systemOperatorExtraTrafficBeforeBytes !== undefined
        ? { systemOperatorExtraTrafficBeforeBytes: this.systemOperatorExtraTrafficBeforeBytes }
        : {}),
      ...(systemOperatorExtraTrafficAfterBytes !== undefined ? { systemOperatorExtraTrafficAfterBytes } : {}),
      ...(this.issuerExtraTrafficBeforeBytes !== undefined
        ? { issuerExtraTrafficBeforeBytes: this.issuerExtraTrafficBeforeBytes }
        : {}),
      ...(issuerExtraTrafficAfterBytes !== undefined ? { issuerExtraTrafficAfterBytes } : {}),
      ...(this.pricingAtStart ? { pricingAtStart: this.pricingAtStart } : {}),
      ...(pricingAtEnd ? { pricingAtEnd } : {}),
    });
    return this.finalReport;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function buildPoolConfig(connectionString: string, sslCa?: string): PoolConfig {
  let normalized = connectionString;
  try {
    const parsed = new URL(connectionString);
    const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase();
    const sslValue = parsed.searchParams.get('ssl')?.toLowerCase();
    if (sslMode === 'disable' || sslValue === 'false' || sslValue === '0') {
      throw new ReplayPhaseError('database', 'The database URL must not disable TLS');
    }
    for (const key of POSTGRES_SSL_QUERY_KEYS) parsed.searchParams.delete(key);
    normalized = parsed.toString();
  } catch (error) {
    if (error instanceof ReplayPhaseError) throw error;
    // Let pg return a sanitized configuration error.
  }

  return {
    connectionString: normalized,
    ssl: {
      rejectUnauthorized: true,
      ...(sslCa ? { ca: sslCa.replace(/\\n/g, '\n') } : {}),
    },
    max: 1,
    application_name: 'ocp-localnet-replay-ci',
  };
}

async function loadDatabaseRows(
  connectionString: string,
  portalId?: string,
  sslCa?: string
): Promise<DatabaseOcfRow[]> {
  const pool = new Pool(buildPoolConfig(connectionString, sslCa));
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '15min'");
    const readOnly = await client.query<{ transaction_read_only: string }>('SHOW transaction_read_only');
    if (readOnly.rows[0]?.transaction_read_only !== 'on') {
      throw new ReplayPhaseError('database', 'The database session is not read-only');
    }
    const result = await client.query<{
      portal_id: string;
      type: string;
      subtype: string | null;
      ocf_data: unknown;
    }>(
      `
        SELECT
          portal_id::text,
          type,
          subtype,
          ocf_data
        FROM latest_ocf_objects
        WHERE ($1::uuid IS NULL OR portal_id = $1::uuid)
        ORDER BY portal_id, type, subtype, ocf_data->>'id'
      `,
      [portalId ?? null]
    );
    await client.query('COMMIT');
    transactionOpen = false;
    return result.rows.map((row) => ({
      portalId: row.portal_id,
      type: row.type,
      subtype: row.subtype,
      data: row.ocf_data,
    }));
  } finally {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

async function loadLocalContractArtifacts(): Promise<{ templates: LocalTemplates; darPath: string }> {
  const bindingsPath = path.resolve('lib/index.js');
  const darPath = path.resolve('published-dars/OpenCapTable.dar');
  await access(bindingsPath).catch(() => {
    throw new ReplayPhaseError(
      'infrastructure',
      'Generated local bindings are missing. Run npm run codegen before replaying the database.'
    );
  });
  await access(darPath).catch(() => {
    throw new ReplayPhaseError(
      'infrastructure',
      'The branch-built OpenCapTable DAR is missing. Run npm run codegen before replaying the database.'
    );
  });

  const generated = require(bindingsPath) as {
    OCP_TEMPLATES?: Partial<LocalTemplates>;
  };
  const templates = generated.OCP_TEMPLATES;
  if (
    typeof templates?.ocpFactory !== 'string' ||
    typeof templates.issuerAuthorization !== 'string' ||
    typeof templates.capTable !== 'string'
  ) {
    throw new ReplayPhaseError('infrastructure', 'Generated local bindings do not export all OCP template IDs');
  }

  return {
    templates: {
      ocpFactory: templates.ocpFactory,
      issuerAuthorization: templates.issuerAuthorization,
      capTable: templates.capTable,
    },
    darPath,
  };
}

function findCreatedEvent(response: unknown, expectedTemplateId: string): CreatedEventValue {
  const { transactionTree } = response as { transactionTree?: { eventsById?: Record<string, unknown> } };
  const { eventsById: events = {} } = transactionTree ?? {};
  for (const event of Object.values(events)) {
    if (!event || typeof event !== 'object' || !('CreatedTreeEvent' in event)) continue;
    const created = (event as { CreatedTreeEvent?: { value?: CreatedEventValue } }).CreatedTreeEvent?.value;
    if (created?.templateId && matchesLedgerTemplateId(created.templateId, expectedTemplateId)) return created;
  }
  throw new Error('Expected created contract event was not present in the transaction tree');
}

async function ensureActAsRight(ledger: LedgerJsonApiClient, actAsRights: Set<string>, party: string): Promise<void> {
  if (actAsRights.has(party)) return;
  await ledger.grantUserRights({
    userId: LOCALNET_USER_ID,
    rights: [{ kind: { CanActAs: { value: { party } } } }],
  });
  actAsRights.add(party);
}

async function initializeReplayLedger(
  captureTrafficMeter: (trafficMeter: ReplayTrafficMeter) => void
): Promise<ReplayLedgerContext> {
  const { templates, darPath } = await loadLocalContractArtifacts();
  process.env['DISABLE_FILE_LOGGER'] = 'true';
  process.env['CANTON_DEBUG'] = 'false';
  const operatorCanton = new Canton(buildReplayCantonConfig('app-provider'));
  const issuerCanton = new Canton(buildReplayCantonConfig('app-user'));
  const { ledger: operatorLedger, scan, validator: operatorValidator } = operatorCanton;
  const { ledger: issuerLedger, validator: issuerValidator } = issuerCanton;
  const issuerOcp = new OcpClient({ ledger: issuerLedger, validator: issuerValidator, environment: 'localnet' });
  const [{ partyDetails: operatorParties }, { partyDetails: issuerParties }] = await Promise.all([
    operatorLedger.listParties({}),
    issuerLedger.listParties({}),
  ]);
  const systemOperatorParty = operatorParties.find(
    (party) => party.isLocal && party.party.toLowerCase().includes('app_provider')
  )?.party;
  const issuerParticipantParty = issuerParties.find(
    (party) => party.isLocal && party.party.toLowerCase().includes('app_user')
  )?.party;
  if (!systemOperatorParty) {
    throw new ReplayPhaseError('infrastructure', 'LocalNet has no available system-operator party');
  }
  if (!issuerParticipantParty) {
    throw new ReplayPhaseError('infrastructure', 'LocalNet has no available issuer-participant party');
  }

  operatorLedger.setPartyId(systemOperatorParty);
  operatorValidator.setPartyId(systemOperatorParty);
  issuerLedger.setPartyId(issuerParticipantParty);
  issuerValidator.setPartyId(issuerParticipantParty);
  const [operatorRightsResponse, issuerRightsResponse, amuletRules] = await Promise.all([
    operatorLedger.listUserRights({ userId: LOCALNET_USER_ID }),
    issuerLedger.listUserRights({ userId: LOCALNET_USER_ID }),
    operatorValidator.getAmuletRules(),
  ]);
  const operatorActAsRights = new Set(
    (operatorRightsResponse.rights ?? []).flatMap((right) =>
      'CanActAs' in right.kind ? [right.kind.CanActAs.value.party] : []
    )
  );
  const issuerActAsRights = new Set(
    (issuerRightsResponse.rights ?? []).flatMap((right) =>
      'CanActAs' in right.kind ? [right.kind.CanActAs.value.party] : []
    )
  );
  const synchronizerId = amuletRules.amulet_rules.domain_id;

  const context = {
    issuerOcp,
    operatorLedger,
    issuerLedger,
    systemOperatorParty,
    issuerParticipantParty,
    synchronizerId,
    operatorActAsRights,
    issuerActAsRights,
    factory: { contractId: '', templateId: '' },
    templates,
    trafficMeter: new ReplayTrafficMeter(
      operatorValidator,
      scan,
      synchronizerId,
      systemOperatorParty,
      issuerParticipantParty
    ),
  } satisfies ReplayLedgerContext;
  captureTrafficMeter(context.trafficMeter);
  await Promise.all([
    ensureActAsRight(operatorLedger, operatorActAsRights, systemOperatorParty),
    ensureActAsRight(issuerLedger, issuerActAsRights, issuerParticipantParty),
  ]);

  await context.trafficMeter.start(amuletRules);

  await Promise.all([
    operatorLedger.uploadDarFile({ filePath: darPath }),
    issuerLedger.uploadDarFile({ filePath: darPath }),
  ]);
  const factory = await createFactory(operatorLedger, {
    systemOperator: systemOperatorParty,
    templateId: templates.ocpFactory,
  });
  context.factory = { contractId: factory.contractId, templateId: factory.templateId };
  return context;
}

async function allocateIssuerParty(context: ReplayLedgerContext, portalAlias: string): Promise<string> {
  const hint = `ocp-replay-${portalAlias.slice('portal-'.length)}`;
  try {
    const allocated = await context.issuerLedger.allocateParty({
      partyIdHint: hint,
      identityProviderId: '',
      synchronizerId: context.synchronizerId,
      userId: LOCALNET_USER_ID,
    });
    const { party } = allocated.partyDetails;
    await ensureActAsRight(context.issuerLedger, context.issuerActAsRights, party);
    await waitForPartyVisibility(party, async () => {
      const details = await context.operatorLedger.getPartyDetails({ party });
      return details;
    });
    return party;
  } catch (error) {
    throw new ReplayPhaseError('party', 'Failed to allocate a LocalNet issuer party', { cause: error });
  }
}

async function authorizeIssuer(context: ReplayLedgerContext, issuerParty: string): Promise<ContractDetails> {
  try {
    const response = await context.operatorLedger.submitAndWaitForTransactionTree({
      commands: [
        {
          ExerciseCommand: {
            templateId: context.factory.templateId,
            contractId: context.factory.contractId,
            choice: 'AuthorizeIssuer',
            choiceArgument: { issuer: issuerParty },
          },
        },
      ],
      actAs: [context.systemOperatorParty],
    });
    const created = findCreatedEvent(response, context.templates.issuerAuthorization);
    const contractEvents = await context.operatorLedger.getEventsByContractId({
      contractId: created.contractId,
      readAs: [context.systemOperatorParty],
    });
    const createdEvent = contractEvents.created?.createdEvent;
    if (!createdEvent?.createdEventBlob) {
      throw new Error('IssuerAuthorization created-event blob is unavailable');
    }
    return {
      contractId: created.contractId,
      templateId: created.templateId,
      createdEventBlob: createdEvent.createdEventBlob,
      synchronizerId: response.transactionTree.synchronizerId,
    };
  } catch (error) {
    throw new ReplayPhaseError('authorization', 'Failed to authorize a LocalNet issuer', { cause: error });
  }
}

async function createCapTable(
  context: ReplayLedgerContext,
  issuerParty: string,
  issuerAuthorization: ContractDetails,
  issuer: PreparedOcfObject
): Promise<{ contractId: string; templateId: string }> {
  try {
    const built = context.issuerOcp.OpenCapTable.issuer.buildCreate({
      issuerAuthorizationContractDetails: issuerAuthorization,
      issuerParty,
      issuerData: issuer.data as unknown as OcfIssuer,
    });
    const response = await context.issuerLedger.submitAndWaitForTransactionTree({
      commands: [built.command],
      actAs: [issuerParty],
      disclosedContracts: built.disclosedContracts.filter((contract) => contract.createdEventBlob.length > 0),
    });
    const created = findCreatedEvent(response, context.templates.capTable);
    return { contractId: created.contractId, templateId: created.templateId };
  } catch (error) {
    throw new ReplayPhaseError('issuer', 'Failed to create the issuer and empty CapTable', {
      entityType: issuer.entityType,
      objectAlias: issuer.objectAlias,
      cause: error,
    });
  }
}

async function verifySemanticConvergence(
  context: ReplayLedgerContext,
  contractId: string,
  issuerParty: string,
  sourceObjects: PreparedOcfObject[]
): Promise<void> {
  let lastError: unknown;
  for (const delayMs of CONVERGENCE_RETRY_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);
    try {
      const state = await getCapTableState(context.issuerLedger, issuerParty);
      if (state?.capTableContractId !== contractId) {
        throw new Error('The updated CapTable was not visible as the issuer active state');
      }
      const manifest = await extractCantonOcfManifest(context.issuerLedger, state, {
        readAs: [issuerParty],
        failOnReadErrors: true,
      });
      const cantonOcfData = buildCantonOcfDataMap(manifest);
      const diff = computeReplicationDiff(
        sourceObjects.map((item) => ({ entityType: item.entityType, data: item.data })),
        state,
        { cantonOcfData, reportDifferences: false, securityIds: state.securityIds }
      );
      if (diff.total === 0 && diff.conflicts.length === 0) return;
      lastError = new Error('Semantic source-to-ledger comparison found a non-empty replication diff');
    } catch (error) {
      lastError = error;
    }
  }
  throw new ReplayPhaseError('convergence', 'Replayed CapTable did not semantically match its source snapshot', {
    cause: lastError,
  });
}

async function replayPortal(context: ReplayLedgerContext, portal: PreparedPortal): Promise<number> {
  const issuerParty = await allocateIssuerParty(context, portal.portalAlias);
  const authorization = await authorizeIssuer(context, issuerParty);
  const capTable = await createCapTable(context, issuerParty, authorization, portal.issuer);
  if (portal.creates.length === 0) {
    await verifySemanticConvergence(context, capTable.contractId, issuerParty, [portal.issuer]);
    return 0;
  }

  const batch = context.issuerOcp.OpenCapTable.capTable.update({
    capTableContractId: capTable.contractId,
    capTableContractDetails: { templateId: capTable.templateId },
    actAs: [issuerParty],
    readAs: [],
  });

  for (const item of portal.creates) {
    try {
      batch.createOperation(toOcfCreateOperation(item));
    } catch (error) {
      throw new ReplayPhaseError('conversion', 'OCF-to-DAML conversion failed', {
        entityType: item.entityType,
        objectAlias: item.objectAlias,
        cause: error,
      });
    }
  }

  let result: Awaited<ReturnType<typeof batch.execute>>;
  try {
    result = await batch.execute();
  } catch (error) {
    throw new ReplayPhaseError('batch', 'Atomic full-cap-table batch failed', { cause: error });
  }
  if (!Array.isArray(result.createdCids) || result.createdCids.length !== portal.creates.length) {
    throw new ReplayPhaseError(
      'convergence',
      `Batch returned ${Array.isArray(result.createdCids) ? result.createdCids.length : 0} created contracts; expected ${portal.creates.length}`
    );
  }

  await verifySemanticConvergence(context, result.updatedCapTableCid, issuerParty, [portal.issuer, ...portal.creates]);
  return portal.creates.length;
}

async function writeReport(options: ReplayOptions, report: ReplayReport): Promise<void> {
  await mkdir(options.reportDir, { recursive: true });
  const markdown = renderReplayMarkdown(report);
  await Promise.all([
    writeFile(
      path.join(options.reportDir, 'summary.json'),
      `${JSON.stringify(toPublicReplayReport(report), null, 2)}\n`,
      'utf8'
    ),
    writeFile(path.join(options.reportDir, 'summary.md'), markdown, 'utf8'),
  ]);
  const stepSummaryPath = process.env['GITHUB_STEP_SUMMARY'];
  if (stepSummaryPath) await appendFile(stepSummaryPath, markdown, 'utf8');
}

function buildReport(params: {
  options: ReplayOptions;
  startedAt: Date;
  sourceObjectCount: number;
  portalCount: number;
  results: PortalReplayResult[];
  traffic?: ReplayTrafficReport;
  fatalFailure?: ReplayFailure;
}): ReplayReport {
  const finishedAt = new Date();
  const passedPortalCount = params.results.filter((result) => result.success).length;
  const failedPortalCount = params.results.filter((result) => !result.success).length;
  const status = params.fatalFailure || failedPortalCount > 0 ? 'failed' : 'passed';
  return {
    database: params.options.database,
    gitRef: process.env['GITHUB_REF_NAME'] ?? null,
    gitSha: process.env['GITHUB_SHA'] ?? null,
    startedAt: params.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - params.startedAt.getTime(),
    sourceObjectCount: params.sourceObjectCount,
    portalCount: params.portalCount,
    passedPortalCount,
    failedPortalCount,
    createdObjectCount: params.results.reduce((sum, result) => sum + result.createdObjectCount, 0),
    status,
    results: params.results,
    ...(params.traffic ? { traffic: params.traffic } : {}),
    ...(params.fatalFailure ? { fatalFailure: params.fatalFailure } : {}),
  };
}

async function run(options: ReplayOptions): Promise<ReplayReport> {
  const startedAt = new Date();
  const results: PortalReplayResult[] = [];
  let sourceObjectCount = 0;
  let portalCount = 0;
  let trafficMeter: ReplayTrafficMeter | undefined;

  try {
    const database = resolveDatabaseUrl(options.database);
    const sslCa = process.env['POSTGRES_SSL_CA'];
    const rows = await loadDatabaseRows(database.url, options.portalId, sslCa);
    sourceObjectCount = rows.length;
    if (rows.length === 0) {
      throw new ReplayPhaseError('database', 'The read-only snapshot returned zero committed OCF objects');
    }

    const groupedRows = groupRowsByPortal(rows);
    portalCount = groupedRows.size;
    const context = await initializeReplayLedger((meter) => {
      trafficMeter = meter;
    });

    console.log('Replaying the committed OCF snapshot on isolated LocalNet...');
    for (const portalRows of groupedRows.values()) {
      const portalStartedAt = Date.now();
      const portalAlias = hashIdentifier(portalRows[0].portalId, 'portal');
      try {
        const portal = preparePortal(portalRows);
        const createdObjectCount = await replayPortal(context, portal);
        results.push({
          portalAlias,
          sourceObjectCount: portalRows.length,
          createdObjectCount,
          durationMs: Date.now() - portalStartedAt,
          success: true,
        });
      } catch (error) {
        const failure = toReplayFailure(portalAlias, error);
        results.push({
          portalAlias,
          sourceObjectCount: portalRows.length,
          createdObjectCount: 0,
          durationMs: Date.now() - portalStartedAt,
          success: false,
          failure,
        });
        console.error(
          `::error title=OCP LocalNet replay (${failure.phase})::${escapeWorkflowCommand(failure.message)}`
        );
      }
    }

    const traffic = await trafficMeter.finish();
    return buildReport({ options, startedAt, sourceObjectCount, portalCount, results, traffic });
  } catch (error) {
    const fatalFailure = toReplayFailure('all-portals', error);
    console.error(`::error title=OCP LocalNet replay setup::${escapeWorkflowCommand(fatalFailure.message)}`);
    const traffic = trafficMeter ? await trafficMeter.finish() : undefined;
    return buildReport({
      options,
      startedAt,
      sourceObjectCount,
      portalCount,
      results,
      ...(traffic ? { traffic } : {}),
      fatalFailure,
    });
  }
}

async function main(): Promise<void> {
  let options: ReplayOptions;
  try {
    options = parseReplayOptions(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ReplayHelpRequested) {
      console.log(replayUsage());
      return;
    }
    console.error('Invalid replay arguments.');
    console.error(replayUsage());
    process.exitCode = 1;
    return;
  }

  const report = await run(options);
  try {
    await writeReport(options, report);
  } catch {
    console.error('Failed to write the payload-free replay report.');
    process.exitCode = 1;
    return;
  }

  console.log(`Replay ${report.status}. Customer and object details are intentionally omitted.`);
  if (report.status === 'failed') process.exitCode = 1;
}

if (require.main === module) {
  main().catch(() => {
    console.error('Unexpected replay infrastructure failure.');
    process.exitCode = 1;
  });
}
