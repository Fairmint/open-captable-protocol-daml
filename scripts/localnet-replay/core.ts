import { createHmac, randomBytes } from 'crypto';
import path from 'path';

import {
  isOcfCreatableEntityType,
  mapOcfObjectTypeToEntityType,
  type OcfCreateOperation,
  type OcfEntityType,
} from '@open-captable-protocol/canton';
import {
  ENTITY_OBJECT_TYPE_MAP,
  getOcfSchema,
  mapCategorizedTypeToEntityType,
  matchesTemplateIdentity,
  normalizeEntityType,
  normalizeObjectType,
  parseOcfEntityInput,
  parseOcfObject,
  sortTransactions,
} from '@open-captable-protocol/canton/replication';

import { renderReplayTrafficMarkdown, type ReplayTrafficReport } from './traffic';

export type DatabaseSource = 'dev' | 'production';

export interface ReplayOptions {
  database: DatabaseSource;
  portalId?: string;
  reportDir: string;
}

export interface DatabaseOcfRow {
  portalId: string;
  type: string;
  subtype: string | null;
  data: unknown;
}

export interface PreparedOcfObject {
  entityType: OcfEntityType;
  objectAlias: string;
  objectId: string;
  data: Record<string, unknown>;
}

export interface PreparedPortal {
  portalAlias: string;
  issuer: PreparedOcfObject;
  creates: PreparedOcfObject[];
  sourceObjectCount: number;
}

export type ReplayFailurePhase =
  | 'database'
  | 'schema'
  | 'mapping'
  | 'ordering'
  | 'party'
  | 'authorization'
  | 'issuer'
  | 'conversion'
  | 'batch'
  | 'convergence'
  | 'infrastructure';

export interface ReplayFailure {
  portalAlias: string;
  phase: ReplayFailurePhase;
  message: string;
}

/**
 * Failure detail used exclusively by CI-side diagnostics (workflow commands and artifacts).
 *
 * Excerpt strings may embed customer identifiers (object IDs and payload values), so they must never be copied into the
 * public reports or step summaries. The portal and object aliases are per-run HMACs, and `validator` is an ID-free
 * assert label, so those are safe for run-scoped published surfaces.
 */
export interface InternalReplayFailure {
  portalAlias: string;
  phase: ReplayFailurePhase;
  message: string;
  entityType?: string;
  objectAlias?: string;
  validator?: string;
  excerpt?: string;
  causeExcerpt?: string;
}

const CAUSE_EXCERPT_MAX_LENGTH = 400;

export function causeExcerpt(error: unknown, maxLength = CAUSE_EXCERPT_MAX_LENGTH): string {
  if (error === undefined || error === null) return '';
  let text: string;
  if (error instanceof Error) {
    text = error.message;
  } else if (typeof error === 'string') {
    text = error;
  } else if (error instanceof String) {
    text = error.valueOf();
  } else {
    return '';
  }
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

// DAML assert-message prefixes from CapTable.daml.template mapped to the owning validator
// function. Longest/most-specific prefixes must be matched first; keep in sync with the
// template. Unmatched messages fall back to the phase plus the raw excerpt.
const VALIDATOR_CONTEXTS: ReadonlyArray<readonly [prefix: string, validator: string]> = [
  ['Stock class conversion right for', 'validateStockClassConversionRightReferences'],
  ['Convertible conversion triggers for', 'validateConvertibleConversionRightReferences'],
  ['Convertible conversion target', 'validateConvertibleConversionRightReferences'],
  ['Convertible conversion capitalization definition for', 'validateConvertibleConversionCapitalizationReferences'],
  ['Convertible conversion trigger not found', 'validateConvertibleConversionTriggerReferences'],
  ['Convertible conversion security not found', 'validateConvertibleConversionTriggerReferences'],
  ['Convertible issuance stakeholder', 'validateConvertibleIssuanceReferences'],
  ['Warrant exercise trigger for', 'validateWarrantConversionRightReferences'],
  ['Warrant exercise triggers for', 'validateWarrantConversionRightReferences'],
  ['Warrant exercise trigger not found', 'validateWarrantExerciseTriggerReferences'],
  ['Warrant exercise security not found', 'validateWarrantExerciseTriggerReferences'],
  ['Warrant issuance stakeholder', 'validateWarrantIssuanceReferences'],
  ['Warrant vesting terms', 'validateWarrantIssuanceReferences'],
  ['Warrant conversion target', 'validateWarrantConversionRightReferences'],
  ['Valuation stock class', 'validateValuationStockClassReferences'],
  ['Stock plan stock class for', 'validateStockPlanReferences'],
  ['Stock issuance stakeholder', 'validateStockIssuanceReferences'],
  ['Stock issuance stock class', 'validateStockIssuanceReferences'],
  ['Stock issuance stock legend', 'validateStockIssuanceReferences'],
  ['Stock issuance stock plan', 'validateStockIssuanceReferences'],
  ['Stock issuance vesting terms', 'validateStockIssuanceReferences'],
  ['Equity compensation stakeholder', 'validateEquityCompensationIssuanceReferences'],
  ['Equity compensation stock class', 'validateEquityCompensationIssuanceReferences'],
  ['Equity compensation stock plan', 'validateEquityCompensationIssuanceReferences'],
  ['Equity compensation vesting terms', 'validateEquityCompensationIssuanceReferences'],
  ['Equity compensation exercise security not found', 'validateEquityCompensationExerciseTemporalEligibility'],
  ['Stock reissuance split transaction', 'validateStockReissuanceSplitReferences'],
  ['Vesting transaction security id is ambiguous', 'vestingTermsIdForSecurity'],
  ['Vesting transaction security not found', 'vestingTermsIdForSecurity'],
  ['Vesting transaction security has no VestingTerms', 'vestingTermsIdForSecurity'],
  ['Vesting transaction references missing VestingTerms', 'vestingTermsDataForSecurity'],
  ['references missing VestingCondition', 'validateVestingTransactionCondition'],
  ['references missing VestingCondition:', 'vestingConditionReferenceExists'],
  ['lifecycle event references missing issuance security_id', 'validateSourceSecurityBalances'],
  ['targets inactive stock security', 'validateActiveSecurityTargets'],
  ['targets inactive convertible security', 'validateActiveSecurityTargets'],
  ['targets inactive warrant security', 'validateActiveSecurityTargets'],
  ['targets inactive equity compensation security', 'validateActiveSecurityTargets'],
  ['has duplicate conversion trigger IDs', 'validateConvertibleIssuanceTemporalTerms'],
  ['has duplicate exercise trigger IDs', 'validateWarrantIssuanceTemporalTerms'],
];

/** Best-effort mapping of a DAML assert excerpt to its owning validator function name. */
export function validatorFromExcerpt(excerpts: readonly string[]): string | undefined {
  for (const excerpt of excerpts) {
    for (const [prefix, validator] of VALIDATOR_CONTEXTS) {
      if (excerpt.includes(prefix)) return validator;
    }
  }
  return undefined;
}

export interface PortalReplayResult {
  portalAlias: string;
  sourceObjectCount: number;
  createdObjectCount: number;
  durationMs: number;
  success: boolean;
  failure?: ReplayFailure;
}

export interface ReplayReport {
  database: DatabaseSource;
  gitRef: string | null;
  gitSha: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  sourceObjectCount: number;
  portalCount: number;
  passedPortalCount: number;
  failedPortalCount: number;
  createdObjectCount: number;
  status: 'passed' | 'failed';
  results: PortalReplayResult[];
  traffic?: ReplayTrafficReport;
  fatalFailure?: ReplayFailure;
}

export interface PublicReplayReport {
  database: DatabaseSource;
  gitRef: string | null;
  gitSha: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'passed' | 'failed';
  failurePhases: ReplayFailurePhase[];
  traffic?: ReplayTrafficReport;
}

export class ReplayPhaseError extends Error {
  readonly phase: ReplayFailurePhase;
  readonly entityType?: string;
  readonly objectAlias?: string;

  constructor(
    phase: ReplayFailurePhase,
    message: string,
    context: { entityType?: string; objectAlias?: string; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'ReplayPhaseError';
    this.phase = phase;
    this.entityType = context.entityType;
    this.objectAlias = context.objectAlias;
    if (context.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = context.cause;
    }
  }
}

/** Collect deduplicated excerpt messages from an error's `cause` chain (excluding the error itself). */
function collectCauseExcerpts(error: unknown): string[] {
  const excerpts: string[] = [];
  const seen = new Set<unknown>();
  const readCause = (value: unknown): unknown =>
    value instanceof Error ? (value as Error & { cause?: unknown }).cause : undefined;
  let current = readCause(error);
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    const excerpt = causeExcerpt(current);
    if (excerpt.length > 0) excerpts.push(excerpt);
    current = readCause(current);
  }
  return Array.from(new Set(excerpts));
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_ALIAS_KEY = randomBytes(32);

export function replayUsage(): string {
  return `
Usage: npm run replay-ocf:localnet -- [options]

Rebuild every committed OCF cap table from a read-only database snapshot on LocalNet.

Options:
  --database <dev|production>  Source database label (default: dev)
  --portal-id <uuid>           Restrict a local diagnostic run to one portal
  --report-dir <path>          Sanitized report output directory
  --help                       Show this help

Database URL lookup order:
  POSTGRES_DB_URL, then POSTGRES_DB_URL_DEVNET/POSTGRES_DB_URL_APP_DEV for dev,
  or POSTGRES_DB_URL_MAINNET/POSTGRES_DB_URL_APP_PROD for production.
`;
}

export function parseReplayOptions(args: string[]): ReplayOptions {
  const options: ReplayOptions = {
    database: 'dev',
    reportDir: path.resolve('artifacts/ocf-localnet-replay'),
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];

    switch (argument) {
      case '--database':
        if (value !== 'dev' && value !== 'production') {
          throw new Error('--database must be either dev or production');
        }
        options.database = value;
        index += 1;
        break;
      case '--portal-id':
        if (!value || !UUID_REGEX.test(value)) {
          throw new Error('--portal-id must be a UUID');
        }
        options.portalId = value;
        index += 1;
        break;
      case '--report-dir':
        if (!value || value.startsWith('--')) {
          throw new Error('--report-dir requires a path');
        }
        options.reportDir = path.resolve(value);
        index += 1;
        break;
      case '--help':
        throw new ReplayHelpRequested();
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

export class ReplayHelpRequested extends Error {
  constructor() {
    super('Help requested');
    this.name = 'ReplayHelpRequested';
  }
}

export function resolveDatabaseUrl(
  database: DatabaseSource,
  env: NodeJS.ProcessEnv = process.env
): { url: string; envName: string } {
  const candidates =
    database === 'dev'
      ? (['POSTGRES_DB_URL', 'POSTGRES_DB_URL_DEVNET', 'POSTGRES_DB_URL_APP_DEV'] as const)
      : (['POSTGRES_DB_URL', 'POSTGRES_DB_URL_MAINNET', 'POSTGRES_DB_URL_APP_PROD'] as const);

  for (const envName of candidates) {
    const value = env[envName]?.trim();
    if (value) {
      return { url: value, envName };
    }
  }

  throw new ReplayPhaseError(
    'database',
    `No read-only ${database} database URL is configured. Expected one of: ${candidates.join(', ')}`
  );
}

export function hashIdentifier(value: string, prefix: 'portal' | 'object' | 'party' = 'object'): string {
  // A per-process HMAC keeps aliases useful within one run without publishing stable customer fingerprints.
  const digest = createHmac('sha256', RUN_ALIAS_KEY)
    .update(`ocp-localnet-replay\0${prefix}\0${value}`)
    .digest('hex')
    .slice(0, 12);
  return `${prefix}-${digest}`;
}

export function matchesLedgerTemplateId(actualTemplateId: string, expectedTemplateId: string): boolean {
  return matchesTemplateIdentity({ templateId: actualTemplateId }, expectedTemplateId);
}

export function groupRowsByPortal(rows: DatabaseOcfRow[]): Map<string, DatabaseOcfRow[]> {
  const grouped = new Map<string, DatabaseOcfRow[]>();
  for (const row of rows) {
    const current = grouped.get(row.portalId);
    if (current) {
      current.push(row);
    } else {
      grouped.set(row.portalId, [row]);
    }
  }
  return grouped;
}

function requireRecord(value: unknown, portalAlias: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReplayPhaseError('schema', `OCF payload is not an object in ${portalAlias}`);
  }
  return value as Record<string, unknown>;
}

function schemaIssueSummary(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  const limit = 8;
  const lines = issues.slice(0, limit).map((issue) => {
    const issuePath = issue.path.length > 0 ? issue.path.map(String).join('.') : '/';
    return `${issuePath}: ${issue.message}`;
  });
  if (issues.length > limit) {
    lines.push(`and ${issues.length - limit} additional schema issue(s)`);
  }
  return lines.join('; ');
}

function prepareRow(row: DatabaseOcfRow, portalAlias: string): PreparedOcfObject {
  const data = requireRecord(row.data, portalAlias);
  const objectId = data['id'];
  const objectType = data['object_type'];

  if (typeof objectId !== 'string' || objectId.length === 0) {
    throw new ReplayPhaseError('schema', `OCF payload is missing a non-empty id in ${portalAlias}`);
  }
  const objectAlias = hashIdentifier(objectId, 'object');
  if (typeof objectType !== 'string' || objectType.length === 0) {
    throw new ReplayPhaseError('schema', 'OCF payload is missing object_type', { objectAlias });
  }

  // Deliberately validate the original database JSON before the SDK normalizes legacy aliases.
  let rawSchemaResult: ReturnType<ReturnType<typeof getOcfSchema>['safeParse']>;
  try {
    rawSchemaResult = getOcfSchema(objectType).safeParse(data);
  } catch (error) {
    throw new ReplayPhaseError('schema', 'No strict OCF schema is available for object_type', {
      objectAlias,
      cause: error,
    });
  }
  if (!rawSchemaResult.success) {
    throw new ReplayPhaseError(
      'schema',
      `Raw OCF schema validation failed: ${schemaIssueSummary(rawSchemaResult.error.issues)}`,
      { objectAlias }
    );
  }

  const normalizedSubtype = row.subtype === null ? null : normalizeObjectType(row.subtype);
  const normalizedObjectType = normalizeObjectType(objectType);
  const categorizedEntityType = mapCategorizedTypeToEntityType(row.type, normalizedSubtype);
  const objectEntityType = mapOcfObjectTypeToEntityType(normalizedObjectType);
  if (!categorizedEntityType || !objectEntityType) {
    throw new ReplayPhaseError(
      'mapping',
      `Unsupported OCF mapping for category=${row.type}, subtype=${row.subtype ?? 'null'}, object_type=${objectType}`,
      { objectAlias }
    );
  }

  const normalizedCategorizedType = normalizeEntityType(categorizedEntityType);
  const normalizedObjectEntityType = normalizeEntityType(objectEntityType);
  if (normalizedCategorizedType !== normalizedObjectEntityType) {
    throw new ReplayPhaseError(
      'mapping',
      `Database category maps to ${categorizedEntityType}, but object_type maps to ${objectEntityType}`,
      { entityType: categorizedEntityType, objectAlias }
    );
  }

  const expectedObjectType = ENTITY_OBJECT_TYPE_MAP[categorizedEntityType];
  if (
    normalizeEntityType(categorizedEntityType) === categorizedEntityType &&
    expectedObjectType !== normalizedObjectType
  ) {
    throw new ReplayPhaseError(
      'mapping',
      `Entity ${categorizedEntityType} expects object_type=${expectedObjectType}, received ${objectType}`,
      { entityType: categorizedEntityType, objectAlias }
    );
  }

  return {
    entityType: categorizedEntityType,
    objectAlias,
    objectId,
    data,
  };
}

function isTransaction(item: PreparedOcfObject): boolean {
  const objectType = item.data['object_type'];
  return typeof objectType === 'string' && (objectType.startsWith('TX_') || objectType.startsWith('CE_'));
}

export function toOcfCreateOperation(item: PreparedOcfObject): OcfCreateOperation {
  if (!isOcfCreatableEntityType(item.entityType)) {
    throw new ReplayPhaseError('mapping', `Entity ${item.entityType} cannot be created through a CapTable batch`, {
      entityType: item.entityType,
      objectAlias: item.objectAlias,
    });
  }

  // Preserve raw OCF compatibility at ingestion, then cross the typed SDK boundary with canonical data.
  const data = parseOcfEntityInput(item.entityType, parseOcfObject(item.data));
  return { type: item.entityType, data } as OcfCreateOperation;
}

function orderCreates(items: PreparedOcfObject[]): PreparedOcfObject[] {
  const transactions = items.filter(isTransaction);
  if (transactions.length === 0) return items;

  const byData = new Map<Record<string, unknown>, PreparedOcfObject>(transactions.map((item) => [item.data, item]));

  let sortedTransactions: Array<Record<string, unknown>>;
  try {
    sortedTransactions = sortTransactions(transactions.map((item) => item.data));
  } catch (error) {
    throw new ReplayPhaseError('ordering', 'Transaction ordering failed', { cause: error });
  }

  const sortedItems = sortedTransactions.map((data) => {
    const item = byData.get(data);
    if (!item) {
      throw new ReplayPhaseError('ordering', 'Transaction ordering returned an unknown object');
    }
    return item;
  });

  // DAML applies its own stable tier sort. Supplying transactions in domain order here preserves chronology within
  // each tier while allowing prerequisite object tiers to move ahead of dependent transaction tiers.
  return [...items.filter((item) => !isTransaction(item)), ...sortedItems];
}

export function preparePortal(rows: DatabaseOcfRow[]): PreparedPortal {
  if (rows.length === 0) {
    throw new ReplayPhaseError('database', 'Portal group has no OCF rows');
  }

  const portalAlias = hashIdentifier(rows[0].portalId, 'portal');
  const prepared = rows.map((row) => prepareRow(row, portalAlias));
  const issuers = prepared.filter((item) => item.entityType === 'issuer');
  if (issuers.length !== 1) {
    throw new ReplayPhaseError('schema', `Expected exactly one ISSUER object; found ${issuers.length}`);
  }

  return {
    portalAlias,
    issuer: issuers[0],
    creates: orderCreates(prepared.filter((item) => item.entityType !== 'issuer')),
    sourceObjectCount: rows.length,
  };
}

const PUBLIC_FAILURE_MESSAGES: Record<ReplayFailurePhase, string> = {
  database: 'The read-only database snapshot could not be loaded safely.',
  schema: 'At least one source object failed strict OCF schema validation.',
  mapping: 'At least one source object has an unsupported or inconsistent OCF mapping.',
  ordering: 'The source transaction history could not be ordered.',
  party: 'A LocalNet issuer party could not be prepared.',
  authorization: 'A LocalNet issuer could not be authorized.',
  issuer: 'An issuer and empty cap table could not be created on LocalNet.',
  conversion: 'At least one OCF object could not be converted to a DAML command.',
  batch: 'An atomic full-cap-table replay failed on LocalNet.',
  convergence: 'A replayed cap table did not converge to the source snapshot.',
  infrastructure: 'The isolated LocalNet replay infrastructure failed.',
};

export function toReplayFailure(
  portalAlias: string,
  error: unknown,
  fallbackPhase: ReplayFailurePhase = 'infrastructure'
): ReplayFailure {
  const replayError = error instanceof ReplayPhaseError ? error : undefined;
  const phase = replayError?.phase ?? fallbackPhase;
  return {
    portalAlias,
    phase,
    message: PUBLIC_FAILURE_MESSAGES[phase],
  };
}

/**
 * Builds a failure record with customer identifiers and upstream diagnostics for CI-side diagnostics (workflow
 * `::error` annotations, raw logs, artifacts). It must never be persisted into public reports, step summaries, or other
 * payload-free surfaces.
 */
export function toInternalReplayFailure(
  portalAlias: string,
  error: unknown,
  fallbackPhase: ReplayFailurePhase = 'infrastructure'
): InternalReplayFailure {
  const replayError = error instanceof ReplayPhaseError ? error : undefined;
  const phase = replayError?.phase ?? fallbackPhase;
  const excerpts = collectCauseExcerpts(error);
  const validator = validatorFromExcerpt(excerpts);
  return {
    portalAlias,
    phase,
    message: PUBLIC_FAILURE_MESSAGES[phase],
    ...(replayError?.entityType ? { entityType: replayError.entityType } : {}),
    ...(replayError?.objectAlias ? { objectAlias: replayError.objectAlias } : {}),
    ...(validator ? { validator } : {}),
    ...(excerpts.length > 0 ? { excerpt: excerpts[0] } : {}),
    ...(excerpts.length > 1 ? { causeExcerpt: excerpts.slice(1).join(' | ') } : {}),
  };
}

export function escapeWorkflowCommand(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function renderReplayMarkdown(report: ReplayReport): string {
  const lines = [
    '# OCF database replay on LocalNet',
    '',
    `- Status: **${report.status.toUpperCase()}**`,
    `- Source: **${report.database}** database (read-only snapshot)`,
    `- Ref: \`${report.gitRef ?? 'local'}\``,
    `- Duration: ${(report.durationMs / 1000).toFixed(1)}s`,
    '',
  ];

  if (report.traffic) lines.push(...renderReplayTrafficMarkdown(report.traffic));

  const failures = [
    ...(report.fatalFailure ? [report.fatalFailure] : []),
    ...report.results.flatMap((result) => (result.failure ? [result.failure] : [])),
  ];
  if (failures.length === 0) {
    lines.push(
      'Every source object passed raw OCF schema validation and the resulting cap table converged on LocalNet.'
    );
    return `${lines.join('\n')}\n`;
  }

  lines.push('Failure phases:');
  for (const phase of Array.from(new Set(failures.map((failure) => failure.phase))).sort()) {
    lines.push(`- ${phase}`);
  }
  lines.push(
    '',
    'Customer identifiers, object counts, payload values, and upstream diagnostics are intentionally omitted.'
  );
  return `${lines.join('\n')}\n`;
}

export function toPublicReplayReport(report: ReplayReport): PublicReplayReport {
  const failures = [
    ...(report.fatalFailure ? [report.fatalFailure] : []),
    ...report.results.flatMap((result) => (result.failure ? [result.failure] : [])),
  ];
  return {
    database: report.database,
    gitRef: report.gitRef,
    gitSha: report.gitSha,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    durationMs: report.durationMs,
    status: report.status,
    failurePhases: Array.from(new Set(failures.map((failure) => failure.phase))).sort(),
    ...(report.traffic ? { traffic: report.traffic } : {}),
  };
}
