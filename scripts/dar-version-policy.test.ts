import assert from 'node:assert/strict';
import test from 'node:test';

import { getDarLockKey, type DarsLock, type DarsLockEntry } from './dar-utils';
import {
  assertDeploymentUpload,
  assertHistoryRetention,
  assertPackagePolicy,
  deploymentTagName,
  nextPatch,
  parseDeploymentTagName,
  planCandidateBackup,
  selectCandidateAnchor,
  type DeploymentTag,
} from './dar-version-policy';
import type { PackageConfig } from './packages';
import type { ContractNetwork } from './types';

const NAME = 'OpenCapTable-v34';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function pkg(version: string): PackageConfig {
  return { name: NAME, darName: NAME, sourceDir: NAME, version };
}

function entry(sha256: string, networks: string[] = []): DarsLockEntry {
  return { sha256, size: 10, sdkVersion: '3.4.10', uploadedAt: '2026-01-01T00:00:00.000Z', networks };
}

function lock(...items: Array<[version: string, sha256: string, networks?: string[], file?: string]>): DarsLock {
  return {
    version: 1,
    packages: Object.fromEntries(
      items.map(([version, sha256, networks = [], file = `${NAME}.dar`]) => [
        `${NAME}/${version}/${file}`,
        entry(sha256, networks),
      ])
    ),
  };
}

function tag(network: ContractNetwork, version: string, sha256: string): DeploymentTag {
  return {
    name: deploymentTagName(network, NAME, version),
    network,
    packageName: NAME,
    version,
    sha256,
    entry: entry(sha256),
  };
}

void test('only deployment tags are evidence and patch increments do not roll minor', () => {
  assert.equal(parseDeploymentTagName('OpenCapTable-v34-v1.2.3'), null);
  assert.deepEqual(parseDeploymentTagName('dar-deploy/devnet/OpenCapTable-v34/v1.2.3'), {
    name: 'dar-deploy/devnet/OpenCapTable-v34/v1.2.3',
    network: 'devnet',
    packageName: NAME,
    version: '1.2.3',
  });
  assert.equal(nextPatch('1.2.9'), '1.2.10');
});

void test('an absent package starts at 0.0.1 with one candidate', () => {
  assert.doesNotThrow(() => assertPackagePolicy(pkg('0.0.1'), lock(['0.0.1', HASH_A]), [], HASH_A));
  assert.throws(() => assertPackagePolicy(pkg('0.0.2'), lock(['0.0.2', HASH_A]), [], HASH_A), /candidate v0\.0\.1/);
});

void test('legacy fallback uses the highest nonempty marker and rejects ambiguous hashes', () => {
  const history = lock(['0.0.1', HASH_A, ['devnet']], ['0.0.2', HASH_B], ['0.0.3', HASH_C, ['mainnet']]);
  assert.deepEqual(selectCandidateAnchor(pkg('0.0.4'), history, []), {
    version: '0.0.3',
    sha256: HASH_C,
    source: 'legacy-marker',
  });
  assert.throws(
    () =>
      selectCandidateAnchor(
        pkg('0.0.2'),
        lock(['0.0.1', HASH_A, ['devnet']], ['0.0.1', HASH_B, ['mainnet'], 'alias.dar']),
        []
      ),
    /ambiguous legacy deployment hashes/
  );
});

void test('the highest DevNet tag replaces legacy markers as the anchor', () => {
  const history = lock(['0.0.1', HASH_A], ['0.0.9', HASH_C, ['mainnet']]);
  assert.deepEqual(selectCandidateAnchor(pkg('0.0.2'), history, [tag('devnet', '0.0.1', HASH_A)]), {
    version: '0.0.1',
    sha256: HASH_A,
    source: 'devnet-tag',
  });
});

void test('only the latest DevNet predecessor must remain in the branch', () => {
  const tags = [tag('devnet', '0.0.1', HASH_A), tag('devnet', '0.0.2', HASH_B)];
  assert.doesNotThrow(() =>
    assertPackagePolicy(pkg('0.0.3'), lock(['0.0.2', HASH_B], ['0.0.3', HASH_C]), tags, HASH_C)
  );
});

void test('a deployed version is allowed only with its exact tagged bytes', () => {
  const tags = [tag('devnet', '0.0.1', HASH_A)];
  assert.doesNotThrow(() => assertPackagePolicy(pkg('0.0.1'), lock(['0.0.1', HASH_A]), tags, HASH_A));
  assert.throws(() => assertPackagePolicy(pkg('0.0.1'), lock(['0.0.1', HASH_B]), tags, HASH_B), /immutable lock entry/);
  assert.throws(
    () => assertPackagePolicy(pkg('0.0.1'), lock(['0.0.1', HASH_A, ['devnet']]), tags, HASH_A),
    /immutable lock entry/
  );
});

void test('candidate is exactly one patch above the anchor while uncertain historical rows are retained', () => {
  const valid = lock(['0.0.1', HASH_A, ['devnet']], ['0.0.2', HASH_B]);
  assert.doesNotThrow(() => assertPackagePolicy(pkg('0.0.2'), valid, [], HASH_B));
  assert.throws(
    () => assertPackagePolicy(pkg('0.0.3'), lock(['0.0.1', HASH_A, ['devnet']], ['0.0.3', HASH_C]), [], HASH_C),
    /candidate v0\.0\.2/
  );
  assert.doesNotThrow(() =>
    assertPackagePolicy(
      pkg('0.0.2'),
      lock(['0.0.1', HASH_A, ['devnet']], ['0.0.2', HASH_B], ['0.0.3', HASH_C]),
      [],
      HASH_B
    )
  );
});

void test('backup replaces only the expected candidate and preserves all historical rows', () => {
  const history = lock(['0.0.1', HASH_A], ['0.0.2', HASH_B], ['0.0.3', HASH_C], ['0.0.4', HASH_A, ['mainnet']]);
  assert.deepEqual(planCandidateBackup(pkg('0.0.2'), history, [tag('devnet', '0.0.1', HASH_A)], HASH_C, 11), {
    replace: true,
  });
  assert.throws(
    () => planCandidateBackup(pkg('0.0.1'), history, [tag('devnet', '0.0.1', HASH_A)], HASH_B, 10),
    /cannot be replaced/
  );
});

void test('only the canonical current candidate row may change relative to the base tree', () => {
  assert.doesNotThrow(() => {
    const base = lock(['0.0.1', HASH_A, ['devnet']], ['0.0.2', HASH_B], ['0.0.3', HASH_C]);
    const current = lock(['0.0.1', HASH_A, ['devnet']], ['0.0.2', HASH_C], ['0.0.3', HASH_C]);
    assertHistoryRetention(pkg('0.0.2'), base, current, []);
  });
  assert.throws(
    () => assertHistoryRetention(pkg('0.0.2'), lock(['0.0.1', HASH_A, ['devnet']]), lock(['0.0.1', HASH_A, []]), []),
    /must be retained/
  );
  assert.throws(
    () =>
      assertHistoryRetention(
        pkg('0.0.2'),
        lock(['0.0.1', HASH_A, ['devnet']], ['0.0.2', HASH_B]),
        lock(['0.0.1', HASH_A, ['devnet']], ['0.0.2', HASH_B, ['devnet']]),
        []
      ),
    /must be retained/
  );
  assert.throws(
    () =>
      assertHistoryRetention(
        pkg('0.0.2'),
        lock(['0.0.1', HASH_A, ['devnet']], ['0.0.3', HASH_C]),
        lock(['0.0.1', HASH_A, ['devnet']]),
        []
      ),
    /must be retained/
  );
});

void test('Mainnet requires the same-version exact DevNet hash and no newer Mainnet tag', () => {
  const current = pkg('0.0.2');
  assert.doesNotThrow(() => assertDeploymentUpload('mainnet', current, HASH_B, [tag('devnet', '0.0.2', HASH_B)]));
  assert.throws(() => assertDeploymentUpload('mainnet', current, HASH_B, []), /Mainnet requires/);
  assert.throws(
    () => assertDeploymentUpload('mainnet', current, HASH_B, [tag('devnet', '0.0.2', HASH_A)]),
    /not current hash/
  );
  assert.throws(
    () =>
      assertDeploymentUpload('mainnet', current, HASH_B, [
        tag('devnet', '0.0.2', HASH_B),
        tag('mainnet', '0.0.3', HASH_C),
      ]),
    /Newer Mainnet deployment/
  );
});

void test('an exact existing tag makes a release rerun idempotent, but a different hash fails', () => {
  assert.deepEqual(assertDeploymentUpload('devnet', pkg('0.0.2'), HASH_B, [tag('devnet', '0.0.2', HASH_B)]), {
    tagExists: true,
  });
  assert.throws(
    () => assertDeploymentUpload('devnet', pkg('0.0.2'), HASH_B, [tag('devnet', '0.0.2', HASH_A)]),
    /not current hash/
  );
  assert.deepEqual(
    assertDeploymentUpload('mainnet', pkg('0.0.2'), HASH_B, [
      tag('devnet', '0.0.2', HASH_B),
      tag('mainnet', '0.0.2', HASH_B),
    ]),
    { tagExists: true }
  );
  assert.equal(getDarLockKey(NAME, '0.0.2', NAME), `${NAME}/0.0.2/${NAME}.dar`);
});
