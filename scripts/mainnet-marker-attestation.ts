#!/usr/bin/env node
/**
 * Create and verify immutable GitHub Actions attestations for Mainnet DAR markers.
 *
 * The trusted upload workflow writes an attestation only after its Mainnet upload and marker commit succeed. The
 * pull_request_target policy then resolves that exact run artifact and verifies both GitHub provenance and the Git
 * commit transition before allowing a Mainnet marker addition.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { DarsLock, DarsLockEntry } from './dar-utils';
import { assertDarsLockSchema } from './dar-marker-policy';
import { requirePackageConfig } from './packages';

export const MAINNET_ATTESTATION_SCHEMA_VERSION = 1;
export const MAINNET_ATTESTATION_FILE = 'mainnet-marker-attestation.json';
export const MAINNET_ATTESTATION_WORKFLOW = '.github/workflows/release.yml';
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_ATTESTATION_ARTIFACT_BYTES = 1024 * 1024;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_PACKAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const IMMUTABLE_FIELDS = ['sha256', 'size', 'sdkVersion', 'uploadedAt'] as const;

type JsonRecord = Record<string, unknown>;

export interface ParsedMarkerBranch {
  package: string;
  runAttempt: number;
  runId: number;
}

export interface MainnetMarkerAttestation {
  lockEntry: Pick<DarsLockEntry, 'sdkVersion' | 'sha256' | 'size' | 'uploadedAt'>;
  lockKey: string;
  markerCommitSha: string;
  network: 'mainnet';
  package: string;
  repository: string;
  runAttempt: number;
  runId: number;
  schemaVersion: 1;
  workflowPath: string;
}

export interface WorkflowRunIdentity {
  headSha: string;
}

export interface ArtifactSelection {
  artifactId: number;
  artifactName: string;
}

interface AttestationContext {
  defaultBranch: string;
  repository: string;
  workflowPath: string;
}

interface MarkerTransition {
  entry: DarsLockEntry;
  lockKey: string;
  parentSha: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: JsonRecord, expectedKeys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${label}: expected exactly ${expected.join(', ')}; received ${actual.join(', ')}`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireSha(value: unknown, label: string): string {
  const sha = requireString(value, label);
  if (!SHA_PATTERN.test(sha)) throw new Error(`${label} must be a lowercase 40-character Git SHA`);
  return sha;
}

function readBoundedJson(filePath: string, label: string): unknown {
  const stats = fs.statSync(filePath);
  if (!stats.isFile() || stats.size < 1 || stats.size > MAX_JSON_BYTES) {
    throw new Error(`${label} must be a non-empty regular file no larger than ${MAX_JSON_BYTES} bytes`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function git(repositoryRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

function isAncestor(repositoryRoot: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: repositoryRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function readLockAtCommit(repositoryRoot: string, commitSha: string): DarsLock {
  const text = git(repositoryRoot, ['show', `${commitSha}:dars/dars.lock`]);
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) {
    throw new Error(`dars.lock at ${commitSha} exceeds ${MAX_JSON_BYTES} bytes`);
  }
  const parsed = JSON.parse(text) as unknown;
  assertDarsLockSchema(parsed, `dars.lock at ${commitSha}`);
  return parsed;
}

function immutableEntry(entry: DarsLockEntry): MainnetMarkerAttestation['lockEntry'] {
  return {
    sdkVersion: entry.sdkVersion,
    sha256: entry.sha256,
    size: entry.size,
    uploadedAt: entry.uploadedAt,
  };
}

function assertEntryMatches(
  actual: DarsLockEntry,
  expected: MainnetMarkerAttestation['lockEntry'],
  label: string
): void {
  for (const field of IMMUTABLE_FIELDS) {
    if (actual[field] !== expected[field]) {
      throw new Error(`${label}: immutable ${field} does not match the attestation`);
    }
  }
}

function parseLockCoordinates(lockKey: string): { darName: string; packageName: string } {
  const parts = lockKey.split('/');
  if (parts.length !== 3 || !parts[0] || !/^\d+\.\d+\.\d+$/.test(parts[1] ?? '')) {
    throw new Error(`Invalid attested lock key: ${lockKey}`);
  }
  const file = parts[2];
  if (!file.endsWith('.dar')) throw new Error(`Invalid attested lock key: ${lockKey}`);
  const darName = file.slice(0, -4);
  if (!SAFE_PACKAGE_PATTERN.test(parts[0]) || !SAFE_PACKAGE_PATTERN.test(darName)) {
    throw new Error(`Unsafe attested lock key: ${lockKey}`);
  }
  return { darName, packageName: parts[0] };
}

function assertPackageMatchesLock(packageKey: string, lockKey: string): void {
  const packageConfig = requirePackageConfig(packageKey);
  const { darName, packageName } = parseLockCoordinates(lockKey);
  if (packageName !== packageConfig.name || darName !== packageConfig.darName) {
    throw new Error(
      `Attested package ${packageKey} resolves to ${packageConfig.name}/${packageConfig.darName}, not ${lockKey}`
    );
  }
}

export function parseOcpMainnetMarkerBranch(branch: string): ParsedMarkerBranch {
  const match = /^automation\/ocp-release-([1-9][0-9]*)-([1-9][0-9]*)$/.exec(branch);
  if (!match) {
    throw new Error('Mainnet marker branch must be automation/ocp-release-<run-id>-<run-attempt>');
  }
  const runId = Number(match[1]);
  const runAttempt = Number(match[2]);
  if (!Number.isSafeInteger(runId) || !Number.isSafeInteger(runAttempt)) {
    throw new Error('Mainnet marker branch contains an unsafe run id or attempt');
  }
  return { package: 'ocp', runAttempt, runId };
}

export function getMainnetAttestationArtifactName(parsed: ParsedMarkerBranch): string {
  return `dar-mainnet-marker-attestation-${parsed.runId}-${parsed.runAttempt}-${parsed.package}`;
}

export function requiresMainnetAttestation(repositoryRoot: string, baseRef: string, candidateRef: string): boolean {
  const safeRef = /^(?:HEAD|[0-9a-f]{40})$/;
  if (!safeRef.test(baseRef) || !safeRef.test(candidateRef)) throw new Error('Unsafe Git ref for marker comparison');
  const baseSha = git(repositoryRoot, ['rev-parse', '--verify', `${baseRef}^{commit}`]);
  const candidateSha = git(repositoryRoot, ['rev-parse', '--verify', `${candidateRef}^{commit}`]);
  const baseLock = readLockAtCommit(repositoryRoot, baseSha);
  const candidateLock = readLockAtCommit(repositoryRoot, candidateSha);
  return Object.entries(candidateLock.packages).some(([lockKey, entry]) => {
    const baseNetworks = Object.prototype.hasOwnProperty.call(baseLock.packages, lockKey)
      ? baseLock.packages[lockKey].networks
      : [];
    return entry.networks.includes('mainnet') && !baseNetworks.includes('mainnet');
  });
}

export function validateWorkflowRun(
  rawRun: unknown,
  parsed: ParsedMarkerBranch,
  context: AttestationContext
): WorkflowRunIdentity {
  if (!isRecord(rawRun)) throw new Error('GitHub workflow run response must be an object');
  const repository = isRecord(rawRun.repository) ? rawRun.repository.full_name : undefined;
  const headRepository = isRecord(rawRun.head_repository) ? rawRun.head_repository.full_name : undefined;
  const failures: string[] = [];
  if (rawRun.id !== parsed.runId) failures.push('run id');
  if (rawRun.run_attempt !== parsed.runAttempt) failures.push('run attempt');
  if (rawRun.event !== 'workflow_dispatch' && rawRun.event !== 'push') failures.push('workflow event');
  if (rawRun.path !== context.workflowPath) failures.push('workflow path');
  const releaseTagRef =
    typeof rawRun.head_branch === 'string' && /^OpenCapTable-v[0-9]+-v[0-9]+\.[0-9]+\.[0-9]+$/.test(rawRun.head_branch);
  const trustedWorkflowRef =
    rawRun.event === 'workflow_dispatch'
      ? rawRun.head_branch === context.defaultBranch
      : rawRun.head_branch === context.defaultBranch || releaseTagRef;
  if (!trustedWorkflowRef) failures.push('trusted workflow ref');
  if (typeof repository !== 'string' || repository.toLowerCase() !== context.repository.toLowerCase()) {
    failures.push('repository');
  }
  if (typeof headRepository !== 'string' || headRepository.toLowerCase() !== context.repository.toLowerCase()) {
    failures.push('head repository');
  }
  let headSha = '';
  try {
    headSha = requireSha(rawRun.head_sha, 'Workflow run head SHA');
  } catch {
    failures.push('head SHA');
  }
  if (failures.length > 0) {
    throw new Error(`GitHub run does not match trusted Mainnet upload provenance: ${failures.join(', ')}`);
  }
  return { headSha };
}

export function selectWorkflowArtifact(rawListing: unknown, parsed: ParsedMarkerBranch): ArtifactSelection {
  if (!isRecord(rawListing) || !Array.isArray(rawListing.artifacts)) {
    throw new Error('GitHub workflow artifact response must contain an artifacts array');
  }
  if (
    typeof rawListing.total_count !== 'number' ||
    !Number.isSafeInteger(rawListing.total_count) ||
    rawListing.total_count < rawListing.artifacts.length
  ) {
    throw new Error('GitHub workflow artifact response has an invalid total_count');
  }
  if (rawListing.total_count !== rawListing.artifacts.length) {
    throw new Error('GitHub workflow artifact response is incomplete; refusing to select from a partial page');
  }

  const expectedName = getMainnetAttestationArtifactName(parsed);
  const matches = rawListing.artifacts.filter((value) => isRecord(value) && value.name === expectedName);
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one immutable Mainnet attestation artifact named ${expectedName}; found ${matches.length}`
    );
  }
  const match = matches[0];
  if (match.expired !== false) throw new Error(`Mainnet attestation artifact ${expectedName} is expired`);
  const artifactBytes = requirePositiveInteger(match.size_in_bytes, 'Mainnet attestation artifact size');
  if (artifactBytes > MAX_ATTESTATION_ARTIFACT_BYTES) {
    throw new Error(`Mainnet attestation artifact ${expectedName} exceeds ${MAX_ATTESTATION_ARTIFACT_BYTES} bytes`);
  }
  return {
    artifactId: requirePositiveInteger(match.id, 'Mainnet attestation artifact id'),
    artifactName: expectedName,
  };
}

export function parseMainnetMarkerAttestation(raw: unknown): MainnetMarkerAttestation {
  if (!isRecord(raw)) throw new Error('Mainnet marker attestation must be an object');
  assertExactKeys(
    raw,
    [
      'schemaVersion',
      'repository',
      'workflowPath',
      'runId',
      'runAttempt',
      'package',
      'network',
      'markerCommitSha',
      'lockKey',
      'lockEntry',
    ],
    'Mainnet marker attestation'
  );
  if (raw.schemaVersion !== MAINNET_ATTESTATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported Mainnet marker attestation schema: ${String(raw.schemaVersion)}`);
  }
  if (raw.network !== 'mainnet') throw new Error('Mainnet marker attestation network must be mainnet');
  if (!isRecord(raw.lockEntry)) throw new Error('Mainnet marker attestation lockEntry must be an object');
  assertExactKeys(raw.lockEntry, IMMUTABLE_FIELDS, 'Mainnet marker attestation lockEntry');
  const { lockEntry } = raw;
  const sha256 = requireString(lockEntry.sha256, 'Attested DAR sha256');
  if (!/^[0-9a-f]{64}$/.test(sha256))
    throw new Error('Attested DAR sha256 must be 64 lowercase hexadecimal characters');
  const size = requirePositiveInteger(lockEntry.size, 'Attested DAR size');
  const sdkVersion = requireString(lockEntry.sdkVersion, 'Attested DAR SDK version');
  const uploadedAt = requireString(lockEntry.uploadedAt, 'Attested DAR uploadedAt');
  if (!Number.isFinite(Date.parse(uploadedAt))) throw new Error('Attested DAR uploadedAt must be a valid timestamp');

  return {
    lockEntry: { sdkVersion, sha256, size, uploadedAt },
    lockKey: requireString(raw.lockKey, 'Attested lock key'),
    markerCommitSha: requireSha(raw.markerCommitSha, 'Attested marker commit'),
    network: 'mainnet',
    package: requireString(raw.package, 'Attested package'),
    repository: requireString(raw.repository, 'Attested repository'),
    runAttempt: requirePositiveInteger(raw.runAttempt, 'Attested run attempt'),
    runId: requirePositiveInteger(raw.runId, 'Attested run id'),
    schemaVersion: MAINNET_ATTESTATION_SCHEMA_VERSION,
    workflowPath: requireString(raw.workflowPath, 'Attested workflow path'),
  };
}

function inspectMarkerTransition(repositoryRoot: string, markerCommitSha: string): MarkerTransition {
  const resolved = git(repositoryRoot, ['rev-parse', '--verify', `${markerCommitSha}^{commit}`]);
  if (resolved !== markerCommitSha) throw new Error('Marker commit SHA did not resolve exactly');

  const lineage = git(repositoryRoot, ['rev-list', '--parents', '-n', '1', markerCommitSha]).split(/\s+/);
  if (lineage.length !== 2) throw new Error('Mainnet marker commit must have exactly one parent');
  const parentSha = lineage[1];
  const changedPaths = git(repositoryRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', markerCommitSha])
    .split('\n')
    .filter(Boolean);
  if (!isDeepStrictEqual(changedPaths, ['dars/dars.lock'])) {
    throw new Error(`Mainnet marker commit may change only dars/dars.lock; changed: ${changedPaths.join(', ')}`);
  }

  const parentLock = readLockAtCommit(repositoryRoot, parentSha);
  const markerLock = readLockAtCommit(repositoryRoot, markerCommitSha);
  if (parentLock.version !== markerLock.version) throw new Error('Mainnet marker commit changed dars.lock version');
  const parentKeys = Object.keys(parentLock.packages).sort();
  const markerKeys = Object.keys(markerLock.packages).sort();
  if (!isDeepStrictEqual(parentKeys, markerKeys)) throw new Error('Mainnet marker commit changed the DAR lock key set');

  let addition: { entry: DarsLockEntry; lockKey: string } | null = null;
  for (const lockKey of parentKeys) {
    const parentEntry = parentLock.packages[lockKey];
    const markerEntry = markerLock.packages[lockKey];
    const immutableMatches = IMMUTABLE_FIELDS.every((field) => parentEntry[field] === markerEntry[field]);
    if (!immutableMatches) throw new Error(`Mainnet marker commit changed immutable metadata for ${lockKey}`);
    if (isDeepStrictEqual(parentEntry.networks, markerEntry.networks)) continue;
    if (
      addition ||
      parentEntry.networks.includes('mainnet') ||
      !isDeepStrictEqual(markerEntry.networks, [...parentEntry.networks, 'mainnet'])
    ) {
      throw new Error('Mainnet marker commit must add exactly one mainnet marker and make no other lock changes');
    }
    addition = { entry: markerEntry, lockKey };
  }
  if (!addition) throw new Error('Mainnet marker commit did not add exactly one mainnet marker');
  return { ...addition, parentSha };
}

export function createMainnetMarkerAttestation(options: {
  markerCommitSha: string;
  package: string;
  repository: string;
  repositoryRoot: string;
  runAttempt: number;
  runId: number;
  workflowPath: string;
}): MainnetMarkerAttestation {
  const markerCommitSha = requireSha(options.markerCommitSha, 'Marker commit SHA');
  const transition = inspectMarkerTransition(options.repositoryRoot, markerCommitSha);
  assertPackageMatchesLock(options.package, transition.lockKey);
  return {
    lockEntry: immutableEntry(transition.entry),
    lockKey: transition.lockKey,
    markerCommitSha,
    network: 'mainnet',
    package: options.package,
    repository: options.repository,
    runAttempt: requirePositiveInteger(options.runAttempt, 'Run attempt'),
    runId: requirePositiveInteger(options.runId, 'Run id'),
    schemaVersion: MAINNET_ATTESTATION_SCHEMA_VERSION,
    workflowPath: options.workflowPath,
  };
}

export function verifyMainnetMarkerAttestation(options: {
  artifact: unknown;
  branch: string;
  candidateHead: string;
  context: AttestationContext;
  repositoryRoot: string;
  trustedDefaultHead: string;
  workflowRun: unknown;
}): MainnetMarkerAttestation {
  const parsedBranch = parseOcpMainnetMarkerBranch(options.branch);
  const run = validateWorkflowRun(options.workflowRun, parsedBranch, options.context);
  const artifact = parseMainnetMarkerAttestation(options.artifact);

  if (
    artifact.repository !== options.context.repository ||
    artifact.workflowPath !== options.context.workflowPath ||
    artifact.runId !== parsedBranch.runId ||
    artifact.runAttempt !== parsedBranch.runAttempt ||
    artifact.package !== parsedBranch.package
  ) {
    throw new Error('Mainnet marker attestation does not match its repository, workflow run, or automation branch');
  }
  assertPackageMatchesLock(artifact.package, artifact.lockKey);
  const candidateHead = requireSha(options.candidateHead, 'Candidate head SHA');
  if (!isAncestor(options.repositoryRoot, artifact.markerCommitSha, candidateHead)) {
    throw new Error('Attested Mainnet marker commit is not an ancestor of the candidate head');
  }
  if (!isAncestor(options.repositoryRoot, run.headSha, artifact.markerCommitSha)) {
    throw new Error('Trusted workflow run head SHA is not an ancestor of the Mainnet marker commit');
  }
  const trustedDefaultHead = requireSha(options.trustedDefaultHead, 'Trusted default-branch head SHA');
  if (!isAncestor(options.repositoryRoot, run.headSha, trustedDefaultHead)) {
    throw new Error('Workflow run head SHA is not part of the trusted default-branch history');
  }

  const transition = inspectMarkerTransition(options.repositoryRoot, artifact.markerCommitSha);
  if (transition.lockKey !== artifact.lockKey) throw new Error('Attested lock key does not match the marker commit');
  assertEntryMatches(transition.entry, artifact.lockEntry, artifact.lockKey);

  const candidateLock = readLockAtCommit(options.repositoryRoot, candidateHead);
  if (!Object.prototype.hasOwnProperty.call(candidateLock.packages, artifact.lockKey)) {
    throw new Error('Candidate head does not retain the attested Mainnet marker');
  }
  const candidateEntry = candidateLock.packages[artifact.lockKey];
  if (!candidateEntry.networks.includes('mainnet')) {
    throw new Error('Candidate head does not retain the attested Mainnet marker');
  }
  assertEntryMatches(candidateEntry, artifact.lockEntry, `Candidate ${artifact.lockKey}`);
  return artifact;
}

function getArg(args: string[], name: string): string {
  const indexes = args.flatMap((value, index) => (value === name ? [index] : []));
  if (indexes.length !== 1 || !args[indexes[0] + 1]) throw new Error(`Expected exactly one ${name} argument`);
  return args[indexes[0] + 1];
}

function parseIntegerArg(args: string[], name: string): number {
  const value = Number(getArg(args, name));
  return requirePositiveInteger(value, name);
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'parse-branch') {
    process.stdout.write(`${JSON.stringify(parseOcpMainnetMarkerBranch(getArg(args, '--branch')))}\n`);
    return;
  }
  if (command === 'needs-attestation') {
    const required = requiresMainnetAttestation(
      path.resolve(getArg(args, '--repository-root')),
      getArg(args, '--base-head'),
      getArg(args, '--candidate-head')
    );
    process.stdout.write(`${JSON.stringify({ required })}\n`);
    return;
  }

  const context: AttestationContext = {
    defaultBranch: getArg(args, '--default-branch'),
    repository: getArg(args, '--repository'),
    workflowPath: getArg(args, '--workflow-path'),
  };
  if (command === 'inspect') {
    const branch = getArg(args, '--branch');
    const parsed = parseOcpMainnetMarkerBranch(branch);
    validateWorkflowRun(readBoundedJson(getArg(args, '--workflow-run-json'), 'Workflow run JSON'), parsed, context);
    const selection = selectWorkflowArtifact(
      readBoundedJson(getArg(args, '--artifacts-json'), 'Workflow artifacts JSON'),
      parsed
    );
    process.stdout.write(`${JSON.stringify(selection)}\n`);
    return;
  }
  if (command === 'create') {
    const attestation = createMainnetMarkerAttestation({
      markerCommitSha: getArg(args, '--marker-commit'),
      package: getArg(args, '--package'),
      repository: context.repository,
      repositoryRoot: path.resolve(getArg(args, '--repository-root')),
      runAttempt: parseIntegerArg(args, '--run-attempt'),
      runId: parseIntegerArg(args, '--run-id'),
      workflowPath: context.workflowPath,
    });
    writeJson(path.resolve(getArg(args, '--output')), attestation);
    return;
  }
  if (command === 'verify') {
    const artifact = verifyMainnetMarkerAttestation({
      artifact: readBoundedJson(getArg(args, '--artifact-json'), 'Mainnet marker attestation'),
      branch: getArg(args, '--branch'),
      candidateHead: getArg(args, '--candidate-head'),
      context,
      repositoryRoot: path.resolve(getArg(args, '--repository-root')),
      trustedDefaultHead: getArg(args, '--trusted-default-head'),
      workflowRun: readBoundedJson(getArg(args, '--workflow-run-json'), 'Workflow run JSON'),
    });
    process.stdout.write(
      `Verified Mainnet marker attestation for ${artifact.package} (${artifact.lockKey}) at ${artifact.markerCommitSha}\n`
    );
    return;
  }
  throw new Error(
    'Usage: mainnet-marker-attestation.ts <parse-branch|needs-attestation|inspect|create|verify> [options]'
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Mainnet marker attestation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
