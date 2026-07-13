import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { computeSha256, getDarLockKey, getDarsDir, loadDarsLock, type DarsLock, type DarsLockEntry } from './dar-utils';
import { getPackage, parseNetworkArg, parsePackageArg, type PackageConfig } from './packages';
import type { ContractNetwork } from './types';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TAG = /^dar-deploy\/(devnet|mainnet)\/([^/]+)\/v(\d+\.\d+\.\d+)$/;

export interface DarArtifact {
  key: string;
  version: string;
  sha256: string;
  entry: DarsLockEntry;
}

export interface DeploymentTag {
  name: string;
  network: ContractNetwork;
  packageName: string;
  version: string;
  sha256: string;
  entry: DarsLockEntry;
}

export interface CandidatePlan {
  replace: boolean;
}

function semverParts(version: string): [number, number, number] {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`Invalid semantic version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(a: string, b: string): number {
  const left = semverParts(a);
  const right = semverParts(b);
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function nextPatch(version: string): string {
  const [major, minor, patch] = semverParts(version);
  return `${major}.${minor}.${patch + 1}`;
}

export function deploymentTagName(network: ContractNetwork, packageName: string, version: string): string {
  semverParts(version);
  return `dar-deploy/${network}/${packageName}/v${version}`;
}

export function parseDeploymentTagName(name: string): Omit<DeploymentTag, 'sha256' | 'entry'> | null {
  const match = TAG.exec(name);
  if (!match) return null;
  return {
    name,
    network: match[1] as ContractNetwork,
    packageName: match[2],
    version: match[3],
  };
}

export function packageArtifacts(lock: DarsLock, packageName: string): DarArtifact[] {
  const prefix = `${packageName}/`;
  return Object.entries(lock.packages)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, entry]) => {
      const parts = key.split('/');
      if (parts.length !== 3) throw new Error(`Invalid DAR lock key: ${key}`);
      semverParts(parts[1]);
      return { key, version: parts[1], sha256: entry.sha256, entry };
    });
}

export function getLockEntry(lock: DarsLock, key: string): DarsLockEntry | undefined {
  return Object.prototype.hasOwnProperty.call(lock.packages, key) ? lock.packages[key] : undefined;
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function readDeploymentTags(pkg: PackageConfig, cwd = path.join(__dirname, '..')): DeploymentTag[] {
  const names = git(['tag', '--list', `dar-deploy/*/${pkg.name}/v*`], cwd)
    .split('\n')
    .filter(Boolean);

  return names.map((name) => {
    const parsed = parseDeploymentTagName(name);
    if (parsed?.packageName !== pkg.name) throw new Error(`Invalid DAR deployment tag: ${name}`);
    if (git(['cat-file', '-t', `refs/tags/${name}`], cwd) !== 'tag') {
      throw new Error(`DAR deployment tag must be annotated: ${name}`);
    }

    const taggedLock = JSON.parse(git(['show', `${name}:dars/dars.lock`], cwd)) as DarsLock;
    const key = getDarLockKey(pkg.name, parsed.version, pkg.darName);
    const entry = getLockEntry(taggedLock, key);
    if (!entry) throw new Error(`${name} does not record ${key} in dars/dars.lock`);
    return { ...parsed, sha256: entry.sha256, entry };
  });
}

function highest<T extends { version: string }>(values: T[]): T | null {
  return values.reduce<T | null>(
    (best, value) => (!best || compareSemver(value.version, best.version) > 0 ? value : best),
    null
  );
}

export function selectCandidateAnchor(
  pkg: PackageConfig,
  lock: DarsLock,
  tags: DeploymentTag[]
): { version: string; sha256: string; source: 'devnet-tag' | 'legacy-marker' } | null {
  const devnet = highest(tags.filter((tag) => tag.network === 'devnet' && tag.packageName === pkg.name));
  if (devnet) return { version: devnet.version, sha256: devnet.sha256, source: 'devnet-tag' };

  const marked = packageArtifacts(lock, pkg.name).filter((artifact) => artifact.entry.networks.length > 0);
  const latest = highest(marked);
  if (!latest) return null;
  const hashes = new Set(
    marked.filter((artifact) => artifact.version === latest.version).map((artifact) => artifact.sha256)
  );
  if (hashes.size !== 1) throw new Error(`${pkg.name} v${latest.version} has ambiguous legacy deployment hashes`);
  return { version: latest.version, sha256: latest.sha256, source: 'legacy-marker' };
}

function isDeployed(artifact: DarArtifact, pkg: PackageConfig, tags: DeploymentTag[]): boolean {
  if (artifact.entry.networks.length > 0) return true;
  const canonical = getDarLockKey(pkg.name, artifact.version, pkg.darName);
  return (
    artifact.key === canonical && tags.some((tag) => tag.version === artifact.version && tag.sha256 === artifact.sha256)
  );
}

function sameEntry(left: DarsLockEntry | undefined, right: DarsLockEntry): boolean {
  if (!left) return false;
  return (
    left.sha256 === right.sha256 &&
    left.size === right.size &&
    left.sdkVersion === right.sdkVersion &&
    left.uploadedAt === right.uploadedAt &&
    left.networks.length === right.networks.length &&
    left.networks.every((network, index) => network === right.networks[index])
  );
}

function assertLatestDevnetPresent(pkg: PackageConfig, lock: DarsLock, tags: DeploymentTag[]): void {
  const tag = highest(tags.filter((item) => item.network === 'devnet' && item.packageName === pkg.name));
  if (!tag) return;
  const key = getDarLockKey(pkg.name, tag.version, pkg.darName);
  if (!sameEntry(getLockEntry(lock, key), tag.entry)) {
    throw new Error(`${tag.name} records an immutable lock entry, but current ${key} differs`);
  }
}

export function assertHistoryRetention(
  pkg: PackageConfig,
  base: DarsLock,
  current: DarsLock,
  tags: DeploymentTag[]
): void {
  const anchor = selectCandidateAnchor(pkg, current, tags);
  const candidateVersion = anchor ? nextPatch(anchor.version) : '0.0.1';
  const mutableKey = pkg.version === candidateVersion ? getDarLockKey(pkg.name, pkg.version, pkg.darName) : null;
  const keys = new Set(
    [...packageArtifacts(base, pkg.name), ...packageArtifacts(current, pkg.name)].map((item) => item.key)
  );
  for (const key of keys) {
    const baseEntry = getLockEntry(base, key);
    const currentEntry = getLockEntry(current, key);
    const mutableCandidate = key === mutableKey && !baseEntry?.networks.length && !currentEntry?.networks.length;
    if (mutableCandidate) continue;
    if (!baseEntry || !sameEntry(currentEntry, baseEntry))
      throw new Error(`Historical DAR lock entry must be retained: ${key}`);
  }
}

export function assertPackagePolicy(
  pkg: PackageConfig,
  lock: DarsLock,
  tags: DeploymentTag[],
  currentHash: string
): void {
  assertLatestDevnetPresent(pkg, lock, tags);
  const anchor = selectCandidateAnchor(pkg, lock, tags);
  const expected = anchor ? nextPatch(anchor.version) : '0.0.1';
  const unchangedDeployment = anchor !== null && pkg.version === anchor.version && currentHash === anchor.sha256;
  if (!unchangedDeployment && pkg.version !== expected) {
    throw new Error(
      `${pkg.name} must remain byte-identical at deployed ${anchor ? `v${anchor.version}` : 'version none'} or use candidate v${expected}; found v${pkg.version}`
    );
  }
  if (anchor?.version === pkg.version && currentHash !== anchor.sha256) {
    throw new Error(`${pkg.name} v${pkg.version} is deployed and its bytes are immutable`);
  }

  const currentKey = getDarLockKey(pkg.name, pkg.version, pkg.darName);
  if (getLockEntry(lock, currentKey)?.sha256 !== currentHash)
    throw new Error(`Current candidate is not locked: ${currentKey}`);
}

export function planCandidateBackup(
  pkg: PackageConfig,
  lock: DarsLock,
  tags: DeploymentTag[],
  sha256: string,
  size: number
): CandidatePlan {
  assertLatestDevnetPresent(pkg, lock, tags);
  const anchor = selectCandidateAnchor(pkg, lock, tags);
  const expected = anchor ? nextPatch(anchor.version) : '0.0.1';
  if (anchor?.version === pkg.version) {
    if (sha256 !== anchor.sha256) throw new Error(`${pkg.name} v${pkg.version} is deployed and cannot be replaced`);
  } else if (pkg.version !== expected) {
    throw new Error(`${pkg.name} candidate must be v${expected}; found v${pkg.version}`);
  }

  const targetKey = getDarLockKey(pkg.name, pkg.version, pkg.darName);
  const target = packageArtifacts(lock, pkg.name).find((artifact) => artifact.key === targetKey);
  for (const tag of tags.filter((item) => item.version === pkg.version)) {
    if (tag.sha256 !== sha256 || !sameEntry(getLockEntry(lock, targetKey), tag.entry)) {
      throw new Error(`Deployed DAR is immutable: ${targetKey}`);
    }
  }
  if (target && isDeployed(target, pkg, tags) && target.sha256 !== sha256) {
    throw new Error(`Deployed DAR is immutable: ${targetKey}`);
  }
  return {
    replace: !target || (!isDeployed(target, pkg, tags) && (target.sha256 !== sha256 || target.entry.size !== size)),
  };
}

export function assertDeploymentUpload(
  network: ContractNetwork,
  pkg: PackageConfig,
  sha256: string,
  tags: DeploymentTag[]
): { tagExists: boolean } {
  const exact = tags.find((tag) => tag.network === network && tag.version === pkg.version);
  if (exact && exact.sha256 !== sha256) {
    throw new Error(`${exact.name} records ${exact.sha256}, not current hash ${sha256}`);
  }

  if (network === 'devnet') {
    const newer = tags.find((tag) => tag.network === 'devnet' && compareSemver(tag.version, pkg.version) > 0);
    if (newer) throw new Error(`Newer DevNet deployment already exists: ${newer.name}`);
    if (exact) return { tagExists: true };
    return { tagExists: false };
  }

  const devnet = tags.find((tag) => tag.network === 'devnet' && tag.version === pkg.version);
  if (!devnet) throw new Error(`Mainnet requires ${deploymentTagName('devnet', pkg.name, pkg.version)}`);
  if (devnet.sha256 !== sha256) throw new Error(`${devnet.name} records ${devnet.sha256}, not current hash ${sha256}`);
  const newer = tags.find((tag) => tag.network === 'mainnet' && compareSemver(tag.version, pkg.version) > 0);
  if (newer) throw new Error(`Newer Mainnet deployment already exists: ${newer.name}`);
  if (exact) return { tagExists: true };
  return { tagExists: false };
}

function main(): void {
  const pkg = getPackage(parsePackageArg() ?? '');
  const network = parseNetworkArg();
  if (!pkg || !network)
    throw new Error('Usage: tsx scripts/dar-version-policy.ts --package <key> --network <devnet|mainnet>');
  const lock = loadDarsLock();
  const key = getDarLockKey(pkg.name, pkg.version, pkg.darName);
  const entry = getLockEntry(lock, key);
  const darPath = path.join(getDarsDir(), key);
  if (!entry || !fs.existsSync(darPath) || computeSha256(darPath) !== entry.sha256) {
    throw new Error(`Current locked DAR is missing or invalid: ${key}`);
  }
  const result = assertDeploymentUpload(network, pkg, entry.sha256, readDeploymentTags(pkg));
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag_exists=${String(result.tagExists)}\n`);
  console.log(
    `✅ ${network} deployment gate passed for ${pkg.name} v${pkg.version} (${entry.sha256}); tag_exists=${result.tagExists}`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
