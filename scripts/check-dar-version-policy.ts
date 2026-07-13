#!/usr/bin/env node
/** Trusted DevNet policy check. Candidate files are data; this script must come from the target/default branch. */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import {
  assertContainedRegularFile,
  MAX_CANDIDATE_LOCK_BYTES,
  MAX_CANDIDATE_METADATA_BYTES,
} from './candidate-path-safety';
import type { DarsLock } from './dar-utils';
import { getDarLockKey } from './dar-utils';
import {
  assertDarsLockSchema,
  assertDevnetMarkerIdentity,
  classifyCandidateOnlyBackups,
  getNetworkMarkerAdditions,
} from './dar-marker-policy';
import { inspectDarPackageId } from './dar-package-id';
import { assertDevnetPreferencesConsistent } from './dar-version-policy';
import { validateDevnetDarCandidate, verifyLockedDar } from './devnet-dar-policy';
import { queryDevnetPackagePreferences, type DevnetPackagePreference } from './devnet-package-versions';
import { LEDGER_SCRIPT_PROVIDERS } from './providers';

const ROOT_DIR = path.join(__dirname, '..');
const DEVNET_SECRET_NAMES = [
  'CANTON_DEVNET_INTELLECT_LEDGER_JSON_API_CLIENT_SECRET',
  'CANTON_DEVNET_5N_LEDGER_JSON_API_CLIENT_SECRET',
] as const;
const MAX_HISTORY_LOCK_COMMITS = 5000;
const GIT_READ_TIMEOUT_MS = 60_000;

interface DamlMetadata {
  name: string;
  version: string;
}

interface Args {
  allowMainnetMarkerAdditions: boolean;
  auditAll: boolean;
  baseRef: string;
  candidateRoot: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  return {
    allowMainnetMarkerAdditions: args.includes('--allow-mainnet-marker-additions'),
    auditAll: args.includes('--audit-all'),
    baseRef: valueAfter('--base') ?? 'origin/main',
    candidateRoot: path.resolve(valueAfter('--candidate-root') ?? ROOT_DIR),
  };
}

function readCandidateFile(candidateRoot: string, relativePath: string): string {
  const resolvedRoot = path.resolve(candidateRoot);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  assertContainedRegularFile(resolvedRoot, resolvedPath, `Candidate file ${relativePath}`, MAX_CANDIDATE_LOCK_BYTES);
  return fs.readFileSync(resolvedPath, 'utf8');
}

function loadCandidateLock(candidateRoot: string): DarsLock {
  const parsed = JSON.parse(readCandidateFile(candidateRoot, 'dars/dars.lock')) as unknown;
  if (!isRecord(parsed) || typeof parsed.version !== 'number' || !isRecord(parsed.packages)) {
    throw new Error('Candidate dars/dars.lock has an invalid structure.');
  }
  const packages: DarsLock['packages'] = {};
  for (const [lockKey, value] of Object.entries(parsed.packages)) {
    if (
      !isRecord(value) ||
      typeof value.sha256 !== 'string' ||
      typeof value.size !== 'number' ||
      typeof value.sdkVersion !== 'string' ||
      typeof value.uploadedAt !== 'string' ||
      !Array.isArray(value.networks) ||
      !value.networks.every((network) => typeof network === 'string')
    ) {
      throw new Error(`Candidate dars.lock entry ${lockKey} has an invalid structure.`);
    }
    packages[lockKey] = {
      sha256: value.sha256,
      size: value.size,
      sdkVersion: value.sdkVersion,
      uploadedAt: value.uploadedAt,
      networks: value.networks,
    };
  }
  const lock = { version: parsed.version, packages };
  assertDarsLockSchema(lock, 'Candidate dars.lock');
  return lock;
}

function gitShow(baseRef: string, filePath: string): string | null {
  try {
    return execFileSync('git', ['show', `${baseRef}:${filePath}`], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      maxBuffer: MAX_CANDIDATE_LOCK_BYTES + 1024,
      timeout: GIT_READ_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
}

function loadHistoricalLocks(baseRef: string): DarsLock[] {
  const rawCommits = execFileSync('git', ['log', '--format=%H', baseRef, '--', 'dars/dars.lock'], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: GIT_READ_TIMEOUT_MS,
  });
  const commits = rawCommits.split('\n').filter(Boolean);
  if (commits.length > MAX_HISTORY_LOCK_COMMITS) {
    throw new Error(`Refusing to inspect more than ${MAX_HISTORY_LOCK_COMMITS} historical dars.lock revisions.`);
  }
  return commits.map((commit, index) => {
    const text = gitShow(commit, 'dars/dars.lock');
    if (!text) throw new Error(`Unable to read historical dars.lock at ${commit}.`);
    const lock = JSON.parse(text) as unknown;
    assertDarsLockSchema(lock, `Historical dars.lock ${index + 1} (${commit})`);
    return lock;
  });
}

function findCandidatePackages(candidateRoot: string): Array<{ sourceDir: string; metadata: DamlMetadata }> {
  const packages: Array<{ sourceDir: string; metadata: DamlMetadata }> = [];
  for (const entry of fs.readdirSync(candidateRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'Test') continue;
    const metadataPath = path.join(candidateRoot, entry.name, 'daml.yaml');
    if (!fs.existsSync(metadataPath)) continue;
    assertContainedRegularFile(candidateRoot, metadataPath, 'Candidate DAML metadata', MAX_CANDIDATE_METADATA_BYTES);
    const metadata = yaml.parse(fs.readFileSync(metadataPath, 'utf8'), {
      maxAliasCount: 50,
      schema: 'core',
    }) as Partial<DamlMetadata>;
    if (
      typeof metadata.name !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(metadata.name) ||
      typeof metadata.version !== 'string' ||
      !/^\d+\.\d+\.\d+$/.test(metadata.version)
    ) {
      throw new Error(`Invalid package metadata in ${entry.name}/daml.yaml.`);
    }
    packages.push({ sourceDir: entry.name, metadata: metadata as DamlMetadata });
  }
  if (packages.length > 50) throw new Error('Refusing candidate with more than 50 top-level DAML packages.');
  return packages;
}

function formatLivePreferences(preferences: Awaited<ReturnType<typeof queryDevnetPackagePreferences>>): string {
  return LEDGER_SCRIPT_PROVIDERS.map((provider) => {
    const preference = preferences.find((entry) => entry.provider === provider);
    return preference ? `${provider}=${preference.packageVersion} (${preference.packageId})` : `${provider}=absent`;
  }).join(', ');
}

function removeDevnetSecrets(): Map<string, string> {
  const saved = new Map<string, string>();
  for (const name of DEVNET_SECRET_NAMES) {
    const value = process.env[name];
    if (value !== undefined) saved.set(name, value);
    delete process.env[name];
  }
  return saved;
}

function restoreDevnetSecrets(saved: Map<string, string>): void {
  for (const [name, value] of saved) process.env[name] = value;
}

function lockEntryWithoutNetworks(entry: DarsLock['packages'][string]): Omit<typeof entry, 'networks'> {
  return {
    sha256: entry.sha256,
    size: entry.size,
    sdkVersion: entry.sdkVersion,
    uploadedAt: entry.uploadedAt,
  };
}

async function validateBaseLockRetention(
  baseLock: DarsLock,
  candidateLock: DarsLock,
  candidateRoot: string,
  currentCandidateKeys: ReadonlySet<string>,
  getPreferences: (packageName: string) => Promise<DevnetPackagePreference[]>
): Promise<void> {
  let recordedRetained = 0;
  let removalsProvenSafe = 0;

  for (const [lockKey, baseEntry] of Object.entries(baseLock.packages)) {
    const parts = lockKey.split('/');
    if (parts.length !== 3 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid base DAR lock key: ${lockKey}`);
    }
    const [packageName, packageVersion] = parts;
    const candidateEntry = Object.prototype.hasOwnProperty.call(candidateLock.packages, lockKey)
      ? candidateLock.packages[lockKey]
      : undefined;

    if (baseEntry.networks.length > 0) {
      if (!candidateEntry) throw new Error(`Recorded DAR history cannot be removed: ${lockKey}`);
      if (
        JSON.stringify(lockEntryWithoutNetworks(candidateEntry)) !== JSON.stringify(lockEntryWithoutNetworks(baseEntry))
      ) {
        throw new Error(`Recorded DAR metadata must remain identical: ${lockKey}`);
      }
      const missingMarkers = baseEntry.networks.filter((network) => !candidateEntry.networks.includes(network));
      if (missingMarkers.length > 0) {
        throw new Error(`Recorded DAR ${lockKey} removed network marker(s): ${missingMarkers.join(', ')}`);
      }
      verifyLockedDar(candidateRoot, candidateLock, lockKey);
      recordedRetained++;
      continue;
    }

    if (candidateEntry) {
      const metadataMatches =
        JSON.stringify(lockEntryWithoutNetworks(candidateEntry)) ===
        JSON.stringify(lockEntryWithoutNetworks(baseEntry));
      if (!metadataMatches) {
        if (!currentCandidateKeys.has(lockKey)) {
          throw new Error(
            `Historical unrecorded DAR ${lockKey} cannot be replaced in place; remove it through the exact live-ID ` +
              'safety check and add the new current candidate separately.'
          );
        }
        // The active mutable candidate is integrity-checked and fully live-validated by the package pass below.
        continue;
      }
      verifyLockedDar(candidateRoot, candidateLock, lockKey);
      continue;
    }

    // The base/default-branch DAR is trusted input. Inspect its exact ID only after verifying the base lock hash.
    const baseDarPath = verifyLockedDar(ROOT_DIR, baseLock, lockKey);
    const basePackageId = inspectDarPackageId(baseDarPath, packageName, packageVersion);
    const preferences = await getPreferences(packageName);
    assertDevnetPreferencesConsistent(preferences);
    const exactLive = preferences.some(
      (preference) => preference.packageId === basePackageId && preference.packageVersion === packageVersion
    );
    if (exactLive) {
      throw new Error(`Cannot remove ${lockKey}: its exact package ID ${basePackageId} is preferred on DevNet.`);
    }
    removalsProvenSafe++;
    console.log(`🧹 ${lockKey}: removed undeployed backup proven absent from both DevNet providers`);
  }

  console.log(
    `🔒 Lock retention: ${recordedRetained} recorded backup(s) retained; ${removalsProvenSafe} undeployed removal(s) proven safe\n`
  );
}

async function main(): Promise<void> {
  const { allowMainnetMarkerAdditions, auditAll, baseRef, candidateRoot } = parseArgs();
  if (!fs.lstatSync(candidateRoot).isDirectory()) {
    throw new Error(`Candidate root is not a directory: ${candidateRoot}`);
  }

  const baseLockText = gitShow(baseRef, 'dars/dars.lock');
  if (!baseLockText) {
    throw new Error(`Unable to read dars/dars.lock from ${baseRef}. Fetch the base branch first.`);
  }
  const baseLock = JSON.parse(baseLockText) as DarsLock;
  const candidateLock = loadCandidateLock(candidateRoot);
  const packages = findCandidatePackages(candidateRoot);
  const currentCandidateKeys = new Set(
    packages.map(({ metadata }) => getDarLockKey(metadata.name, metadata.version, metadata.name))
  );
  const hasCandidateOnlyRecordedEntry = Object.entries(candidateLock.packages).some(
    ([lockKey, entry]) => !Object.prototype.hasOwnProperty.call(baseLock.packages, lockKey) && entry.networks.length > 0
  );
  const candidateOnly = classifyCandidateOnlyBackups(
    baseLock,
    candidateLock,
    currentCandidateKeys,
    hasCandidateOnlyRecordedEntry ? loadHistoricalLocks(baseRef) : []
  );
  const markerAdditions = getNetworkMarkerAdditions(baseLock, candidateLock, {
    allowMainnetMarkerAdditions,
    allowSameCandidateMainnet: true,
    currentCandidateKeys,
    restoredRecordedKeys: new Set(candidateOnly.restoredRecordedKeys),
  });
  const preferenceCache = new Map<string, Promise<DevnetPackagePreference[]>>();
  const getPreferences = async (packageName: string): Promise<DevnetPackagePreference[]> => {
    let pending = preferenceCache.get(packageName);
    if (!pending) {
      pending = queryDevnetPackagePreferences(packageName);
      preferenceCache.set(packageName, pending);
    }
    return pending;
  };
  let checked = 0;
  let failures = 0;

  console.log(
    `🔎 ${auditAll ? 'Auditing all DARs' : 'Checking changed DARs'} against live DevNet (candidate: ${candidateRoot})...\n`
  );

  for (const lockKey of candidateOnly.candidateOnlyKeys) {
    const [packageName, packageVersion] = lockKey.split('/');
    const darPath = verifyLockedDar(candidateRoot, candidateLock, lockKey);
    const savedSecrets = removeDevnetSecrets();
    let packageId: string;
    try {
      packageId = inspectDarPackageId(darPath, packageName, packageVersion);
    } finally {
      restoreDevnetSecrets(savedSecrets);
    }
    const classification = candidateOnly.restoredRecordedKeys.includes(lockKey)
      ? 'restored recorded history'
      : 'current mutable candidate';
    console.log(`✅ ${lockKey}: ${classification} verified (${packageId})`);
  }
  if (candidateOnly.candidateOnlyKeys.length > 0) console.log();

  await validateBaseLockRetention(baseLock, candidateLock, candidateRoot, currentCandidateKeys, getPreferences);

  for (const addition of markerAdditions) {
    if (addition.network === 'mainnet') {
      console.log(`✅ ${addition.lockKey}: mainnet marker has the required DevNet evidence`);
      continue;
    }
    const preferences = await getPreferences(addition.packageName);
    const darPath = verifyLockedDar(candidateRoot, candidateLock, addition.lockKey);
    const savedSecrets = removeDevnetSecrets();
    let packageId: string;
    try {
      packageId = inspectDarPackageId(darPath, addition.packageName, addition.packageVersion);
    } finally {
      restoreDevnetSecrets(savedSecrets);
    }
    assertDevnetMarkerIdentity(
      addition,
      { packageId, packageName: addition.packageName, packageVersion: addition.packageVersion },
      preferences,
      LEDGER_SCRIPT_PROVIDERS
    );
    console.log(`✅ ${addition.lockKey}: devnet marker matches every configured provider`);
  }
  if (markerAdditions.length > 0) console.log();

  for (const { sourceDir, metadata } of packages) {
    const candidateKey = getDarLockKey(metadata.name, metadata.version, metadata.name);
    const candidateEntry = Object.prototype.hasOwnProperty.call(candidateLock.packages, candidateKey)
      ? candidateLock.packages[candidateKey]
      : undefined;
    const baseMetadataText = gitShow(baseRef, `${sourceDir}/daml.yaml`);
    const baseMetadata = baseMetadataText ? (yaml.parse(baseMetadataText) as DamlMetadata) : null;
    let changed = true;
    if (baseMetadata) {
      const baseKey = getDarLockKey(baseMetadata.name, baseMetadata.version, baseMetadata.name);
      const baseEntry = Object.prototype.hasOwnProperty.call(baseLock.packages, baseKey)
        ? baseLock.packages[baseKey]
        : undefined;
      changed =
        baseMetadata.name !== metadata.name ||
        baseMetadata.version !== metadata.version ||
        JSON.stringify(baseEntry ? lockEntryWithoutNetworks(baseEntry) : null) !==
          JSON.stringify(candidateEntry ? lockEntryWithoutNetworks(candidateEntry) : null);
    }

    if (!auditAll && !changed) {
      console.log(`⏭️  ${metadata.name} ${metadata.version}: candidate bytes unchanged from ${baseRef}`);
      continue;
    }

    checked++;
    console.log(`📦 ${metadata.name} ${metadata.version}`);
    try {
      if (!candidateEntry) throw new Error(`Missing candidate dars.lock entry ${candidateKey}.`);
      const candidateDarPath = path.join(candidateRoot, 'dars', candidateKey);
      const preferences = await getPreferences(metadata.name);
      console.log(`   DevNet: ${formatLivePreferences(preferences)}`);
      // Do not expose credentials to dpm while it parses untrusted candidate DAR data.
      const savedSecrets = removeDevnetSecrets();
      let result: ReturnType<typeof validateDevnetDarCandidate>;
      try {
        result = validateDevnetDarCandidate({
          repositoryRoot: candidateRoot,
          lock: candidateLock,
          packageName: metadata.name,
          packageVersion: metadata.version,
          candidateDarPath,
          expectedCandidateSha256: candidateEntry.sha256,
          preferences,
        });
      } finally {
        restoreDevnetSecrets(savedSecrets);
      }
      console.log(`   Candidate package ID: ${result.candidatePackageId}`);
      console.log(
        `✅ Version ${result.expectedVersion}; checked ${result.compatibilityBaselines.length} unique live baseline(s)\n`
      );
    } catch (error) {
      failures++;
      console.error(`❌ ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  console.log(`📊 ${checked} candidate(s) checked, ${failures} failure(s)`);
  if (failures > 0) process.exit(1);
}

void main().catch((error: unknown) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
