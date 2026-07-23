import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { computeSha256, getDarLockKey, getDarsDir, loadDarsLock, type DarsLock, type DarsLockEntry } from './dar-utils';
import { parseNetworkArg, requirePackageConfig } from './packages';
import type { ContractNetwork } from './types';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PKG = requirePackageConfig('ocp');

export interface DeploymentTag {
  name: string;
  version: string;
  sha256: string;
  entry: DarsLockEntry;
}

export interface DeploymentState {
  latestDevnet: DeploymentTag | null;
  currentDevnet: DeploymentTag | null;
  currentMainnet: DeploymentTag | null;
}

function semverParts(version: string): [number, number, number] {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`Invalid semantic version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function nextPatch(version: string): string {
  const [major, minor, patch] = semverParts(version);
  return `${major}.${minor}.${patch + 1}`;
}

export function deploymentTagName(network: ContractNetwork, version: string): string {
  semverParts(version);
  return `dar-deploy/${network}/${PKG.name}/v${version}`;
}

export function getLockEntry(lock: DarsLock, key: string): DarsLockEntry | undefined {
  return Object.prototype.hasOwnProperty.call(lock.packages, key) ? lock.packages[key] : undefined;
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

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function readTag(name: string, network: ContractNetwork, cwd: string): DeploymentTag | null {
  try {
    git(['show-ref', '--verify', '--quiet', `refs/tags/${name}`], cwd);
  } catch (error) {
    if ((error as { status?: number }).status === 1) return null;
    throw error;
  }
  const prefix = `dar-deploy/${network}/${PKG.name}/v`;
  if (!name.startsWith(prefix)) throw new Error(`Invalid DAR deployment tag: ${name}`);
  if (git(['cat-file', '-t', `refs/tags/${name}`], cwd) !== 'tag') {
    throw new Error(`DAR deployment tag must be annotated: ${name}`);
  }
  const version = name.slice(prefix.length);
  semverParts(version);

  const taggedLock = JSON.parse(git(['show', `${name}:dars/dars.lock`], cwd)) as DarsLock;
  const key = getDarLockKey(PKG.name, version, PKG.darName);
  const entry = getLockEntry(taggedLock, key);
  if (!entry) throw new Error(`${name} does not record ${key} in dars/dars.lock`);
  return { name, version, sha256: entry.sha256, entry };
}

/** Read only the latest DevNet tag and the two exact tags relevant to the current version. */
export function readDeploymentState(cwd = path.join(__dirname, '..')): DeploymentState {
  const latestName = git(
    [
      'for-each-ref',
      '--sort=-version:refname',
      '--count=1',
      '--format=%(refname:short)',
      `refs/tags/dar-deploy/devnet/${PKG.name}/v*`,
    ],
    cwd
  );
  const currentDevnetName = deploymentTagName('devnet', PKG.version);
  const currentMainnetName = deploymentTagName('mainnet', PKG.version);
  const latestDevnet = latestName ? readTag(latestName, 'devnet', cwd) : null;

  return {
    latestDevnet,
    currentDevnet: latestName === currentDevnetName ? latestDevnet : readTag(currentDevnetName, 'devnet', cwd),
    currentMainnet: readTag(currentMainnetName, 'mainnet', cwd),
  };
}

export function expectedCandidateVersion(state: DeploymentState): string {
  return state.latestDevnet ? nextPatch(state.latestDevnet.version) : '0.0.1';
}

function assertLatestDevnetEntry(lock: DarsLock, state: DeploymentState): void {
  const tag = state.latestDevnet;
  if (!tag) return;
  const key = getDarLockKey(PKG.name, tag.version, PKG.darName);
  if (!sameEntry(getLockEntry(lock, key), tag.entry)) {
    throw new Error(`${tag.name} records an immutable lock entry, but current ${key} differs`);
  }
}

function resolveCandidate(state: DeploymentState, sha256: string, version: string): void {
  const anchor = state.latestDevnet;
  const expected = expectedCandidateVersion(state);
  if (anchor?.version === version) {
    if (sha256 !== anchor.sha256) throw new Error(`${PKG.name} v${version} is deployed and its bytes are immutable`);
    return;
  }
  if (version !== expected) {
    throw new Error(
      `${PKG.name} must remain byte-identical at ${anchor ? `deployed v${anchor.version}` : 'its initial version'} or use candidate v${expected}; found v${version}`
    );
  }
}

export function assertPackagePolicy(
  lock: DarsLock,
  state: DeploymentState,
  currentHash: string,
  version = PKG.version
): void {
  assertLatestDevnetEntry(lock, state);
  resolveCandidate(state, currentHash, version);
  const currentKey = getDarLockKey(PKG.name, version, PKG.darName);
  if (getLockEntry(lock, currentKey)?.sha256 !== currentHash) {
    throw new Error(`Current candidate is not locked: ${currentKey}`);
  }
}

export function assertHistoryRetention(
  base: DarsLock,
  current: DarsLock,
  state: DeploymentState,
  version = PKG.version
): void {
  const mutableKey = version === expectedCandidateVersion(state) ? getDarLockKey(PKG.name, version, PKG.darName) : null;
  const prefix = `${PKG.name}/`;
  const keys = new Set(
    [...Object.keys(base.packages), ...Object.keys(current.packages)].filter((key) => key.startsWith(prefix))
  );

  for (const key of keys) {
    const baseEntry = getLockEntry(base, key);
    const currentEntry = getLockEntry(current, key);
    const mutableCandidate =
      key === mutableKey && currentEntry?.networks.length === 0 && (baseEntry?.networks.length ?? 0) === 0;
    if (!mutableCandidate && (!baseEntry || !sameEntry(currentEntry, baseEntry))) {
      throw new Error(`Historical DAR lock entry must be retained: ${key}`);
    }
  }
}

export function planCandidateBackup(
  lock: DarsLock,
  state: DeploymentState,
  sha256: string,
  size: number,
  version = PKG.version
): { replace: boolean } {
  assertLatestDevnetEntry(lock, state);
  resolveCandidate(state, sha256, version);

  const key = getDarLockKey(PKG.name, version, PKG.darName);
  const target = getLockEntry(lock, key);
  const tags = [state.currentDevnet, state.currentMainnet].filter((tag): tag is DeploymentTag => tag !== null);
  const immutable = tags.length > 0 || Boolean(target?.networks.length);
  if (immutable) {
    if (!target) throw new Error(`Deployed DAR is missing from dars.lock: ${key}`);
    if (target.sha256 !== sha256 || target.size !== size || tags.some((tag) => tag.sha256 !== sha256)) {
      throw new Error(`Deployed DAR is immutable: ${key}`);
    }
    return { replace: false };
  }

  if (!target) return { replace: true };
  return { replace: target.sha256 !== sha256 || target.size !== size };
}

export function assertDeploymentUpload(
  network: ContractNetwork,
  sha256: string,
  state: DeploymentState,
  version = PKG.version
): { tagExists: boolean } {
  resolveCandidate(state, sha256, version);
  const exact = network === 'devnet' ? state.currentDevnet : state.currentMainnet;
  if (exact && exact.sha256 !== sha256) {
    throw new Error(`${exact.name} records ${exact.sha256}, not current hash ${sha256}`);
  }
  if (network === 'mainnet') {
    const devnet = state.currentDevnet;
    if (!devnet) throw new Error(`Mainnet requires ${deploymentTagName('devnet', version)}`);
    if (devnet.sha256 !== sha256) {
      throw new Error(`${devnet.name} records ${devnet.sha256}, not current hash ${sha256}`);
    }
  }
  return { tagExists: exact !== null };
}

function main(): void {
  const network = parseNetworkArg();
  if (!network) throw new Error('Usage: tsx scripts/dar-version-policy.ts --network <devnet|mainnet>');
  const lock = loadDarsLock();
  const key = getDarLockKey(PKG.name, PKG.version, PKG.darName);
  const entry = getLockEntry(lock, key);
  const darPath = path.join(getDarsDir(), key);
  if (
    !entry ||
    !fs.existsSync(darPath) ||
    fs.statSync(darPath).size !== entry.size ||
    computeSha256(darPath) !== entry.sha256
  ) {
    throw new Error(`Current locked DAR is missing or invalid: ${key}`);
  }
  const result = assertDeploymentUpload(network, entry.sha256, readDeploymentState());
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag_exists=${String(result.tagExists)}\n`);
  }
  console.log(
    `✅ ${network} deployment gate passed for ${PKG.name} v${PKG.version} (${entry.sha256}); tag_exists=${result.tagExists}`
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
