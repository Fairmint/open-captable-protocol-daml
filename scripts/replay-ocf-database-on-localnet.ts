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
  getPaidTrafficCostBytes,
  getParticipantTrafficConsumedBytes,
  type NetworkTrafficPricing,
  type ReplayTrafficReport,
} from './localnet-replay/traffic';

const LOCALNET_USER_ID = 'ledger-api-user';
const POSTGRES_SSL_QUERY_KEYS = ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert'] as const;
const CONVERGENCE_RETRY_DELAYS_MS = [0, 1_000, 2_000, 5_000, 10_000] as const;

export function buildReplayCantonConfig(): ConstructorParameters<typeof Canton>[0] {
  return toCantonConfig({ environment: 'localnet' });
}

interface LocalTemplates {
  ocpFactory: string;
  issuerAuthorization: string;
  capTable: string;
}

interface ReplayLedgerContext {
  ocp: OcpClient;
  ledger: LedgerJsonApiClient;
  systemOperatorParty: string;
  synchronizerId: string;
  actAsRights: Set<string>;
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

class ReplayTrafficMeter {
  private participantTrafficBeforeBytes: number | undefined;
  private committedTransactionCount = 0;
  private measuredTransactionCount = 0;
  private confirmationRequestTrafficBytes = 0;
  private pricingAtStart: NetworkTrafficPricing | undefined;
  private finalReport: ReplayTrafficReport | undefined;
  private participantMemberId: string | undefined;

  constructor(
    private readonly ledger: LedgerJsonApiClient,
    private readonly validator: ValidatorApiClient,
    private readonly scan: ScanApiClient,
    private readonly synchronizerId: string,
    private readonly systemOperatorParty: string
  ) {}

  private async readParticipantTraffic(): Promise<number | undefined> {
    try {
      if (!this.participantMemberId) {
        const lookup = await this.scan.getPartyToParticipant({
          domainId: this.synchronizerId,
          partyId: this.systemOperatorParty,
        });
        this.participantMemberId = lookup.participant_id;
      }
      return getParticipantTrafficConsumedBytes(
        await this.scan.getMemberTrafficStatus({
          domainId: this.synchronizerId,
          memberId: this.participantMemberId,
        })
      );
    } catch {
      console.warn('Canton participant traffic status is unavailable; transaction traffic will still be measured.');
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
    [this.participantTrafficBeforeBytes, this.pricingAtStart] = await Promise.all([
      this.readParticipantTraffic(),
      this.readPricing(initialAmuletRules),
    ]);
  }

  async recordCommittedTransaction(updateId: string, submittingParties: string[]): Promise<void> {
    this.committedTransactionCount += 1;
    try {
      const filtersByParty = Object.fromEntries(
        submittingParties.map((party) => [
          party,
          {
            cumulative: [
              {
                identifierFilter: {
                  WildcardFilter: { value: { includeCreatedEventBlob: false } },
                },
              },
            ],
          },
        ])
      );
      const response = await this.ledger.getTransactionById({
        updateId,
        transactionFormat: {
          eventFormat: { filtersByParty, verbose: false },
          transactionShape: 'TRANSACTION_SHAPE_ACS_DELTA',
        },
      });
      const paidTrafficCost = getPaidTrafficCostBytes(response.transaction);
      if (paidTrafficCost === undefined) {
        console.warn('Canton omitted paidTrafficCost for a committed OCP transaction.');
        return;
      }
      this.measuredTransactionCount += 1;
      this.confirmationRequestTrafficBytes += paidTrafficCost;
    } catch {
      console.warn('Canton transaction traffic lookup failed for a committed OCP transaction.');
    }
  }

  async finish(): Promise<ReplayTrafficReport> {
    if (this.finalReport) return this.finalReport;
    const [participantTrafficAfterBytes, pricingAtEnd] = await Promise.all([
      this.readParticipantTraffic(),
      this.readPricing(),
    ]);
    this.finalReport = buildReplayTrafficReport({
      ...(this.participantTrafficBeforeBytes !== undefined
        ? { participantTrafficBeforeBytes: this.participantTrafficBeforeBytes }
        : {}),
      ...(participantTrafficAfterBytes !== undefined ? { participantTrafficAfterBytes } : {}),
      committedTransactionCount: this.committedTransactionCount,
      measuredTransactionCount: this.measuredTransactionCount,
      confirmationRequestTrafficBytes: this.confirmationRequestTrafficBytes,
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

async function ensureActAsRight(context: ReplayLedgerContext, party: string): Promise<void> {
  if (context.actAsRights.has(party)) return;
  await context.ledger.grantUserRights({
    userId: LOCALNET_USER_ID,
    rights: [{ kind: { CanActAs: { value: { party } } } }],
  });
  context.actAsRights.add(party);
}

async function initializeReplayLedger(
  captureTrafficMeter: (trafficMeter: ReplayTrafficMeter) => void
): Promise<ReplayLedgerContext> {
  const { templates, darPath } = await loadLocalContractArtifacts();
  process.env['DISABLE_FILE_LOGGER'] = 'true';
  process.env['CANTON_DEBUG'] = 'false';
  const canton = new Canton(buildReplayCantonConfig());
  const { ledger, scan, validator } = canton;
  const ocp = new OcpClient({ ledger, validator, environment: 'localnet' });
  const { partyDetails } = await ledger.listParties({});
  const systemOperatorParty =
    partyDetails.find((party) => party.party.toLowerCase().includes('app_provider'))?.party ?? partyDetails[0]?.party;
  if (!systemOperatorParty) {
    throw new ReplayPhaseError('infrastructure', 'LocalNet has no available system-operator party');
  }

  ledger.setPartyId(systemOperatorParty);
  validator.setPartyId(systemOperatorParty);
  const rightsResponse = await ledger.listUserRights({ userId: LOCALNET_USER_ID });
  const actAsRights = new Set(
    (rightsResponse.rights ?? []).flatMap((right) =>
      'CanActAs' in right.kind ? [right.kind.CanActAs.value.party] : []
    )
  );
  const amuletRules = await validator.getAmuletRules();
  const synchronizerId = amuletRules.amulet_rules.domain_id;

  const context = {
    ocp,
    ledger,
    systemOperatorParty,
    synchronizerId,
    actAsRights,
    factory: { contractId: '', templateId: '' },
    templates,
    trafficMeter: new ReplayTrafficMeter(ledger, validator, scan, synchronizerId, systemOperatorParty),
  } satisfies ReplayLedgerContext;
  captureTrafficMeter(context.trafficMeter);
  await ensureActAsRight(context, systemOperatorParty);

  await context.trafficMeter.start(amuletRules);

  await ledger.uploadDarFile({ filePath: darPath });
  const factory = await createFactory(ledger, {
    systemOperator: systemOperatorParty,
    templateId: templates.ocpFactory,
  });
  await context.trafficMeter.recordCommittedTransaction(factory.updateId, [systemOperatorParty]);
  context.factory = { contractId: factory.contractId, templateId: factory.templateId };
  return context;
}

async function allocateIssuerParty(context: ReplayLedgerContext, portalAlias: string): Promise<string> {
  const hint = `ocp-replay-${portalAlias.slice('portal-'.length)}`;
  try {
    const allocated = await context.ledger.allocateParty({
      partyIdHint: hint,
      identityProviderId: '',
      synchronizerId: context.synchronizerId,
      userId: LOCALNET_USER_ID,
    });
    const { party } = allocated.partyDetails;
    await ensureActAsRight(context, party);
    await sleep(500);
    return party;
  } catch (error) {
    throw new ReplayPhaseError('party', 'Failed to allocate a LocalNet issuer party', { cause: error });
  }
}

async function authorizeIssuer(context: ReplayLedgerContext, issuerParty: string): Promise<ContractDetails> {
  try {
    const response = await context.ledger.submitAndWaitForTransactionTree({
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
    await context.trafficMeter.recordCommittedTransaction(response.transactionTree.updateId, [
      context.systemOperatorParty,
    ]);
    const created = findCreatedEvent(response, context.templates.issuerAuthorization);
    const contractEvents = await context.ledger.getEventsByContractId({
      contractId: created.contractId,
      readAs: [context.systemOperatorParty, issuerParty],
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
    const built = context.ocp.OpenCapTable.issuer.buildCreate({
      issuerAuthorizationContractDetails: issuerAuthorization,
      issuerParty,
      issuerData: issuer.data as unknown as OcfIssuer,
    });
    const response = await context.ledger.submitAndWaitForTransactionTree({
      commands: [built.command],
      actAs: [issuerParty],
      readAs: [context.systemOperatorParty],
      disclosedContracts: built.disclosedContracts.filter((contract) => contract.createdEventBlob.length > 0),
    });
    await context.trafficMeter.recordCommittedTransaction(response.transactionTree.updateId, [issuerParty]);
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
      const state = await getCapTableState(context.ledger, issuerParty);
      if (state?.capTableContractId !== contractId) {
        throw new Error('The updated CapTable was not visible as the issuer active state');
      }
      const manifest = await extractCantonOcfManifest(context.ledger, state, {
        readAs: [issuerParty, context.systemOperatorParty],
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

  const batch = context.ocp.OpenCapTable.capTable.update({
    capTableContractId: capTable.contractId,
    capTableContractDetails: { templateId: capTable.templateId },
    actAs: [issuerParty],
    readAs: [context.systemOperatorParty],
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
  await context.trafficMeter.recordCommittedTransaction(result.updateId, [issuerParty]);
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
