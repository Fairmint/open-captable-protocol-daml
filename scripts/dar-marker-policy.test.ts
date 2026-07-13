import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import {
  assertContainedRegularFile,
  MAX_CANDIDATE_LOCK_BYTES,
  MAX_CANDIDATE_METADATA_BYTES,
} from './candidate-path-safety';
import type { DarsLock, DarsLockEntry } from './dar-utils';
import {
  assertDarsLockSchema,
  assertDevnetMarkerIdentity,
  classifyCandidateOnlyBackups,
  getExactLiveProviderNames,
  getNetworkMarkerAdditions,
} from './dar-marker-policy';
import { verifyLockedDar } from './devnet-dar-policy';
import type { DevnetPackagePreference } from './devnet-package-versions';

const LOCK_KEY = 'Example-v01/1.2.3/Example-v01.dar';

function entry(networks: string[] = [], sha256 = 'a'.repeat(64)): DarsLockEntry {
  return { networks, sdkVersion: '3.5.1', sha256, size: 12, uploadedAt: '2026-07-13T00:00:00.000Z' };
}

function lock(value?: DarsLockEntry): DarsLock {
  return { version: 1, packages: value ? { [LOCK_KEY]: value } : {} };
}

function preference(provider: 'intellect' | '5n', packageId = 'exact'): DevnetPackagePreference {
  return {
    packageId,
    packageName: 'Example-v01',
    packageVersion: '1.2.3',
    provider,
  };
}

void describe('DAR network marker policy', () => {
  void it('rejects unknown and duplicate markers', () => {
    assert.throws(() => getNetworkMarkerAdditions(lock(), lock(entry(['staging']))), /unknown network marker.*staging/);
    assert.throws(
      () => getNetworkMarkerAdditions(lock(), lock(entry(['devnet', 'devnet']))),
      /duplicate network marker.*devnet/
    );
  });

  void it('rejects removal of a recorded marker', () => {
    assert.throws(
      () => getNetworkMarkerAdditions(lock(entry(['devnet'])), lock(entry([]))),
      /recorded network marker.*removed.*devnet/
    );
  });

  void it('keeps recorded metadata immutable', () => {
    assert.throws(
      () => getNetworkMarkerAdditions(lock(entry(['devnet'])), lock(entry(['devnet'], 'b'.repeat(64)))),
      /recorded DAR metadata sha256 cannot change/
    );
  });

  void it('rejects historical in-place replacement but permits the active mutable candidate', () => {
    const base = lock(entry());
    const candidate = lock(entry([], 'b'.repeat(64)));
    assert.throws(
      () => getNetworkMarkerAdditions(base, candidate),
      /historical unrecorded DAR metadata cannot be replaced in place/
    );
    assert.doesNotThrow(() =>
      getNetworkMarkerAdditions(base, candidate, { currentCandidateKeys: new Set([LOCK_KEY]) })
    );
    assert.doesNotThrow(() => getNetworkMarkerAdditions(base, candidate, { liveBaselineKeys: new Set([LOCK_KEY]) }));
  });

  void it('rejects malformed candidate lock entry fields', () => {
    assert.throws(
      () =>
        assertDarsLockSchema(
          { version: 1, packages: { [LOCK_KEY]: { ...entry(), networks: 'devnet' } } },
          'Candidate dars.lock'
        ),
      /networks must be an array of strings/
    );
    assert.throws(
      () => assertDarsLockSchema(lock(entry([], 'ABC')), 'Candidate dars.lock'),
      /sha256 must be 64 lowercase hexadecimal characters/
    );
  });

  void it('returns a new devnet marker for exact-live verification', () => {
    assert.deepEqual(getNetworkMarkerAdditions(lock(entry()), lock(entry(['devnet']))), [
      {
        darName: 'Example-v01',
        lockKey: LOCK_KEY,
        network: 'devnet',
        packageName: 'Example-v01',
        packageVersion: '1.2.3',
      },
    ]);
  });

  void it('allows mainnet with trusted-base DevNet or a same-candidate DevNet proof', () => {
    assert.throws(
      () => getNetworkMarkerAdditions(lock(entry(['devnet'])), lock(entry(['devnet', 'mainnet']))),
      /new mainnet marker requires explicit trusted workflow provenance/
    );
    assert.deepEqual(
      getNetworkMarkerAdditions(lock(entry(['devnet'])), lock(entry(['devnet', 'mainnet'])), {
        authorizedMainnetMarkerLockKey: LOCK_KEY,
      }),
      [
        {
          darName: 'Example-v01',
          lockKey: LOCK_KEY,
          network: 'mainnet',
          packageName: 'Example-v01',
          packageVersion: '1.2.3',
        },
      ]
    );
    assert.throws(
      () =>
        getNetworkMarkerAdditions(lock(entry()), lock(entry(['mainnet'])), {
          authorizedMainnetMarkerLockKey: LOCK_KEY,
          allowSameCandidateMainnet: true,
        }),
      /mainnet requires a trusted-base devnet marker or a devnet marker proven in this candidate/
    );
    assert.deepEqual(
      getNetworkMarkerAdditions(lock(entry()), lock(entry(['mainnet', 'devnet'])), {
        authorizedMainnetMarkerLockKey: LOCK_KEY,
        allowSameCandidateMainnet: true,
      }),
      [
        {
          darName: 'Example-v01',
          lockKey: LOCK_KEY,
          network: 'devnet',
          packageName: 'Example-v01',
          packageVersion: '1.2.3',
        },
        {
          darName: 'Example-v01',
          lockKey: LOCK_KEY,
          network: 'mainnet',
          packageName: 'Example-v01',
          packageVersion: '1.2.3',
        },
      ]
    );
  });

  void it('scopes Mainnet provenance to exactly the attested lock key', () => {
    const otherLockKey = 'Other-v01/1.2.3/Other-v01.dar';
    const base: DarsLock = {
      version: 1,
      packages: { [LOCK_KEY]: entry(['devnet']), [otherLockKey]: entry(['devnet'], 'b'.repeat(64)) },
    };
    const candidate: DarsLock = {
      version: 1,
      packages: {
        [LOCK_KEY]: entry(['devnet', 'mainnet']),
        [otherLockKey]: entry(['devnet', 'mainnet'], 'b'.repeat(64)),
      },
    };
    assert.throws(
      () =>
        getNetworkMarkerAdditions(base, candidate, {
          authorizedMainnetMarkerLockKey: LOCK_KEY,
        }),
      new RegExp(`verified attestation authorizes only ${LOCK_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    );
    assert.throws(
      () =>
        getNetworkMarkerAdditions(base, base, {
          authorizedMainnetMarkerLockKey: LOCK_KEY,
        }),
      /must authorize exactly that one marker addition/
    );
  });

  void it('rejects locked byte replacement and parent-directory symlink escape', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ocp-marker-retention-'));
    try {
      const expectedBytes = Buffer.from('expected');
      const expectedEntry: DarsLockEntry = {
        ...entry(),
        sha256: createHash('sha256').update(expectedBytes).digest('hex'),
        size: expectedBytes.length,
      };
      const tamperedRoot = path.join(tempRoot, 'tampered');
      const tamperedDar = path.join(tamperedRoot, 'dars', LOCK_KEY);
      fs.mkdirSync(path.dirname(tamperedDar), { recursive: true });
      fs.writeFileSync(tamperedDar, 'tampered');
      assert.throws(() => verifyLockedDar(tamperedRoot, lock(expectedEntry), LOCK_KEY), /SHA256.*requires/);

      const symlinkRoot = path.join(tempRoot, 'symlink');
      const outsideRoot = path.join(tempRoot, 'outside');
      fs.mkdirSync(path.join(symlinkRoot, 'dars'), { recursive: true });
      const outsideDar = path.join(outsideRoot, LOCK_KEY);
      fs.mkdirSync(path.dirname(outsideDar), { recursive: true });
      fs.writeFileSync(outsideDar, expectedBytes);
      fs.symlinkSync(path.join(outsideRoot, 'Example-v01'), path.join(symlinkRoot, 'dars', 'Example-v01'));
      assert.throws(
        () => verifyLockedDar(symlinkRoot, lock(expectedEntry), LOCK_KEY),
        /escapes candidate root through a symlink/
      );
    } finally {
      fs.rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  void it('rejects oversized candidate metadata and lock data before parsing', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ocp-marker-bounds-'));
    try {
      const metadataPath = path.join(tempRoot, 'Example-v01', 'daml.yaml');
      const lockPath = path.join(tempRoot, 'dars', 'dars.lock');
      fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(metadataPath, Buffer.alloc(MAX_CANDIDATE_METADATA_BYTES + 1));
      fs.writeFileSync(lockPath, Buffer.alloc(MAX_CANDIDATE_LOCK_BYTES + 1));
      assert.throws(
        () => assertContainedRegularFile(tempRoot, metadataPath, 'DAML metadata', MAX_CANDIDATE_METADATA_BYTES),
        /DAML metadata exceeds/
      );
      assert.throws(
        () => assertContainedRegularFile(tempRoot, lockPath, 'dars.lock', MAX_CANDIDATE_LOCK_BYTES),
        /dars\.lock exceeds/
      );
    } finally {
      fs.rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  void it('requires the exact locked identity on every configured DevNet provider', () => {
    const addition = { lockKey: LOCK_KEY, packageName: 'Example-v01', packageVersion: '1.2.3' };
    const identity = { packageId: 'exact', packageName: 'Example-v01', packageVersion: '1.2.3' };
    assert.doesNotThrow(() =>
      assertDevnetMarkerIdentity(addition, identity, [preference('intellect'), preference('5n')], ['intellect', '5n'])
    );
    assert.throws(
      () => assertDevnetMarkerIdentity(addition, identity, [preference('intellect')], ['intellect', '5n']),
      /preferred by every configured DevNet provider.*5n=absent/
    );
    assert.throws(
      () =>
        assertDevnetMarkerIdentity(
          addition,
          identity,
          [preference('intellect'), preference('5n', 'different')],
          ['intellect', '5n']
        ),
      /preferred by every configured DevNet provider.*5n=1\.2\.3\/different/
    );
  });

  void it('allows only the canonical current candidate as candidate-only unrecorded history', () => {
    const candidate = lock(entry());
    assert.throws(
      () => classifyCandidateOnlyBackups(lock(), candidate, new Set(), []),
      /candidate-only unrecorded DAR must be the canonical current candidate/
    );
    assert.deepEqual(classifyCandidateOnlyBackups(lock(), candidate, new Set([LOCK_KEY]), []), {
      candidateOnlyKeys: [LOCK_KEY],
      currentCandidateKeys: [LOCK_KEY],
      restoredRecordedKeys: [],
    });
  });

  void it('preserves non-current B only when one split provider proves B is the exact live baseline', () => {
    const liveIdentity = { packageId: 'partial-live', packageName: 'Example-v01', packageVersion: '1.2.3' };
    const splitPreferences: DevnetPackagePreference[] = [
      { ...liveIdentity, provider: 'intellect' },
      {
        packageId: 'older-live',
        packageName: 'Example-v01',
        packageVersion: '1.2.2',
        provider: '5n',
      },
    ];
    assert.deepEqual(getExactLiveProviderNames(liveIdentity, splitPreferences), ['intellect']);
    assert.deepEqual(
      getExactLiveProviderNames({ ...liveIdentity, packageId: 'stale-base-candidate' }, splitPreferences),
      []
    );

    const candidate = lock(entry());
    assert.throws(
      () => classifyCandidateOnlyBackups(lock(), candidate, new Set(), []),
      /candidate-only unrecorded DAR must be the canonical current candidate/
    );
    assert.deepEqual(classifyCandidateOnlyBackups(lock(), candidate, new Set(), [], new Set([LOCK_KEY])), {
      candidateOnlyKeys: [LOCK_KEY],
      currentCandidateKeys: [],
      restoredRecordedKeys: [],
    });
  });

  void it('restores a recorded alias only with an exact immutable identity from trusted history', () => {
    const historicalEntry = entry(['devnet', 'mainnet']);
    const restoredKey = 'Example-v01/1.2.3/restored-live.dar';
    const candidate: DarsLock = { version: 1, packages: { [restoredKey]: entry(['mainnet', 'devnet']) } };
    const historical = lock(historicalEntry);
    const classification = classifyCandidateOnlyBackups(lock(), candidate, new Set(), [historical]);
    assert.deepEqual(classification, {
      candidateOnlyKeys: [restoredKey],
      currentCandidateKeys: [],
      restoredRecordedKeys: [restoredKey],
    });
    assert.deepEqual(
      getNetworkMarkerAdditions(lock(), candidate, { restoredRecordedKeys: new Set([restoredKey]) }),
      []
    );

    const forged: DarsLock = {
      version: 1,
      packages: { [restoredKey]: entry(['devnet', 'mainnet'], 'b'.repeat(64)) },
    };
    assert.throws(
      () => classifyCandidateOnlyBackups(lock(), forged, new Set(), [historical]),
      /no exact immutable identity in trusted default-branch history/
    );
  });
});
