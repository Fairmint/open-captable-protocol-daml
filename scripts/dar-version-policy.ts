import type { DarsLockEntry } from './dar-utils';
import { LEDGER_SCRIPT_PROVIDERS } from './providers';

export interface PackagePreferenceLike {
  packageId: string;
  packageVersion: string;
}

export interface DevnetCandidateDecision {
  expectedVersion: string;
  highestDevnetVersion: string | null;
  reason: 'first-devnet-candidate' | 'matches-devnet' | 'advance-after-devnet';
}

export type BackupMutation = 'create' | 'no-op' | 'replace';

export interface InspectedBackupLike {
  lockKey: string;
  packageId: string;
  packageVersion: string;
  entry: DarsLockEntry;
}

export interface BackupRetentionPlan {
  freezeKeys: string[];
  pruneKeys: string[];
}

export interface MajorPackageLineTarget {
  candidateVersion: string;
  majorVersion: string;
  packageName: string;
}

function parseSemver(version: string): [number, number, number] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Compare strict x.y.z semantic versions. */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

/** Increment only the patch component used for compatible DAML releases. */
export function incrementPatch(version: string): string {
  const [major, minor, patch] = parseSemver(version);
  return `${major}.${minor}.${patch + 1}`;
}

/** Any recorded network upload makes that exact DAR immutable. */
export function isDeployed(entry: DarsLockEntry | undefined): boolean {
  return Boolean(entry && entry.networks.length > 0);
}

/** Decide whether candidate bytes may change before the live policy preflight runs. */
export function decideBackupMutation(entry: DarsLockEntry | undefined, sourceHash: string): BackupMutation {
  if (!entry) return 'create';
  if (entry.sha256 === sourceHash) return 'no-op';
  if (isDeployed(entry)) {
    throw new Error('A network-recorded DAR backup is immutable.');
  }
  return 'replace';
}

export function maxVersion(versions: string[]): string | null {
  return versions.reduce<string | null>(
    (latest, version) => (!latest || compareSemver(version, latest) > 0 ? version : latest),
    null
  );
}

/** The only version for a new DAR which is not already the exact preferred DevNet package. */
export function nextDevnetCandidateVersion(preferences: PackagePreferenceLike[]): string {
  const highest = maxVersion(preferences.map((preference) => preference.packageVersion));
  return highest ? incrementPatch(highest) : '0.0.1';
}

/** Select a new major package line from that target line's own live DevNet state. */
export async function resolveMajorPackageLineTarget(
  baseName: string,
  currentMajorVersion: number,
  queryPreferences: (packageName: string) => PackagePreferenceLike[] | Promise<PackagePreferenceLike[]>
): Promise<MajorPackageLineTarget> {
  const majorVersion = `v${(currentMajorVersion + 1).toString().padStart(2, '0')}`;
  const packageName = `${baseName}-${majorVersion}`;
  const preferences = await queryPreferences(packageName);
  assertDevnetPreferencesConsistent(preferences);
  return {
    candidateVersion: nextDevnetCandidateVersion(preferences),
    majorVersion,
    packageName,
  };
}

/**
 * Decide the version for candidate bytes from the two live DevNet preferences.
 *
 * A candidate may retain the live version only when every configured provider returns a preference that resolves to its
 * exact package ID and those preferences agree on one version. A partial provider result is not an exact-live
 * candidate: it advances one patch beyond the highest result that was returned. Any different candidate, including a
 * provider-version divergence, must use exactly one patch after the highest live DevNet version.
 */
export function decideDevnetCandidateVersion(
  preferences: PackagePreferenceLike[],
  candidatePackageId: string
): DevnetCandidateDecision {
  if (preferences.length === 0) {
    return {
      expectedVersion: '0.0.1',
      highestDevnetVersion: null,
      reason: 'first-devnet-candidate',
    };
  }

  const highestDevnetVersion = maxVersion(preferences.map((preference) => preference.packageVersion));
  if (!highestDevnetVersion) {
    throw new Error('Unable to determine the highest DevNet package version.');
  }

  const liveVersions = new Set(preferences.map((preference) => preference.packageVersion));
  const hasEveryProviderPreference = preferences.length === LEDGER_SCRIPT_PROVIDERS.length;
  const matchesEveryPreference = preferences.every((preference) => preference.packageId === candidatePackageId);
  if (hasEveryProviderPreference && liveVersions.size === 1 && matchesEveryPreference) {
    return {
      expectedVersion: highestDevnetVersion,
      highestDevnetVersion,
      reason: 'matches-devnet',
    };
  }

  return {
    expectedVersion: incrementPatch(highestDevnetVersion),
    highestDevnetVersion,
    reason: 'advance-after-devnet',
  };
}

/** Reject impossible live states before using them as version or compatibility authority. */
export function assertDevnetPreferencesConsistent(preferences: PackagePreferenceLike[]): void {
  const packageIdsByVersion = new Map<string, Set<string>>();
  const versionsByPackageId = new Map<string, Set<string>>();

  for (const preference of preferences) {
    const ids = packageIdsByVersion.get(preference.packageVersion) ?? new Set<string>();
    ids.add(preference.packageId);
    packageIdsByVersion.set(preference.packageVersion, ids);

    const versions = versionsByPackageId.get(preference.packageId) ?? new Set<string>();
    versions.add(preference.packageVersion);
    versionsByPackageId.set(preference.packageId, versions);
  }

  for (const [version, packageIds] of packageIdsByVersion) {
    if (packageIds.size > 1) {
      throw new Error(
        `DevNet providers resolve version ${version} to different package IDs: ${[...packageIds].join(', ')}`
      );
    }
  }
  for (const [packageId, versions] of versionsByPackageId) {
    if (versions.size > 1) {
      throw new Error(
        `DevNet providers report package ID ${packageId} with different versions: ${[...versions].join(', ')}`
      );
    }
  }
}

/** One compatibility baseline per distinct live package ID/version, even when both providers agree. */
export function uniqueDevnetBaselines<T extends PackagePreferenceLike>(preferences: T[]): T[] {
  return [
    ...new Map(
      preferences.map((preference) => [`${preference.packageVersion}:${preference.packageId}`, preference])
    ).values(),
  ];
}

/** Network markers for candidate bytes that are already an exact preferred DevNet package. */
export function candidateDevnetNetworks(
  preferences: PackagePreferenceLike[],
  packageVersion: string,
  packageId: string
): string[] {
  return preferences.length === LEDGER_SCRIPT_PROVIDERS.length &&
    preferences.every(
      (preference) => preference.packageVersion === packageVersion && preference.packageId === packageId
    )
    ? ['devnet']
    : [];
}

/** A Mainnet promotion is permitted only after this exact lock entry records its DevNet deployment. */
export function assertDevnetMarkerForMainnet(entry: DarsLockEntry | undefined, lockKey: string): void {
  if (!entry?.networks.includes('devnet')) {
    throw new Error(`Mainnet upload requires a committed devnet marker for ${lockKey}.`);
  }
}

/**
 * Plan retention only after callers have integrity-checked and inspected every same-package backup. The current
 * candidate, every recorded backup, and every exact live DevNet package are always retained.
 */
export function planBackupRetention(
  backups: InspectedBackupLike[],
  currentLockKey: string,
  preferences: PackagePreferenceLike[]
): BackupRetentionPlan {
  assertDevnetPreferencesConsistent(preferences);
  const livePairs = new Set(preferences.map((preference) => `${preference.packageVersion}:${preference.packageId}`));
  const freezeKeys: string[] = [];
  const pruneKeys: string[] = [];

  for (const backup of backups) {
    const isExactLive = livePairs.has(`${backup.packageVersion}:${backup.packageId}`);
    const isExactOnEveryProvider =
      candidateDevnetNetworks(preferences, backup.packageVersion, backup.packageId).length > 0;
    if (isExactOnEveryProvider && !backup.entry.networks.includes('devnet')) {
      freezeKeys.push(backup.lockKey);
    }
    if (backup.lockKey !== currentLockKey && !isDeployed(backup.entry) && !isExactLive) {
      pruneKeys.push(backup.lockKey);
    }
  }

  return { freezeKeys: freezeKeys.sort(), pruneKeys: pruneKeys.sort() };
}
