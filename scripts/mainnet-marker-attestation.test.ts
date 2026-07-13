import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import type { DarsLock, DarsLockEntry } from './dar-utils';
import {
  createMainnetMarkerAttestation,
  getMainnetAttestationArtifactName,
  MAINNET_ATTESTATION_WORKFLOW,
  parseOcpMainnetMarkerBranch,
  requiresMainnetAttestation,
  selectWorkflowArtifact,
  validateWorkflowRun,
  verifyMainnetMarkerAttestation,
} from './mainnet-marker-attestation';
import { requirePackageConfig } from './packages';

const REPOSITORY = 'Fairmint/open-captable-protocol-daml';
const PACKAGE = 'ocp';
const RUN_ID = 123456;
const RUN_ATTEMPT = 2;
const BRANCH = `automation/ocp-release-${RUN_ID}-${RUN_ATTEMPT}`;
const PACKAGE_CONFIG = requirePackageConfig(PACKAGE);
const LOCK_KEY = `${PACKAGE_CONFIG.name}/${PACKAGE_CONFIG.version}/${PACKAGE_CONFIG.darName}.dar`;
const CONTEXT = { defaultBranch: 'main', repository: REPOSITORY, workflowPath: MAINNET_ATTESTATION_WORKFLOW };

function entry(networks: string[]): DarsLockEntry {
  return {
    networks,
    sdkVersion: '3.5.1',
    sha256: 'a'.repeat(64),
    size: 42,
    uploadedAt: '2026-07-13T12:00:00.000Z',
  };
}

function git(repositoryRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

function writeLock(repositoryRoot: string, lock: DarsLock): void {
  fs.mkdirSync(path.join(repositoryRoot, 'dars'), { recursive: true });
  fs.writeFileSync(path.join(repositoryRoot, 'dars', 'dars.lock'), `${JSON.stringify(lock, null, 2)}\n`);
}

interface RepositoryFixture {
  baseSha: string;
  candidateSha: string;
  markerSha: string;
  repositoryRoot: string;
}

function repositoryFixture(options: { extraFile?: boolean; multipleMarkers?: boolean } = {}): RepositoryFixture {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ocp-mainnet-attestation-'));
  git(repositoryRoot, ['init', '-b', 'main']);
  git(repositoryRoot, ['config', 'user.name', 'Test']);
  git(repositoryRoot, ['config', 'user.email', 'test@example.com']);
  const otherKey = `EquityClearing-v02/0.0.2/EquityClearing-v02.dar`;
  const baseLock: DarsLock = {
    version: 1,
    packages: {
      [LOCK_KEY]: entry(['devnet']),
      ...(options.multipleMarkers ? { [otherKey]: entry(['devnet']) } : {}),
    },
  };
  writeLock(repositoryRoot, baseLock);
  git(repositoryRoot, ['add', 'dars/dars.lock']);
  git(repositoryRoot, ['commit', '-m', 'base']);
  const baseSha = git(repositoryRoot, ['rev-parse', 'HEAD']);

  const markerLock: DarsLock = {
    version: 1,
    packages: {
      [LOCK_KEY]: entry(['devnet', 'mainnet']),
      ...(options.multipleMarkers ? { [otherKey]: entry(['devnet', 'mainnet']) } : {}),
    },
  };
  writeLock(repositoryRoot, markerLock);
  if (options.extraFile) fs.writeFileSync(path.join(repositoryRoot, 'forged.txt'), 'forged\n');
  git(repositoryRoot, ['add', '.']);
  git(repositoryRoot, ['commit', '-m', 'marker']);
  const markerSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
  return { baseSha, candidateSha: markerSha, markerSha, repositoryRoot };
}

function workflowRun(headSha: string): Record<string, unknown> {
  return {
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_repository: { full_name: REPOSITORY },
    head_sha: headSha,
    id: RUN_ID,
    path: MAINNET_ATTESTATION_WORKFLOW,
    repository: { full_name: REPOSITORY },
    run_attempt: RUN_ATTEMPT,
    status: 'in_progress',
  };
}

void describe('Mainnet marker workflow attestation', () => {
  void it('binds a trusted workflow run, immutable artifact, and exact one-marker commit', () => {
    const fixture = repositoryFixture();
    try {
      assert.equal(requiresMainnetAttestation(fixture.repositoryRoot, fixture.baseSha, fixture.markerSha), true);
      assert.equal(requiresMainnetAttestation(fixture.repositoryRoot, fixture.baseSha, fixture.baseSha), false);
      const artifact = createMainnetMarkerAttestation({
        markerCommitSha: fixture.markerSha,
        package: PACKAGE,
        repository: REPOSITORY,
        repositoryRoot: fixture.repositoryRoot,
        runAttempt: RUN_ATTEMPT,
        runId: RUN_ID,
        workflowPath: MAINNET_ATTESTATION_WORKFLOW,
      });
      assert.deepEqual(
        verifyMainnetMarkerAttestation({
          artifact,
          branch: BRANCH,
          candidateHead: fixture.candidateSha,
          context: CONTEXT,
          repositoryRoot: fixture.repositoryRoot,
          trustedDefaultHead: fixture.baseSha,
          workflowRun: workflowRun(fixture.baseSha),
        }),
        artifact
      );
    } finally {
      fs.rmSync(fixture.repositoryRoot, { force: true, recursive: true });
    }
  });

  void it('rejects forged automation branch coordinates and workflow provenance', () => {
    assert.throws(
      () => parseOcpMainnetMarkerBranch('automation/ocp-release-not-a-run-1'),
      /must be automation\/ocp-release/
    );
    const parsed = parseOcpMainnetMarkerBranch(BRANCH);
    assert.throws(
      () =>
        validateWorkflowRun({ ...workflowRun('a'.repeat(40)), path: '.github/workflows/forged.yml' }, parsed, CONTEXT),
      /workflow path/
    );
    assert.throws(
      () => validateWorkflowRun({ ...workflowRun('a'.repeat(40)), head_branch: 'attacker' }, parsed, CONTEXT),
      /trusted workflow ref/
    );
    assert.doesNotThrow(() =>
      validateWorkflowRun(
        {
          ...workflowRun('a'.repeat(40)),
          event: 'push',
          head_branch: 'OpenCapTable-v34-v0.0.2',
        },
        parsed,
        CONTEXT
      )
    );
  });

  void it('fails closed on missing, expired, and multiple exact artifacts', () => {
    const parsed = parseOcpMainnetMarkerBranch(BRANCH);
    const name = getMainnetAttestationArtifactName(parsed);
    assert.deepEqual(
      selectWorkflowArtifact(
        { artifacts: [{ expired: false, id: 7, name, size_in_bytes: 512 }], total_count: 1 },
        parsed
      ),
      { artifactId: 7, artifactName: name }
    );
    assert.throws(() => selectWorkflowArtifact({ artifacts: [], total_count: 0 }, parsed), /found 0/);
    assert.throws(
      () =>
        selectWorkflowArtifact(
          { artifacts: [{ expired: true, id: 1, name, size_in_bytes: 512 }], total_count: 1 },
          parsed
        ),
      /expired/
    );
    assert.throws(
      () =>
        selectWorkflowArtifact(
          {
            artifacts: [
              { expired: false, id: 1, name, size_in_bytes: 512 },
              { expired: false, id: 2, name, size_in_bytes: 512 },
            ],
            total_count: 2,
          },
          parsed
        ),
      /found 2/
    );
    assert.throws(
      () =>
        selectWorkflowArtifact(
          { artifacts: [{ expired: false, id: 1, name, size_in_bytes: 2 * 1024 * 1024 }], total_count: 1 },
          parsed
        ),
      /exceeds/
    );
  });

  void it('rejects marker commits that change another path or add multiple markers', () => {
    for (const options of [{ extraFile: true }, { multipleMarkers: true }]) {
      const fixture = repositoryFixture(options);
      try {
        assert.throws(
          () =>
            createMainnetMarkerAttestation({
              markerCommitSha: fixture.markerSha,
              package: PACKAGE,
              repository: REPOSITORY,
              repositoryRoot: fixture.repositoryRoot,
              runAttempt: RUN_ATTEMPT,
              runId: RUN_ID,
              workflowPath: MAINNET_ATTESTATION_WORKFLOW,
            }),
          options.extraFile ? /may change only dars\/dars\.lock/ : /exactly one mainnet marker/
        );
      } finally {
        fs.rmSync(fixture.repositoryRoot, { force: true, recursive: true });
      }
    }
  });

  void it('rejects an artifact whose package or immutable lock metadata was forged', () => {
    const fixture = repositoryFixture();
    try {
      const artifact = createMainnetMarkerAttestation({
        markerCommitSha: fixture.markerSha,
        package: PACKAGE,
        repository: REPOSITORY,
        repositoryRoot: fixture.repositoryRoot,
        runAttempt: RUN_ATTEMPT,
        runId: RUN_ID,
        workflowPath: MAINNET_ATTESTATION_WORKFLOW,
      });
      assert.throws(
        () =>
          verifyMainnetMarkerAttestation({
            artifact: { ...artifact, package: 'forged' },
            branch: BRANCH,
            candidateHead: fixture.candidateSha,
            context: CONTEXT,
            repositoryRoot: fixture.repositoryRoot,
            trustedDefaultHead: fixture.baseSha,
            workflowRun: workflowRun(fixture.baseSha),
          }),
        /does not match its repository, workflow run, or automation branch/
      );
      assert.throws(
        () =>
          verifyMainnetMarkerAttestation({
            artifact: { ...artifact, lockEntry: { ...artifact.lockEntry, sha256: 'b'.repeat(64) } },
            branch: BRANCH,
            candidateHead: fixture.candidateSha,
            context: CONTEXT,
            repositoryRoot: fixture.repositoryRoot,
            trustedDefaultHead: fixture.baseSha,
            workflowRun: workflowRun(fixture.baseSha),
          }),
        /immutable sha256 does not match/
      );
    } finally {
      fs.rmSync(fixture.repositoryRoot, { force: true, recursive: true });
    }
  });
});
