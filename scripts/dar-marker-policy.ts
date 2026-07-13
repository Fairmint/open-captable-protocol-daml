import type { DarsLock, DarsLockEntry } from './dar-utils';
import type { DevnetPackagePreference } from './devnet-package-versions';

const ALLOWED_NETWORKS = new Set(['devnet', 'mainnet']);
const IMMUTABLE_RECORDED_FIELDS = ['sha256', 'size', 'sdkVersion', 'uploadedAt'] as const;
const MAX_DAR_BYTES = 100 * 1024 * 1024;
const MAX_LOCK_ENTRIES = 10_000;

export interface DarMarkerIdentity {
  packageId: string;
  packageName: string;
  packageVersion: string;
}

export interface NetworkMarkerAddition {
  darName: string;
  lockKey: string;
  network: 'devnet' | 'mainnet';
  packageName: string;
  packageVersion: string;
}

export interface NetworkMarkerPolicyOptions {
  allowMainnetMarkerAdditions?: boolean;
  allowSameCandidateMainnet?: boolean;
  currentCandidateKeys?: ReadonlySet<string>;
  restoredRecordedKeys?: ReadonlySet<string>;
}

export interface CandidateOnlyBackupClassification {
  candidateOnlyKeys: string[];
  currentCandidateKeys: string[];
  restoredRecordedKeys: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate every untrusted lock entry before any field is used for retention or path selection. */
export function assertDarsLockSchema(lock: unknown, label: string): asserts lock is DarsLock {
  if (!isRecord(lock) || !Number.isSafeInteger(lock.version) || lock.version !== 1 || !isRecord(lock.packages)) {
    throw new Error(`${label}: expected version 1 and a packages object`);
  }
  if (Object.keys(lock.packages).length > MAX_LOCK_ENTRIES) {
    throw new Error(`${label}: refusing more than ${MAX_LOCK_ENTRIES} DAR entries`);
  }

  for (const [lockKey, rawEntry] of Object.entries(lock.packages)) {
    parseLockKey(lockKey);
    if (!isRecord(rawEntry)) {
      throw new Error(`${label} ${lockKey}: entry must be an object`);
    }
    const { networks, sdkVersion, sha256, size, uploadedAt } = rawEntry as Partial<DarsLockEntry>;
    if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error(`${label} ${lockKey}: sha256 must be 64 lowercase hexadecimal characters`);
    }
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > MAX_DAR_BYTES) {
      throw new Error(`${label} ${lockKey}: size must be an integer between 0 and ${MAX_DAR_BYTES}`);
    }
    if (typeof sdkVersion !== 'string' || sdkVersion.length === 0 || sdkVersion.length > 100) {
      throw new Error(`${label} ${lockKey}: sdkVersion must be a non-empty string of at most 100 characters`);
    }
    if (typeof uploadedAt !== 'string' || !Number.isFinite(Date.parse(uploadedAt))) {
      throw new Error(`${label} ${lockKey}: uploadedAt must be a valid timestamp`);
    }
    if (!Array.isArray(networks) || !networks.every((network) => typeof network === 'string')) {
      throw new Error(`${label} ${lockKey}: networks must be an array of strings`);
    }
    const unknown = networks.filter((network) => !ALLOWED_NETWORKS.has(network));
    if (unknown.length > 0) {
      throw new Error(`${label} ${lockKey}: unknown network marker(s): ${[...new Set(unknown)].join(', ')}`);
    }
    const duplicates = networks.filter((network, index) => networks.indexOf(network) !== index);
    if (duplicates.length > 0) {
      throw new Error(`${label} ${lockKey}: duplicate network marker(s): ${[...new Set(duplicates)].join(', ')}`);
    }
  }
}

function parseLockKey(lockKey: string): Omit<NetworkMarkerAddition, 'lockKey' | 'network'> {
  const parts = lockKey.split('/');
  if (parts.length !== 3 || !parts[2]?.endsWith('.dar')) {
    throw new Error(`Invalid DAR lock key: ${lockKey}`);
  }
  const [packageName, packageVersion, darFile] = parts;
  const darName = darFile.slice(0, -'.dar'.length);
  const safeName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  if (!safeName.test(packageName) || !safeName.test(darName) || !/^\d+\.\d+\.\d+$/.test(packageVersion)) {
    throw new Error(`Unsafe DAR lock key: ${lockKey}`);
  }
  return { darName, packageName, packageVersion };
}

function recordedIdentityMatches(left: DarsLockEntry, right: DarsLockEntry): boolean {
  return (
    IMMUTABLE_RECORDED_FIELDS.every((field) => left[field] === right[field]) &&
    [...left.networks].sort().join('\0') === [...right.networks].sort().join('\0')
  );
}

/**
 * Classify entries newly introduced relative to the trusted base. An unrecorded entry may only be the canonical active
 * candidate for a discovered top-level package. A recorded alias is accepted only when trusted default-branch history
 * contains the same package line and exact immutable lock identity; restoring it is not a new marker addition.
 */
export function classifyCandidateOnlyBackups(
  base: DarsLock,
  candidate: DarsLock,
  currentCandidateKeys: ReadonlySet<string>,
  historicalLocks: DarsLock[]
): CandidateOnlyBackupClassification {
  assertDarsLockSchema(base, 'Trusted dars.lock');
  assertDarsLockSchema(candidate, 'Candidate dars.lock');
  historicalLocks.forEach((lock, index) => assertDarsLockSchema(lock, `Historical dars.lock ${index + 1}`));

  const candidateOnlyKeys: string[] = [];
  const activeKeys: string[] = [];
  const restoredKeys: string[] = [];
  for (const [lockKey, entry] of Object.entries(candidate.packages)) {
    if (Object.prototype.hasOwnProperty.call(base.packages, lockKey)) continue;
    candidateOnlyKeys.push(lockKey);
    if (entry.networks.length === 0) {
      if (!currentCandidateKeys.has(lockKey)) {
        throw new Error(
          `${lockKey}: candidate-only unrecorded DAR must be the canonical current candidate for its package line`
        );
      }
      activeKeys.push(lockKey);
      continue;
    }

    const coordinates = parseLockKey(lockKey);
    const hasHistoricalProof = historicalLocks.some((historicalLock) =>
      Object.entries(historicalLock.packages).some(([historicalKey, historicalEntry]) => {
        const historicalCoordinates = parseLockKey(historicalKey);
        return (
          historicalCoordinates.packageName === coordinates.packageName &&
          historicalCoordinates.packageVersion === coordinates.packageVersion &&
          recordedIdentityMatches(historicalEntry, entry)
        );
      })
    );
    if (!hasHistoricalProof) {
      throw new Error(
        `${lockKey}: candidate-only recorded DAR has no exact immutable identity in trusted default-branch history`
      );
    }
    restoredKeys.push(lockKey);
  }

  return {
    candidateOnlyKeys: candidateOnlyKeys.sort(),
    currentCandidateKeys: activeKeys.sort(),
    restoredRecordedKeys: restoredKeys.sort(),
  };
}

/**
 * Validate the only permitted lock-marker transitions. Recorded metadata and markers are immutable; a PR may add
 * `devnet` after a live exact-ID proof. `mainnet` normally requires that trusted marker; callers with a serialized
 * artifact-PR release flow may explicitly permit a same-candidate `devnet` addition proven by the same check.
 */
export function getNetworkMarkerAdditions(
  base: DarsLock,
  candidate: DarsLock,
  options: NetworkMarkerPolicyOptions = {}
): NetworkMarkerAddition[] {
  assertDarsLockSchema(base, 'Trusted dars.lock');
  assertDarsLockSchema(candidate, 'Candidate dars.lock');
  const currentCandidateKeys = options.currentCandidateKeys ?? new Set<string>();
  const restoredRecordedKeys = options.restoredRecordedKeys ?? new Set<string>();

  for (const [lockKey, baseEntry] of Object.entries(base.packages)) {
    const candidateEntry = Object.prototype.hasOwnProperty.call(candidate.packages, lockKey)
      ? candidate.packages[lockKey]
      : undefined;
    if (!candidateEntry) {
      if (baseEntry.networks.length > 0) {
        throw new Error(`${lockKey}: recorded DAR history cannot be removed`);
      }
      continue;
    }

    const removed = baseEntry.networks.filter((network) => !candidateEntry.networks.includes(network));
    if (removed.length > 0) {
      throw new Error(`${lockKey}: recorded network marker(s) removed: ${removed.join(', ')}`);
    }
    const changedFields = IMMUTABLE_RECORDED_FIELDS.filter((field) => candidateEntry[field] !== baseEntry[field]);
    if (changedFields.length > 0) {
      if (baseEntry.networks.length > 0) {
        for (const field of changedFields) {
          throw new Error(`${lockKey}: recorded DAR metadata ${field} cannot change`);
        }
      }
      if (!currentCandidateKeys.has(lockKey)) {
        throw new Error(
          `${lockKey}: historical unrecorded DAR metadata cannot be replaced in place; remove it through the live-ID ` +
            'safety check and add the new current candidate separately'
        );
      }
    }
  }

  const additions: NetworkMarkerAddition[] = [];
  for (const [lockKey, candidateEntry] of Object.entries(candidate.packages)) {
    if (restoredRecordedKeys.has(lockKey)) continue;
    const baseEntry = Object.prototype.hasOwnProperty.call(base.packages, lockKey) ? base.packages[lockKey] : undefined;
    const added = candidateEntry.networks.filter((network) => !baseEntry?.networks.includes(network));
    if (added.length === 0) continue;
    const coordinates = parseLockKey(lockKey);

    for (const network of added) {
      if (network !== 'devnet' && network !== 'mainnet') {
        throw new Error(`${lockKey}: unknown network marker: ${network}`);
      }
      if (network === 'mainnet' && !options.allowMainnetMarkerAdditions) {
        throw new Error(`${lockKey}: new mainnet marker requires explicit trusted workflow provenance`);
      }
      if (
        network === 'mainnet' &&
        !baseEntry?.networks.includes('devnet') &&
        (!options.allowSameCandidateMainnet || !candidateEntry.networks.includes('devnet'))
      ) {
        const sameCandidateEvidence = options.allowSameCandidateMainnet
          ? ' or a devnet marker proven in this candidate'
          : '';
        throw new Error(`${lockKey}: mainnet requires a trusted-base devnet marker${sameCandidateEvidence}`);
      }
      additions.push({ ...coordinates, lockKey, network });
    }
  }
  return additions.sort((left, right) => {
    if (left.network === right.network) return 0;
    return left.network === 'devnet' ? -1 : 1;
  });
}

/** Require one exact preferred identity from every configured DevNet provider before accepting a new marker. */
export function assertDevnetMarkerIdentity(
  addition: Pick<NetworkMarkerAddition, 'lockKey' | 'packageName' | 'packageVersion'>,
  identity: DarMarkerIdentity,
  preferences: DevnetPackagePreference[],
  expectedProviders: readonly string[]
): void {
  const expected = new Set(expectedProviders);
  const byProvider = new Map<string, DevnetPackagePreference>();
  for (const preference of preferences) {
    if (!expected.has(preference.provider)) {
      throw new Error(`${addition.lockKey}: unexpected DevNet provider response: ${preference.provider}`);
    }
    if (byProvider.has(preference.provider)) {
      throw new Error(`${addition.lockKey}: duplicate DevNet provider response: ${preference.provider}`);
    }
    byProvider.set(preference.provider, preference);
  }

  const mismatches = expectedProviders.filter((provider) => {
    const preference = byProvider.get(provider);
    if (!preference) return true;
    return (
      preference.packageName !== identity.packageName ||
      preference.packageVersion !== identity.packageVersion ||
      preference.packageId !== identity.packageId
    );
  });
  if (
    identity.packageName !== addition.packageName ||
    identity.packageVersion !== addition.packageVersion ||
    mismatches.length > 0
  ) {
    const state = expectedProviders
      .map((provider) => {
        const preference = byProvider.get(provider);
        return preference ? `${provider}=${preference.packageVersion}/${preference.packageId}` : `${provider}=absent`;
      })
      .join(', ');
    throw new Error(
      `${addition.lockKey}: devnet marker requires the exact locked DAR ${identity.packageVersion}/${identity.packageId} ` +
        `to be preferred by every configured DevNet provider; current state: ${state}`
    );
  }
}
