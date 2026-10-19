# open-captable-protocol-daml

See [CLAUDE.md](CLAUDE.md) for canonical build/test/lint commands and the public wiki. Treat
`multi-package.yaml`, each package's `daml.yaml`, `package.json`, and `daml-js-bundle.json` as the
source of truth.

## Cursor Cloud specific instructions

This repo builds DAML packages with **`dpm`** (the Daml Package Manager, installed under
`~/.dpm/bin`), not the classic `daml` SDK. Java (JDK 21+) is required.

One-time setup on a fresh VM (not part of the dashboard update script — run on demand):

```bash
npm install                                 # needs NPM_TOKEN — private @fairmint packages
npx canton-dev-tools install-dpm-sdks       # installs dpm + sdk-versions from daml.yaml into ~/.dpm/bin
```

`install-dpm-sdks` downloads SDKs from `get.digitalasset.com` (it retries 3x); it is skipped by the
cached install marker on later runs.

Build / test (both invoke `dpm` via `PATH="$HOME/.dpm/bin:$PATH"`, already wired into the npm
scripts):

```bash
npm run build   # generate-captable (OcfRecords.daml) -> prepare-build -> (cd generated/build && dpm build --all)
npm test        # generate-captable -> prepare-build -> dpm build --all -> (cd Test && dpm test)
```

`npm run build` compiles into `generated/build/<pkg>/.daml/dist/*.dar`. Nothing in v35 depends on
Splice; `npm run sync-splice-dars` is needed only for the participant admin protos that
`remove-participant-dar` needs.

After changing a package, back up the DAR of every package whose bytes changed before CI's DAR
policy and upgrade-compat pass. OpenCapTable-v35 embeds OpenCapTableApi-v01 and
OpenCapTableDeliveryProof-v01, so a change to either also changes the v35 DAR. Use the exact
discovery names (not the OCP script alias `ocp`; a prefix such as `OpenCapTable` is ambiguous):

```bash
npm run build
npm run backup-dar -- --package OpenCapTableApi-v01 --version <version-from-daml.yaml>
npm run backup-dar -- --package OpenCapTableDeliveryProof-v01 --version <version-from-daml.yaml>
npm run backup-dar -- --package OpenCapTable-v35 --version <version-from-daml.yaml>
```

Deployment preflight (writes `GITHUB_OUTPUT` when set). v35 deploys to DevNet only, and its two
dependencies are uploaded and tagged first, so the release workflows check them first too:

```bash
npm run check:dar-version-policy -- --deployment devnet --package OpenCapTableApi-v01
npm run check:dar-version-policy -- --deployment devnet --package OpenCapTableDeliveryProof-v01
npm run check:dar-version-policy -- --deployment devnet --package OpenCapTable-v35
```

Commit `dars/` and `dars/dars.lock` with the backup.
