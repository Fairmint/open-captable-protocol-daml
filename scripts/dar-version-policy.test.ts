import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { applyBackupTransaction } from './dar-backup-transaction';
import { assertCandidateDarPaths } from './dar-candidate-path-policy';
import { validateDarLfsPointer, validateDarLfsTree } from './dar-lfs-policy';
import type { DarsLock, DarsLockEntry } from './dar-utils';
import { findBaselineDar } from './devnet-dar-policy';
import {
  assertDevnetPreferencesConsistent,
  assertDevnetMarkerForMainnet,
  candidateDevnetNetworks,
  decideBackupMutation,
  decideDevnetCandidateVersion,
  incrementPatch,
  nextDevnetCandidateVersion,
  planBackupRetention,
  resolveMajorPackageLineTarget,
  uniqueDevnetBaselines,
} from './dar-version-policy';

const entry = (sha256: string, networks: string[] = []): DarsLockEntry => ({
  sha256,
  size: 1,
  sdkVersion: '3.4.10',
  uploadedAt: 'now',
  networks,
});

void describe('DevNet-anchored candidate versions', () => {
  void it('starts an absent package at 0.0.1', () => {
    assert.equal(nextDevnetCandidateVersion([]), '0.0.1');
    assert.deepEqual(decideDevnetCandidateVersion([], 'candidate'), {
      expectedVersion: '0.0.1',
      highestDevnetVersion: null,
      reason: 'first-devnet-candidate',
    });
  });

  void it('keeps a candidate that is the exact preferred package on both providers', () => {
    const preferences = [
      { packageId: 'same', packageVersion: '0.0.3' },
      { packageId: 'same', packageVersion: '0.0.3' },
    ];
    assert.deepEqual(decideDevnetCandidateVersion(preferences, 'same'), {
      expectedVersion: '0.0.3',
      highestDevnetVersion: '0.0.3',
      reason: 'matches-devnet',
    });
  });

  void it('advances and remains unmarked when only one provider reports the exact candidate', () => {
    const partialPreferences = [{ packageId: 'same', packageVersion: '0.0.3' }];
    assert.deepEqual(decideDevnetCandidateVersion(partialPreferences, 'same'), {
      expectedVersion: '0.0.4',
      highestDevnetVersion: '0.0.3',
      reason: 'advance-after-devnet',
    });
    assert.deepEqual(candidateDevnetNetworks(partialPreferences, '0.0.3', 'same'), []);
  });

  void it('requires one patch when candidate bytes differ from DevNet', () => {
    const preferences = [
      { packageId: 'live', packageVersion: '0.0.3' },
      { packageId: 'live', packageVersion: '0.0.3' },
    ];
    assert.equal(decideDevnetCandidateVersion(preferences, 'candidate').expectedVersion, '0.0.4');
  });

  void it('uses one patch beyond the higher provider during version divergence', () => {
    const preferences = [
      { packageId: 'older', packageVersion: '0.0.2' },
      { packageId: 'newer', packageVersion: '0.0.5' },
    ];
    assert.equal(decideDevnetCandidateVersion(preferences, 'newer').expectedVersion, '0.0.6');
  });

  void it('handles patch rollover without changing the major or minor components', () => {
    assert.equal(incrementPatch('1.2.99'), '1.2.100');
  });

  void it('rejects the same version resolving to different package IDs', () => {
    assert.throws(
      () =>
        assertDevnetPreferencesConsistent([
          { packageId: 'one', packageVersion: '0.0.3' },
          { packageId: 'two', packageVersion: '0.0.3' },
        ]),
      /different package IDs/
    );
  });

  void it('rejects one package ID reported with different versions', () => {
    assert.throws(
      () =>
        assertDevnetPreferencesConsistent([
          { packageId: 'same', packageVersion: '0.0.2' },
          { packageId: 'same', packageVersion: '0.0.3' },
        ]),
      /different versions/
    );
  });

  void it('keeps every distinct live compatibility baseline exactly once', () => {
    const baselines = uniqueDevnetBaselines([
      { packageId: 'older', packageVersion: '0.0.2' },
      { packageId: 'newer', packageVersion: '0.0.3' },
      { packageId: 'newer', packageVersion: '0.0.3' },
    ]);
    assert.deepEqual(baselines, [
      { packageId: 'older', packageVersion: '0.0.2' },
      { packageId: 'newer', packageVersion: '0.0.3' },
    ]);
  });

  void it('marks newly written exact-live bytes as DevNet history', () => {
    const preferences = [
      { packageId: 'live', packageVersion: '0.0.3' },
      { packageId: 'live', packageVersion: '0.0.3' },
    ];
    assert.deepEqual(candidateDevnetNetworks(preferences, '0.0.3', 'live'), ['devnet']);
    assert.deepEqual(candidateDevnetNetworks(preferences, '0.0.4', 'candidate'), []);
  });

  void it('queries the target package line when selecting a major upgrade version', async () => {
    const queried: string[] = [];
    const target = await resolveMajorPackageLineTarget('OpenCapTable', 34, (packageName) => {
      queried.push(packageName);
      return [
        { packageId: 'live-v35', packageVersion: '0.0.3' },
        { packageId: 'live-v35', packageVersion: '0.0.3' },
      ];
    });
    assert.deepEqual(queried, ['OpenCapTable-v35']);
    assert.deepEqual(target, {
      candidateVersion: '0.0.4',
      majorVersion: 'v35',
      packageName: 'OpenCapTable-v35',
    });

    const absent = await resolveMajorPackageLineTarget('OpenCapTable', 35, () => []);
    assert.equal(absent.candidateVersion, '0.0.1');
  });
});

void describe('pre-download DAR LFS policy', () => {
  const pointer = (size: number) =>
    `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize ${size}\n`;
  const entryFor = (darPath: string, size = 1024) => ({
    blob: pointer(size),
    mode: '100644',
    path: darPath,
    type: 'blob',
  });

  void it('accepts canonical pointers only at safe package/version paths', () => {
    assert.deepEqual(validateDarLfsPointer(entryFor('dars/Example-v01/0.0.2/live-alias.dar')), {
      oid: 'a'.repeat(64),
      path: 'dars/Example-v01/0.0.2/live-alias.dar',
      size: 1024,
    });
    assert.throws(() => validateDarLfsPointer(entryFor('dars/Example-v01/../escape.dar')), /Unsafe DAR tree path/);
    assert.throws(
      () => validateDarLfsPointer({ ...entryFor('dars/Example-v01/0.0.2/alias.dar'), mode: '120000' }),
      /non-executable regular blob/
    );
    assert.throws(
      () =>
        validateDarLfsPointer({
          ...entryFor('dars/Example-v01/0.0.2/alias.dar'),
          blob: 'not an lfs pointer\n',
        }),
      /canonical Git LFS pointer/
    );
  });

  void it('bounds individual, aggregate, and count-based downloads', () => {
    assert.throws(
      () => validateDarLfsPointer(entryFor('dars/Example-v01/0.0.2/large.dar', 100 * 1024 * 1024 + 1)),
      /exceeds 100 MiB/
    );
    assert.throws(
      () =>
        validateDarLfsTree(
          Array.from({ length: 11 }, (_, index) =>
            entryFor(`dars/Example-v01/0.0.2/part-${index}.dar`, 100 * 1024 * 1024)
          )
        ),
      /maximum is 1 GiB/
    );
    assert.throws(
      () =>
        validateDarLfsTree(
          Array.from({ length: 251 }, (_, index) => entryFor(`dars/Example-v01/0.0.2/part-${index}.dar`))
        ),
      /maximum is 250/
    );
  });

  void it('rejects symlinked DAR parents and files after detached checkout', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dar-candidate-paths-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dar-candidate-outside-'));
    const darPath = 'dars/Example-v01/0.0.2/Example-v01.dar';
    try {
      const versionDirectory = path.join(root, 'dars', 'Example-v01', '0.0.2');
      fs.mkdirSync(versionDirectory, { recursive: true });
      fs.writeFileSync(path.join(versionDirectory, 'Example-v01.dar'), 'pointer');
      assert.doesNotThrow(() => assertCandidateDarPaths(root, [darPath]));

      fs.rmSync(path.join(versionDirectory, 'Example-v01.dar'));
      fs.writeFileSync(path.join(outside, 'outside.dar'), 'outside');
      fs.symlinkSync(path.join(outside, 'outside.dar'), path.join(versionDirectory, 'Example-v01.dar'));
      assert.throws(() => assertCandidateDarPaths(root, [darPath]), /non-symlink regular file/);

      fs.rmSync(versionDirectory, { recursive: true, force: true });
      fs.symlinkSync(outside, versionDirectory);
      assert.throws(() => assertCandidateDarPaths(root, [darPath]), /non-symlink directory/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

void describe('Mainnet promotion marker', () => {
  const lockKey = 'Example-v01/0.0.2/Example-v01.dar';

  void it('requires the exact candidate lock entry to record DevNet first', () => {
    assert.throws(() => assertDevnetMarkerForMainnet(undefined, lockKey), /committed devnet marker/);
    assert.throws(() => assertDevnetMarkerForMainnet(entry('candidate', ['mainnet']), lockKey), /devnet marker/);
    assert.doesNotThrow(() => assertDevnetMarkerForMainnet(entry('candidate', ['devnet']), lockKey));
  });
});

void describe('exact DevNet baseline lookup', () => {
  const preference = {
    packageId: 'live-id',
    packageName: 'Example-v01',
    packageVersion: '0.0.1',
    provider: 'intellect' as const,
  };

  void it('finds an exact live DAR under a distinct alias filename', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dar-baseline-alias-'));
    try {
      const aliasKey = 'Example-v01/0.0.1/live-deployment.dar';
      const aliasPath = path.join(root, 'dars', aliasKey);
      fs.mkdirSync(path.dirname(aliasPath), { recursive: true });
      fs.writeFileSync(aliasPath, 'live');
      const hash = crypto.createHash('sha256').update('live').digest('hex');
      const lock: DarsLock = {
        version: 1,
        packages: { [aliasKey]: { ...entry(hash), size: 4 } },
      };

      assert.equal(
        findBaselineDar(root, lock, preference, 'candidate-id', 'candidate.dar', () => 'live-id'),
        aliasPath
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  void it('fails closed when the exact live baseline is missing or corrupt', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dar-baseline-failure-'));
    try {
      assert.throws(
        () => findBaselineDar(root, { version: 1, packages: {} }, preference, 'candidate-id', 'candidate.dar'),
        /exact DevNet baseline.*is missing/
      );

      const corruptKey = 'Example-v01/0.0.1/live-deployment.dar';
      const corruptPath = path.join(root, 'dars', corruptKey);
      fs.mkdirSync(path.dirname(corruptPath), { recursive: true });
      fs.writeFileSync(corruptPath, 'live');
      const corruptLock: DarsLock = {
        version: 1,
        packages: { [corruptKey]: { ...entry('incorrect-hash'), size: 4 } },
      };
      assert.throws(() => findBaselineDar(root, corruptLock, preference, 'candidate-id', 'candidate.dar'), /SHA256/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

void describe('backup transaction', () => {
  void it('creates an exact-live candidate with a durable DevNet marker', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dar-backup-exact-live-'));
    try {
      const darsDir = path.join(root, 'dars');
      const currentKey = 'Example-v01/0.0.3/Example-v01.dar';
      const currentPath = path.join(darsDir, currentKey);
      const sourcePath = path.join(root, 'candidate.dar');
      fs.writeFileSync(sourcePath, 'live');
      const hash = crypto.createHash('sha256').update('live').digest('hex');
      const lock: DarsLock = { version: 1, packages: {} };
      const preferences = [
        { packageId: 'live-id', packageVersion: '0.0.3' },
        { packageId: 'live-id', packageVersion: '0.0.3' },
      ];

      applyBackupTransaction({
        lock,
        darsDir,
        retentionPlan: { freezeKeys: [], pruneKeys: [] },
        candidateWrite: {
          lockKey: currentKey,
          sourcePath,
          destPath: currentPath,
          replaceExisting: false,
          entry: {
            ...entry(hash, candidateDevnetNetworks(preferences, '0.0.3', 'live-id')),
            size: 4,
          },
        },
        saveLock: () => undefined,
      });

      assert.equal(fs.readFileSync(currentPath, 'utf8'), 'live');
      assert.deepEqual(lock.packages[currentKey].networks, ['devnet']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  void it('commits candidate replacement, retention, and the lock in one save', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dar-backup-transaction-'));
    try {
      const darsDir = path.join(root, 'dars');
      const currentKey = 'Example-v01/0.0.3/Example-v01.dar';
      const staleKey = 'Example-v01/0.0.2/Example-v01.dar';
      const currentPath = path.join(darsDir, currentKey);
      const stalePath = path.join(darsDir, staleKey);
      const sourcePath = path.join(root, 'candidate.dar');
      fs.mkdirSync(path.dirname(currentPath), { recursive: true });
      fs.mkdirSync(path.dirname(stalePath), { recursive: true });
      fs.writeFileSync(currentPath, 'old');
      fs.writeFileSync(stalePath, 'stale');
      fs.writeFileSync(sourcePath, 'new');

      const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
      const lock: DarsLock = {
        version: 1,
        packages: {
          [currentKey]: { ...entry(hash('old')), size: 3 },
          [staleKey]: { ...entry(hash('stale')), size: 5 },
        },
      };
      let savedLock: DarsLock | undefined;
      let saveCount = 0;

      applyBackupTransaction({
        lock,
        darsDir,
        retentionPlan: { freezeKeys: [], pruneKeys: [staleKey] },
        candidateWrite: {
          lockKey: currentKey,
          sourcePath,
          destPath: currentPath,
          replaceExisting: true,
          entry: { ...entry(hash('new'), ['devnet']), size: 3 },
        },
        saveLock: (nextLock) => {
          saveCount += 1;
          savedLock = JSON.parse(JSON.stringify(nextLock)) as DarsLock;
        },
      });

      assert.equal(saveCount, 1);
      assert.equal(fs.readFileSync(currentPath, 'utf8'), 'new');
      assert.equal(fs.existsSync(stalePath), false);
      assert.deepEqual(savedLock, lock);
      assert.deepEqual(lock.packages[currentKey].networks, ['devnet']);
      assert.equal(Object.prototype.hasOwnProperty.call(lock.packages, staleKey), false);
      assert.deepEqual(fs.readdirSync(path.dirname(currentPath)), ['Example-v01.dar']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  void it('restores candidate bytes, pruned backups, and the in-memory lock when saving fails', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dar-backup-rollback-'));
    try {
      const darsDir = path.join(root, 'dars');
      const currentKey = 'Example-v01/0.0.3/Example-v01.dar';
      const staleKey = 'Example-v01/0.0.2/Example-v01.dar';
      const currentPath = path.join(darsDir, currentKey);
      const stalePath = path.join(darsDir, staleKey);
      const sourcePath = path.join(root, 'candidate.dar');
      fs.mkdirSync(path.dirname(currentPath), { recursive: true });
      fs.mkdirSync(path.dirname(stalePath), { recursive: true });
      fs.writeFileSync(currentPath, 'old');
      fs.writeFileSync(stalePath, 'stale');
      fs.writeFileSync(sourcePath, 'new');

      const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
      const lock: DarsLock = {
        version: 1,
        packages: {
          [currentKey]: { ...entry(hash('old')), size: 3 },
          [staleKey]: { ...entry(hash('stale')), size: 5 },
        },
      };
      const originalLock = JSON.parse(JSON.stringify(lock)) as DarsLock;

      assert.throws(
        () =>
          applyBackupTransaction({
            lock,
            darsDir,
            retentionPlan: { freezeKeys: [], pruneKeys: [staleKey] },
            candidateWrite: {
              lockKey: currentKey,
              sourcePath,
              destPath: currentPath,
              replaceExisting: true,
              entry: { ...entry(hash('new')), size: 3 },
            },
            saveLock: () => {
              throw new Error('simulated lock save failure');
            },
          }),
        /simulated lock save failure/
      );

      assert.equal(fs.readFileSync(currentPath, 'utf8'), 'old');
      assert.equal(fs.readFileSync(stalePath, 'utf8'), 'stale');
      assert.deepEqual(lock, originalLock);
      assert.deepEqual(fs.readdirSync(path.dirname(currentPath)), ['Example-v01.dar']);
      assert.deepEqual(fs.readdirSync(path.dirname(stalePath)), ['Example-v01.dar']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

void describe('candidate backup mutation', () => {
  void it('creates a missing backup and reuses matching bytes', () => {
    assert.equal(decideBackupMutation(undefined, 'new'), 'create');
    assert.equal(decideBackupMutation(entry('same'), 'same'), 'no-op');
  });

  void it('replaces only an unrecorded candidate', () => {
    assert.equal(decideBackupMutation(entry('old'), 'new'), 'replace');
    assert.throws(() => decideBackupMutation(entry('old', ['devnet']), 'new'), /immutable/);
    assert.throws(() => decideBackupMutation(entry('old', ['mainnet']), 'new'), /immutable/);
  });

  void it('prunes only superseded undeployed backups and freezes exact live backups', () => {
    const plan = planBackupRetention(
      [
        {
          lockKey: 'Example-v01/0.0.4/Example-v01.dar',
          packageId: 'current',
          packageVersion: '0.0.4',
          entry: entry('current'),
        },
        {
          lockKey: 'Example-v01/0.0.3/Example-v01.dar',
          packageId: 'live',
          packageVersion: '0.0.3',
          entry: entry('live'),
        },
        {
          lockKey: 'Example-v01/0.0.2/Example-v01.dar',
          packageId: 'recorded',
          packageVersion: '0.0.2',
          entry: entry('recorded', ['mainnet']),
        },
        {
          lockKey: 'Example-v01/0.0.1/Example-v01.dar',
          packageId: 'stale',
          packageVersion: '0.0.1',
          entry: entry('stale'),
        },
      ],
      'Example-v01/0.0.4/Example-v01.dar',
      [
        { packageId: 'live', packageVersion: '0.0.3' },
        { packageId: 'live', packageVersion: '0.0.3' },
      ]
    );

    assert.deepEqual(plan, {
      freezeKeys: ['Example-v01/0.0.3/Example-v01.dar'],
      pruneKeys: ['Example-v01/0.0.1/Example-v01.dar'],
    });
  });

  void it('never prunes the current candidate and freezes it when it is exact-live', () => {
    const currentKey = 'Example-v01/0.0.3/Example-v01.dar';
    assert.deepEqual(
      planBackupRetention(
        [
          {
            lockKey: currentKey,
            packageId: 'live',
            packageVersion: '0.0.3',
            entry: entry('live'),
          },
        ],
        currentKey,
        [
          { packageId: 'live', packageVersion: '0.0.3' },
          { packageId: 'live', packageVersion: '0.0.3' },
        ]
      ),
      { freezeKeys: [currentKey], pruneKeys: [] }
    );
  });

  void it('retains but does not mark a DAR preferred by only one provider', () => {
    const partialKey = 'Example-v01/0.0.3/Example-v01.dar';
    assert.deepEqual(
      planBackupRetention(
        [
          {
            lockKey: partialKey,
            packageId: 'partial-live',
            packageVersion: '0.0.3',
            entry: entry('partial-live'),
          },
        ],
        'Example-v01/0.0.4/Example-v01.dar',
        [{ packageId: 'partial-live', packageVersion: '0.0.3' }]
      ),
      { freezeKeys: [], pruneKeys: [] }
    );
  });
});
