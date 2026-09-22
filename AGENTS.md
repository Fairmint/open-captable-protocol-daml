# open-captable-protocol-daml

See [CLAUDE.md](CLAUDE.md) for canonical build/test/lint commands and the public wiki. Treat
`multi-package.yaml`, the active `OpenCapTable-v*/daml.yaml`, `package.json`, and
`daml-js-bundle.json` as the source of truth.

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
npm run build   # sync-splice-dars -> generate-captable -> prepare-build -> (cd generated/build && dpm build --all)
npm test        # prepare-build -> dpm build --all -> (cd Test && dpm test)
```

`npm run build` compiles into `generated/build/<pkg>/.daml/dist/*.dar`. `sync-splice-dars` fetches
Splice DARs over the network (packaged MainNet pin from `@fairmint/canton-dev-tools`), so build
needs outbound access. `libs/` is gitignored and populated by sync.

After changing OpenCapTable, back up its DAR before CI upgrade-compat passes. Use the discovery name
`OpenCapTable-v34` (not the OCP script alias `ocp`):

```bash
npm run build
npm run backup-dar -- --package OpenCapTable-v34 --version <version-from-daml.yaml>
```

Deployment preflight (writes `GITHUB_OUTPUT` when set):

```bash
npm run check:dar-version-policy -- --deployment <devnet|mainnet> --package OpenCapTable-v34
```

Commit `dars/` and `dars/dars.lock` with the backup.
