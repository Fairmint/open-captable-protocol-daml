import assert from 'node:assert/strict';
import {
  assertMainnetNotAhead,
  assertMainnetPromotionNotBehind,
  buildDeploymentTag,
  darLockEntriesEqual,
  decideCandidateVersion,
  findDeploymentAnchor,
  listDeploymentTags,
  nextPatch,
  parseDeploymentTag,
  parseStrictSemver,
  type DarsLock,
  type DarsLockEntry,
} from '@fairmint/canton-dev-tools/daml';

function lock(entries: DarsLock['packages'] = {}): DarsLock {
  return { version: 1, packages: entries };
}

function marker(packageName: string, version: string, hash = 'a'): DarsLock['packages'] {
  return {
    [`${packageName}/${version}/${packageName}.dar`]: {
      sha256: hash,
      size: 1,
      sdkVersion: '3.5.1',
      uploadedAt: '2026-01-01T00:00:00.000Z',
      networks: ['mainnet'],
    },
  };
}

function main() {
  assert.deepEqual(parseStrictSemver('0.0.1'), { major: 0, minor: 0, patch: 1 });
  for (const malformed of ['1', '1.2', '01.2.3', '1.02.3', '1.2.03', '1.2.3-beta', '-1.2.3']) {
    assert.equal(parseStrictSemver(malformed), null);
  }
  assert.equal(nextPatch('1.2.9'), '1.2.10');

  const packageName = 'Example-v01';
  assert.equal(buildDeploymentTag('devnet', packageName, '1.2.3'), 'dar-deploy/devnet/Example-v01/v1.2.3');
  assert.deepEqual(parseDeploymentTag('dar-deploy/mainnet/Example-v01/v1.2.3'), {
    name: 'dar-deploy/mainnet/Example-v01/v1.2.3',
    network: 'mainnet',
    packageName,
    version: '1.2.3',
  });
  assert.equal(parseDeploymentTag('release/devnet/Example-v01/v9.9.9'), null);
  assert.equal(parseDeploymentTag('dar-deploy/devnet/Example-v01/v1.2'), null);

  assert.equal(findDeploymentAnchor(packageName, [], lock()), null);
  assert.deepEqual(findDeploymentAnchor(packageName, [], lock(marker(packageName, '0.0.7'))), {
    version: '0.0.7',
    source: 'legacy-marker',
  });

  const tags = [
    'dar-deploy/devnet/Other/v9.9.9',
    'dar-deploy/mainnet/Example-v01/v0.0.8',
    'dar-deploy/devnet/Example-v01/v0.0.10',
    'dar-deploy/devnet/Example-v01/v0.0.9',
    'dar-deploy/devnet/Example-v01/not-semver',
  ];
  assert.deepEqual(
    listDeploymentTags(tags, packageName).map(({ network, version }) => `${network}:${version}`),
    ['mainnet:0.0.8', 'devnet:0.0.9', 'devnet:0.0.10']
  );
  assert.deepEqual(findDeploymentAnchor(packageName, tags, lock(marker(packageName, '8.0.0'))), {
    version: '0.0.10',
    source: 'devnet-tag',
  });

  assert.deepEqual(decideCandidateVersion('0.0.1', null, false), {
    valid: true,
    kind: 'candidate',
    expectedVersion: '0.0.1',
  });
  assert.equal(decideCandidateVersion('0.0.4', null, false).valid, false);
  assert.equal(decideCandidateVersion('0.0.4', null, false, '0.0.4').kind, 'candidate');
  assert.equal(decideCandidateVersion('0.0.5', null, false, '0.0.4').valid, false);
  const legacyAnchor = { version: '0.0.1', source: 'legacy-marker' } as const;
  assert.equal(decideCandidateVersion('0.0.4', legacyAnchor, false, '0.0.4').kind, 'candidate');
  const anchor = { version: '1.2.9', source: 'devnet-tag' } as const;
  assert.equal(decideCandidateVersion('1.2.9', anchor, true).kind, 'deployed');
  assert.equal(decideCandidateVersion('1.2.9', anchor, false).valid, false);
  assert.equal(decideCandidateVersion('1.2.10', anchor, false).kind, 'candidate');
  assert.equal(decideCandidateVersion('1.2.11', anchor, false).valid, false);
  assert.equal(decideCandidateVersion('1.2.11', anchor, false, '1.2.11').valid, false);

  const entry: DarsLockEntry = {
    sha256: 'abc',
    size: 123,
    sdkVersion: '3.5.1',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    networks: ['devnet', 'mainnet'],
  };
  const reorderedEntry = {
    networks: ['mainnet', 'devnet'],
    uploadedAt: entry.uploadedAt,
    sdkVersion: entry.sdkVersion,
    size: entry.size,
    sha256: entry.sha256,
  };
  assert.equal(darLockEntriesEqual(entry, reorderedEntry), true);
  assert.equal(darLockEntriesEqual(entry, { ...reorderedEntry, sha256: 'different' }), false);
  assert.equal(darLockEntriesEqual(entry, { ...reorderedEntry, networks: ['devnet', 'devnet'] }), false);

  assert.throws(
    () =>
      findDeploymentAnchor(
        packageName,
        [],
        lock({
          ...marker(packageName, '2.0.0', 'hash-a'),
          [`${packageName}/2.0.0/alias.dar`]: { ...Object.values(marker(packageName, '2.0.0'))[0], sha256: 'hash-b' },
        })
      ),
    /multiple deployed legacy hashes/
  );
  assert.throws(() => assertMainnetNotAhead(packageName, ['dar-deploy/mainnet/Example-v01/v1.0.0']), /newer than/);
  const mainnetTags = [
    'dar-deploy/devnet/Example-v01/v0.0.4',
    'dar-deploy/devnet/Example-v01/v0.0.6',
    'dar-deploy/mainnet/Example-v01/v0.0.5',
  ];
  assert.doesNotThrow(() => assertMainnetPromotionNotBehind(packageName, '0.0.5', mainnetTags));
  assert.doesNotThrow(() => assertMainnetPromotionNotBehind(packageName, '0.0.6', mainnetTags));
  assert.throws(
    () => assertMainnetPromotionNotBehind(packageName, '0.0.4', mainnetTags),
    /older than latest Mainnet tag 0\.0\.5/
  );
}

main();
