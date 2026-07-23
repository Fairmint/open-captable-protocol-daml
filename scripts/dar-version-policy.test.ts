import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { ensureBackupFile } from './backup-dar';
import { computeSha256, type DarsLock, type DarsLockEntry } from './dar-utils';
import {
  assertDeploymentUpload,
  assertHistoryRetention,
  assertPackagePolicy,
  deploymentTagName,
  expectedCandidateVersion,
  nextPatch,
  planCandidateBackup,
  type DeploymentState,
  type DeploymentTag,
} from './dar-version-policy';
import type { ContractNetwork } from './types';

const NAME = 'OpenCapTable-v34';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

function entry(sha256: string, networks: string[] = []): DarsLockEntry {
  return { sha256, size: 10, sdkVersion: '3.4.10', uploadedAt: '2026-01-01T00:00:00.000Z', networks };
}

function lock(...items: Array<[string, string, string[]?]>): DarsLock {
  return {
    version: 1,
    packages: Object.fromEntries(
      items.map(([version, hash, networks = []]) => [`${NAME}/${version}/${NAME}.dar`, entry(hash, networks)])
    ),
  };
}

function tag(network: ContractNetwork, version: string, sha256: string, networks: string[] = []): DeploymentTag {
  return { name: deploymentTagName(network, version), version, sha256, entry: entry(sha256, networks) };
}

function state(
  latestDevnet: DeploymentTag | null = null,
  currentDevnet: DeploymentTag | null = null,
  currentMainnet: DeploymentTag | null = null
): DeploymentState {
  return { latestDevnet, currentDevnet, currentMainnet };
}

void test('candidate versions come only from the latest DevNet deployment tag', () => {
  assert.equal(deploymentTagName('devnet', '1.2.3'), `dar-deploy/devnet/${NAME}/v1.2.3`);
  assert.equal(nextPatch('1.2.9'), '1.2.10');
  assert.equal(expectedCandidateVersion(state()), '0.0.1');
  assert.equal(expectedCandidateVersion(state(tag('devnet', '1.2.3', A))), '1.2.4');

  assert.doesNotThrow(() => assertPackagePolicy(lock(['0.0.1', A, ['mainnet']]), state(), A, '0.0.1'));
  assert.throws(() => assertPackagePolicy(lock(['0.0.2', B]), state(), B, '0.0.2'), /candidate v0\.0\.1/);

  const anchor = tag('devnet', '0.0.1', A);
  const history = lock(['0.0.1', A], ['0.0.2', B], ['0.0.9', C, ['mainnet']]);
  assert.doesNotThrow(() => assertPackagePolicy(history, state(anchor), B, '0.0.2'));
  assert.throws(() => assertPackagePolicy(history, state(anchor), B, '0.0.3'), /candidate v0\.0\.2/);
});

void test('a deployed version must retain its exact tagged bytes and lock row', () => {
  const anchor = tag('devnet', '0.0.1', A);
  assert.doesNotThrow(() => assertPackagePolicy(lock(['0.0.1', A]), state(anchor, anchor), A, '0.0.1'));
  assert.throws(() => assertPackagePolicy(lock(['0.0.1', B]), state(anchor, anchor), B, '0.0.1'), /immutable/);
});

void test('base history is immutable except for the unmarked current candidate', () => {
  const anchor = tag('devnet', '0.0.1', A, ['devnet']);
  const base = lock(['0.0.1', A, ['devnet']], ['0.0.2', B], ['0.0.3', C, ['mainnet']]);
  const changedCandidate = lock(['0.0.1', A, ['devnet']], ['0.0.2', C], ['0.0.3', C, ['mainnet']]);
  assert.doesNotThrow(() => assertHistoryRetention(base, changedCandidate, state(anchor), '0.0.2'));
  assert.throws(
    () =>
      assertHistoryRetention(
        base,
        lock(['0.0.1', A, ['devnet']], ['0.0.2', C], ['0.0.3', A, ['mainnet']]),
        state(anchor),
        '0.0.2'
      ),
    /must be retained/
  );
  assert.throws(
    () => assertHistoryRetention(lock(['0.0.1', A, ['devnet']]), lock(['0.0.1', B]), state(), '0.0.1'),
    /must be retained/
  );
});

void test('backup planning replaces only an unmarked candidate', () => {
  const anchor = tag('devnet', '0.0.1', A);
  assert.deepEqual(planCandidateBackup(lock(['0.0.1', A], ['0.0.2', B]), state(anchor), C, 11, '0.0.2'), {
    replace: true,
  });
  assert.throws(() => planCandidateBackup(lock(['0.0.1', A]), state(anchor, anchor), B, 10, '0.0.1'), /immutable/);
  assert.deepEqual(planCandidateBackup(lock(['0.0.1', A, ['mainnet']]), state(), A, 10, '0.0.1'), {
    replace: false,
  });
});

void test('backup restoration repairs missing and corrupt files with unchanged lock metadata', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dar-backup-'));
  try {
    const source = path.join(dir, 'source.dar');
    const destination = path.join(dir, 'backup.dar');
    fs.writeFileSync(source, 'fresh DAR bytes');
    const sha256 = computeSha256(source);
    const { size } = fs.statSync(source);
    assert.equal(ensureBackupFile(source, destination, sha256, size), true);
    assert.equal(ensureBackupFile(source, destination, sha256, size), false);
    fs.writeFileSync(destination, 'corrupt');
    assert.equal(ensureBackupFile(source, destination, sha256, size), true);
    assert.deepEqual([computeSha256(destination), fs.statSync(destination).size], [sha256, size]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test('deployment gates are idempotent and Mainnet requires the exact DevNet hash', () => {
  assert.deepEqual(assertDeploymentUpload('devnet', B, state(tag('devnet', '0.0.1', A)), '0.0.2'), {
    tagExists: false,
  });
  const devnet = tag('devnet', '0.0.2', B);
  assert.deepEqual(assertDeploymentUpload('devnet', B, state(devnet, devnet), '0.0.2'), { tagExists: true });
  assert.deepEqual(assertDeploymentUpload('mainnet', B, state(devnet, devnet), '0.0.2'), { tagExists: false });
  assert.throws(() => assertDeploymentUpload('mainnet', A, state(), '0.0.1'), /Mainnet requires/);
  assert.throws(() => assertDeploymentUpload('mainnet', C, state(devnet, devnet), '0.0.2'), /immutable/);
  const mainnet = tag('mainnet', '0.0.2', B);
  assert.deepEqual(assertDeploymentUpload('mainnet', B, state(devnet, devnet, mainnet), '0.0.2'), {
    tagExists: true,
  });
});
