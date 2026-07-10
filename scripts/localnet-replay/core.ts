import { createHmac, randomBytes } from 'crypto';
import path from 'path';

import {
  convertToDaml,
  ENTITY_OBJECT_TYPE_MAP,
  getOcfObjectTypeCapability,
  getOcfSchema,
  mapCategorizedTypeToEntityType,
  matchesTemplateIdentity,
  normalizeEntityType,
  normalizeOcfData,
  normalizeObjectType,
  sortTransactions,
  validateOcfCapTableSnapshot,
  type OcfEntityArguments,
  type OcfEntityType,
} from '@open-captable-protocol/canton';

export type DatabaseSource = 'dev' | 'production';
export type ReplayValidationMode = 'ledger-backed' | 'require-ledger-coverage';
export type ReplayExecutionMode = 'preflight' | 'replay';

export interface ReplayOptions {
  database: DatabaseSource;
  validationMode: ReplayValidationMode;
  preflightOnly: boolean;
  portalId?: string;
  reportDir: string;
}

export interface DatabaseOcfRow {
  portalId: string;
  type: string;
  subtype: string | null;
  data: unknown;
}

type OcfSnapshotObjectData = Record<string, unknown> & { id: string; object_type: string };

export interface PreparedOcfObject {
  entityType: OcfEntityType;
  objectAlias: string;
  objectId: string;
  data: OcfSnapshotObjectData;
}

export interface PreparedPortal {
  portalAlias: string;
  issuer: PreparedOcfObject;
  creates: PreparedOcfObject[];
  sourceObjectCount: number;
}

export type ReplayWarningCode = 'ISSUERLESS_PORTAL_EXCLUDED' | 'SCHEMA_ONLY_OBJECT_EXCLUDED';

/** Payload-free metadata that makes a validation failure actionable without publishing customer identifiers. */
export interface ReplayDiagnostic {
  code: string;
  objectType?: string;
  path?: string;
  objectAlias?: string;
}

export interface ReplayWarning {
  portalAlias: string;
  phase: 'capability' | 'snapshot';
  code: ReplayWarningCode;
  message: string;
  objectType?: string;
  objectAlias?: string;
}

export interface PreparedReplaySnapshot {
  portals: PreparedPortal[];
  failures: ReplayFailure[];
  warnings: ReplayWarning[];
  excludedPortalCount: number;
}

export type ReplayFailurePhase =
  | 'database'
  | 'schema'
  | 'capability'
  | 'mapping'
  | 'snapshot'
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
  objectAlias?: string;
  phase: ReplayFailurePhase;
  message: string;
  diagnostics?: ReplayDiagnostic[];
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
  validationMode: ReplayValidationMode;
  executionMode: ReplayExecutionMode;
  gitRef: string | null;
  gitSha: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  sourceObjectCount: number;
  portalCount: number;
  passedPortalCount: number;
  failedPortalCount: number;
  excludedPortalCount: number;
  notRunPortalCount: number;
  createdObjectCount: number;
  status: 'passed' | 'failed';
  results: PortalReplayResult[];
  warnings: ReplayWarning[];
  fatalFailure?: ReplayFailure;
}

export interface PublicReplayReport {
  database: DatabaseSource;
  validationMode: ReplayValidationMode;
  executionMode: ReplayExecutionMode;
  gitRef: string | null;
  gitSha: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'passed' | 'failed';
  failurePhases: ReplayFailurePhase[];
  diagnostics: Array<Omit<ReplayDiagnostic, 'objectAlias'>>;
  warningCodes: ReplayWarningCode[];
}

export class ReplayPhaseError extends Error {
  readonly phase: ReplayFailurePhase;
  readonly entityType?: string;
  readonly objectAlias?: string;
  readonly diagnostics?: ReplayDiagnostic[];

  constructor(
    phase: ReplayFailurePhase,
    message: string,
    context: {
      entityType?: string;
      objectAlias?: string;
      diagnostics?: ReplayDiagnostic[];
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = 'ReplayPhaseError';
    this.phase = phase;
    this.entityType = context.entityType;
    this.objectAlias = context.objectAlias;
    this.diagnostics = context.diagnostics;
    if (context.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = context.cause;
    }
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_ALIAS_KEY = randomBytes(32);

export function replayUsage(): string {
  return `
Usage: npm run replay-ocf:localnet -- [options]

Rebuild every committed OCF cap table from a read-only database snapshot on LocalNet.

Options:
  --database <dev|production>                              Source database label (default: dev)
  --validation-mode <ledger-backed|require-ledger-coverage> Validation scope (default: ledger-backed)
  --preflight-only                                         Validate the database snapshot without initializing LocalNet
  --portal-id <uuid>                                       Restrict a local diagnostic run to one portal
  --report-dir <path>                                      Sanitized report output directory
  --help                                                   Show this help

Database URL lookup order:
  POSTGRES_DB_URL, then POSTGRES_DB_URL_DEVNET/POSTGRES_DB_URL_APP_DEV for dev,
  or POSTGRES_DB_URL_MAINNET/POSTGRES_DB_URL_APP_PROD for production.
`;
}

export function parseReplayOptions(args: string[]): ReplayOptions {
  const options: ReplayOptions = {
    database: 'dev',
    validationMode: 'ledger-backed',
    preflightOnly: false,
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
      case '--validation-mode':
        if (value !== 'ledger-backed' && value !== 'require-ledger-coverage') {
          throw new Error('--validation-mode must be either ledger-backed or require-ledger-coverage');
        }
        options.validationMode = value;
        index += 1;
        break;
      case '--preflight-only':
        options.preflightOnly = true;
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
    throw new ReplayPhaseError('schema', `OCF payload is not an object in ${portalAlias}`, {
      diagnostics: [{ code: 'INVALID_OCF_PAYLOAD' }],
    });
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

interface ValidatedOcfRow {
  data: OcfSnapshotObjectData;
  objectAlias: string;
  objectId: string;
  objectType: string;
}

type PreparedSourceObject =
  | ({ support: 'ledger-backed' } & PreparedOcfObject)
  | {
      support: 'schema-only';
      objectAlias: string;
      objectId: string;
      objectType: string;
      data: OcfSnapshotObjectData;
    };

function validateRawRow(row: DatabaseOcfRow, portalAlias: string): ValidatedOcfRow {
  const data = requireRecord(row.data, portalAlias);
  const objectId = data['id'];
  const objectType = data['object_type'];

  if (typeof objectId !== 'string' || objectId.length === 0) {
    throw new ReplayPhaseError('schema', `OCF payload is missing a non-empty id in ${portalAlias}`, {
      diagnostics: [{ code: 'MISSING_REQUIRED_FIELD', path: 'id' }],
    });
  }
  const objectAlias = hashIdentifier(objectId, 'object');
  if (typeof objectType !== 'string' || objectType.length === 0) {
    throw new ReplayPhaseError('schema', 'OCF payload is missing object_type', {
      objectAlias,
      diagnostics: [{ code: 'MISSING_REQUIRED_FIELD', path: 'object_type' }],
    });
  }

  // Deliberately validate the original database JSON before the SDK normalizes legacy aliases.
  let rawSchemaResult: ReturnType<ReturnType<typeof getOcfSchema>['safeParse']>;
  try {
    rawSchemaResult = getOcfSchema(objectType).safeParse(data);
  } catch (error) {
    throw new ReplayPhaseError('schema', 'No strict OCF schema is available for object_type', {
      objectAlias,
      diagnostics: [{ code: 'STRICT_SCHEMA_UNAVAILABLE' }],
      cause: error,
    });
  }
  if (!rawSchemaResult.success) {
    throw new ReplayPhaseError(
      'schema',
      `Raw OCF schema validation failed: ${schemaIssueSummary(rawSchemaResult.error.issues)}`,
      {
        objectAlias,
        diagnostics: rawSchemaResult.error.issues.map((issue) => ({
          code: 'SCHEMA_VALIDATION_FAILED',
          objectType,
          objectAlias,
          ...(issue.path.length > 0 ? { path: issue.path.map(String).join('.') } : {}),
        })),
      }
    );
  }

  return { data: data as OcfSnapshotObjectData, objectAlias, objectId, objectType };
}

function prepareValidatedRow(row: DatabaseOcfRow, validated: ValidatedOcfRow): PreparedSourceObject {
  const { data, objectAlias, objectId, objectType } = validated;
  const capability = getOcfObjectTypeCapability(objectType);
  if (capability.support === 'unsupported') {
    throw new ReplayPhaseError('capability', 'OCF object_type has no declared replay capability', {
      objectAlias,
      diagnostics: [{ code: 'UNSUPPORTED_OBJECT_TYPE', objectType }],
    });
  }

  if (capability.support === 'schema-only') {
    const normalizedSubtype = row.subtype === null ? null : normalizeObjectType(row.subtype);
    if (row.type !== objectType && !(row.type === 'OBJECT' && normalizedSubtype === objectType)) {
      throw new ReplayPhaseError(
        'mapping',
        `Database category=${row.type}, subtype=${row.subtype ?? 'null'} does not match object_type=${objectType}`,
        {
          objectAlias,
          diagnostics: [{ code: 'DATABASE_CATEGORY_MISMATCH', objectType }],
        }
      );
    }
    return {
      support: 'schema-only',
      objectAlias,
      objectId,
      objectType,
      data,
    };
  }

  const normalizedSubtype = row.subtype === null ? null : normalizeObjectType(row.subtype);
  const categorizedEntityType = mapCategorizedTypeToEntityType(row.type, normalizedSubtype);
  if (!categorizedEntityType) {
    throw new ReplayPhaseError(
      'mapping',
      `Unsupported OCF mapping for category=${row.type}, subtype=${row.subtype ?? 'null'}, object_type=${objectType}`,
      {
        objectAlias,
        diagnostics: [{ code: 'DATABASE_CATEGORY_UNSUPPORTED', objectType }],
      }
    );
  }

  const normalizedCategorizedType = normalizeEntityType(categorizedEntityType);
  const normalizedObjectEntityType = normalizeEntityType(capability.entityType);
  if (normalizedCategorizedType !== normalizedObjectEntityType) {
    throw new ReplayPhaseError(
      'mapping',
      `Database category maps to ${categorizedEntityType}, but object_type maps to ${capability.entityType}`,
      {
        entityType: categorizedEntityType,
        objectAlias,
        diagnostics: [{ code: 'DATABASE_CATEGORY_MISMATCH', objectType }],
      }
    );
  }

  const expectedObjectType = ENTITY_OBJECT_TYPE_MAP[categorizedEntityType];
  if (
    normalizeEntityType(categorizedEntityType) === categorizedEntityType &&
    expectedObjectType !== capability.canonicalObjectType
  ) {
    throw new ReplayPhaseError(
      'mapping',
      `Entity ${categorizedEntityType} expects object_type=${expectedObjectType}, received ${objectType}`,
      {
        entityType: categorizedEntityType,
        objectAlias,
        diagnostics: [{ code: 'DATABASE_CATEGORY_MISMATCH', objectType }],
      }
    );
  }

  let normalizedData: OcfSnapshotObjectData;
  try {
    // Raw source JSON has already passed its original discriminator schema. Canonicalization belongs only at the
    // ledger boundary so compatibility aliases never bypass strict source validation.
    normalizedData = normalizeOcfData(data) as OcfSnapshotObjectData;
  } catch (error) {
    throw new ReplayPhaseError('conversion', 'OCF compatibility normalization failed', {
      objectAlias,
      diagnostics: [{ code: 'NORMALIZATION_FAILED', objectType, objectAlias }],
      cause: error,
    });
  }

  return {
    support: 'ledger-backed',
    entityType: categorizedEntityType,
    objectAlias,
    objectId,
    data: normalizedData,
  };
}

function isTransaction(item: PreparedOcfObject): boolean {
  const objectType = item.data['object_type'];
  return typeof objectType === 'string' && (objectType.startsWith('TX_') || objectType.startsWith('CE_'));
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

function prepareValidatedPortal(
  rows: DatabaseOcfRow[],
  validatedRows: readonly ValidatedOcfRow[],
  validationMode: ReplayValidationMode,
  warnings: ReplayWarning[]
): PreparedPortal | null {
  if (rows.length === 0) {
    throw new ReplayPhaseError('database', 'Portal group has no OCF rows');
  }

  const portalAlias = hashIdentifier(rows[0].portalId, 'portal');
  const prepared = rows.map((row, index) => prepareValidatedRow(row, validatedRows[index]));
  const schemaOnly = prepared.filter((item) => item.support === 'schema-only');
  for (const item of schemaOnly) {
    warnings.push({
      portalAlias,
      phase: 'capability',
      code: 'SCHEMA_ONLY_OBJECT_EXCLUDED',
      message: 'A strict-schema-valid object has no ledger representation and was excluded from replay.',
      objectType: item.objectType,
      objectAlias: item.objectAlias,
    });
  }
  if (validationMode === 'require-ledger-coverage' && schemaOnly.length > 0) {
    throw new ReplayPhaseError(
      'capability',
      'Required ledger coverage does not permit schema-only objects to be excluded from ledger replay',
      {
        diagnostics: schemaOnly.map((item) => ({
          code: 'SCHEMA_ONLY_OBJECT_EXCLUDED',
          objectType: item.objectType,
          objectAlias: item.objectAlias,
        })),
      }
    );
  }

  const ledgerBacked = prepared.filter(
    (item): item is Extract<PreparedSourceObject, { support: 'ledger-backed' }> => item.support === 'ledger-backed'
  );
  const issuers = ledgerBacked.filter((item) => item.entityType === 'issuer');
  if (issuers.length === 0 && validationMode === 'ledger-backed') {
    warnings.push({
      portalAlias,
      phase: 'snapshot',
      code: 'ISSUERLESS_PORTAL_EXCLUDED',
      message: 'A portal without an ISSUER root was excluded from ledger replay.',
      objectType: 'ISSUER',
    });
    return null;
  }
  if (issuers.length !== 1) {
    throw new ReplayPhaseError('snapshot', `Expected exactly one ISSUER object; found ${issuers.length}`, {
      diagnostics:
        issuers.length === 0
          ? [{ code: 'ISSUER_CARDINALITY', objectType: 'ISSUER' }]
          : issuers.map((issuer) => ({
              code: 'ISSUER_CARDINALITY',
              objectType: 'ISSUER',
              objectAlias: issuer.objectAlias,
            })),
    });
  }

  const snapshotValidation = validateOcfCapTableSnapshot(ledgerBacked.map((item) => item.data));
  if (!snapshotValidation.valid) {
    throw new ReplayPhaseError('snapshot', 'Ledger-backed OCF snapshot graph validation failed', {
      diagnostics: snapshotValidation.issues.map((issue) => ({
        code: issue.code,
        ...(issue.objectType ? { objectType: issue.objectType } : {}),
        ...(issue.path ? { path: issue.path } : {}),
        ...(issue.objectId ? { objectAlias: hashIdentifier(issue.objectId, 'object') } : {}),
      })),
      cause: snapshotValidation.issues,
    });
  }

  for (const item of ledgerBacked) {
    try {
      convertToDaml(...([item.entityType, item.data] as unknown as OcfEntityArguments));
    } catch (error) {
      throw new ReplayPhaseError('conversion', 'Canonical OCF-to-DAML conversion preflight failed', {
        entityType: item.entityType,
        objectAlias: item.objectAlias,
        diagnostics: [
          {
            code: 'DAML_CONVERSION_FAILED',
            objectType: item.data.object_type,
            objectAlias: item.objectAlias,
          },
        ],
        cause: error,
      });
    }
  }

  return {
    portalAlias,
    issuer: issuers[0],
    creates: orderCreates(ledgerBacked.filter((item) => item.entityType !== 'issuer')),
    sourceObjectCount: rows.length,
  };
}

export function preparePortal(rows: DatabaseOcfRow[]): PreparedPortal {
  if (rows.length === 0) {
    throw new ReplayPhaseError('database', 'Portal group has no OCF rows');
  }
  const portalAlias = hashIdentifier(rows[0].portalId, 'portal');
  const warnings: ReplayWarning[] = [];
  const portal = prepareValidatedPortal(
    rows,
    rows.map((row) => validateRawRow(row, portalAlias)),
    'ledger-backed',
    warnings
  );
  if (portal === null) {
    throw new ReplayPhaseError('snapshot', 'Expected exactly one ISSUER object; found 0', {
      diagnostics: [{ code: 'ISSUER_CARDINALITY', objectType: 'ISSUER' }],
    });
  }
  return portal;
}

/**
 * Build and validate the complete desired ledger snapshot before any LocalNet client is initialized. Raw OCF schema
 * validation is attempted for every source row before capability or graph planning.
 */
export function prepareReplaySnapshot(
  rows: DatabaseOcfRow[],
  validationMode: ReplayValidationMode = 'ledger-backed'
): PreparedReplaySnapshot {
  const groupedRows = groupRowsByPortal(rows);
  const validatedByRow = new Map<DatabaseOcfRow, ValidatedOcfRow>();
  const schemaFailureByPortal = new Map<string, ReplayFailure>();

  for (const row of rows) {
    const portalAlias = hashIdentifier(row.portalId, 'portal');
    try {
      validatedByRow.set(row, validateRawRow(row, portalAlias));
    } catch (error) {
      const failure = toReplayFailure(portalAlias, error, 'schema');
      const existing = schemaFailureByPortal.get(row.portalId);
      if (existing) {
        existing.diagnostics = uniqueReplayDiagnostics([
          ...(existing.diagnostics ?? []),
          ...(failure.diagnostics ?? []),
        ]);
      } else {
        schemaFailureByPortal.set(row.portalId, failure);
      }
    }
  }

  const portals: PreparedPortal[] = [];
  const failures: ReplayFailure[] = [];
  const warnings: ReplayWarning[] = [];
  let excludedPortalCount = 0;

  for (const [portalId, portalRows] of groupedRows) {
    const schemaFailure = schemaFailureByPortal.get(portalId);
    if (schemaFailure) {
      failures.push(schemaFailure);
      continue;
    }

    const portalAlias = hashIdentifier(portalId, 'portal');
    try {
      const validatedRows = portalRows.map((row) => {
        const validated = validatedByRow.get(row);
        if (!validated) throw new ReplayPhaseError('schema', 'Raw OCF row validation result is unavailable');
        return validated;
      });
      const portal = prepareValidatedPortal(portalRows, validatedRows, validationMode, warnings);
      if (portal === null) {
        excludedPortalCount += 1;
      } else {
        portals.push(portal);
      }
    } catch (error) {
      failures.push(toReplayFailure(portalAlias, error));
    }
  }

  return { portals, failures, warnings, excludedPortalCount };
}

const PUBLIC_FAILURE_MESSAGES: Record<ReplayFailurePhase, string> = {
  database: 'The read-only database snapshot could not be loaded safely.',
  schema: 'At least one source object failed strict OCF schema validation.',
  capability: 'At least one source object is outside the selected replay capability scope.',
  mapping: 'At least one source object has an unsupported or inconsistent OCF mapping.',
  snapshot: 'At least one ledger-backed cap-table snapshot failed graph validation.',
  ordering: 'The source transaction history could not be ordered.',
  party: 'A LocalNet issuer party could not be prepared.',
  authorization: 'A LocalNet issuer could not be authorized.',
  issuer: 'An issuer and empty cap table could not be created on LocalNet.',
  conversion: 'At least one OCF object could not be converted to a DAML command.',
  batch: 'An atomic full-cap-table replay failed on LocalNet.',
  convergence: 'A replayed cap table did not converge to the source snapshot.',
  infrastructure: 'The isolated LocalNet replay infrastructure failed.',
};

function replayDiagnosticKey(diagnostic: ReplayDiagnostic): string {
  return `${diagnostic.code}\u0000${diagnostic.objectType ?? ''}\u0000${diagnostic.path ?? ''}\u0000${diagnostic.objectAlias ?? ''}`;
}

function uniqueReplayDiagnostics(diagnostics: readonly ReplayDiagnostic[]): ReplayDiagnostic[] {
  return Array.from(
    new Map(diagnostics.map((diagnostic) => [replayDiagnosticKey(diagnostic), diagnostic])).values()
  ).sort((left, right) => replayDiagnosticKey(left).localeCompare(replayDiagnosticKey(right)));
}

export function toReplayFailure(
  portalAlias: string,
  error: unknown,
  fallbackPhase: ReplayFailurePhase = 'infrastructure'
): ReplayFailure {
  const replayError = error instanceof ReplayPhaseError ? error : undefined;
  const phase = replayError?.phase ?? fallbackPhase;
  return {
    portalAlias,
    ...(replayError?.objectAlias ? { objectAlias: replayError.objectAlias } : {}),
    phase,
    message: PUBLIC_FAILURE_MESSAGES[phase],
    ...(replayError?.diagnostics ? { diagnostics: uniqueReplayDiagnostics(replayError.diagnostics) } : {}),
  };
}

export function escapeWorkflowCommand(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function collectReplayDiagnostics(failures: readonly ReplayFailure[]): ReplayDiagnostic[] {
  return uniqueReplayDiagnostics(failures.flatMap((failure) => failure.diagnostics ?? []));
}

function collectPublicReplayDiagnostics(
  failures: readonly ReplayFailure[]
): Array<Omit<ReplayDiagnostic, 'objectAlias'>> {
  return uniqueReplayDiagnostics(
    collectReplayDiagnostics(failures).map(({ code, objectType, path: diagnosticPath }) => ({
      code,
      ...(objectType ? { objectType } : {}),
      ...(diagnosticPath ? { path: diagnosticPath } : {}),
    }))
  );
}

function renderReplayDiagnostic(diagnostic: ReplayDiagnostic): string {
  const location = [diagnostic.objectType, diagnostic.path].filter(Boolean).join('.');
  return location ? `${diagnostic.code} (${location})` : diagnostic.code;
}

export function renderPrivateReplayFailure(failure: ReplayFailure): string {
  const aliases = [failure.portalAlias, failure.objectAlias].filter(Boolean).join('/');
  const diagnostics = (failure.diagnostics ?? []).map((diagnostic) => {
    const rendered = renderReplayDiagnostic(diagnostic);
    return diagnostic.objectAlias ? `${rendered} [${diagnostic.objectAlias}]` : rendered;
  });
  return [failure.message, `[${aliases}]`, ...diagnostics].join(' | ');
}

export function renderReplayMarkdown(report: ReplayReport): string {
  const preflightOnly = report.executionMode === 'preflight';
  const lines = [
    preflightOnly ? '# OCF database replay preflight' : '# OCF database replay on LocalNet',
    '',
    `- Status: **${report.status.toUpperCase()}**`,
    `- Source: **${report.database}** database (read-only snapshot)`,
    `- Validation mode: **${report.validationMode}**`,
    `- Execution: **${report.executionMode}**`,
    `- Ref: \`${report.gitRef ?? 'local'}\``,
    `- Duration: ${(report.durationMs / 1000).toFixed(1)}s`,
    '',
  ];

  const failures = [
    ...(report.fatalFailure ? [report.fatalFailure] : []),
    ...report.results.flatMap((result) => (result.failure ? [result.failure] : [])),
  ];
  const diagnostics = collectPublicReplayDiagnostics(failures);
  const warningCodes = Array.from(new Set(report.warnings.map((warning) => warning.code))).sort();
  if (failures.length === 0) {
    lines.push(
      preflightOnly
        ? 'Every source object passed raw OCF schema validation. Every replayable ledger-backed cap table is ready for LocalNet.'
        : 'Every source object passed raw OCF schema validation. Every replayable ledger-backed cap table converged on LocalNet.'
    );
    if (warningCodes.length > 0) {
      lines.push('', 'Replay exclusions:');
      for (const code of warningCodes) lines.push(`- ${code}`);
      lines.push('', 'Excluded objects and portals are identified only in the private job log.');
    }
    return `${lines.join('\n')}\n`;
  }

  lines.push('Failure phases:');
  for (const phase of Array.from(new Set(failures.map((failure) => failure.phase))).sort()) {
    lines.push(`- ${phase}`);
  }
  if (diagnostics.length > 0) {
    lines.push('', 'Payload-free diagnostics:');
    for (const diagnostic of diagnostics) lines.push(`- ${renderReplayDiagnostic(diagnostic)}`);
  }
  if (warningCodes.length > 0) {
    lines.push('', 'Replay exclusions:');
    for (const code of warningCodes) lines.push(`- ${code}`);
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
    validationMode: report.validationMode,
    executionMode: report.executionMode,
    gitRef: report.gitRef,
    gitSha: report.gitSha,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    durationMs: report.durationMs,
    status: report.status,
    failurePhases: Array.from(new Set(failures.map((failure) => failure.phase))).sort(),
    diagnostics: collectPublicReplayDiagnostics(failures),
    warningCodes: Array.from(new Set(report.warnings.map((warning) => warning.code))).sort(),
  };
}
