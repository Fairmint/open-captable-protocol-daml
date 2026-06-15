# Package Tag Release Process

This repo releases the current OpenCapTable package with package-scoped tags:

```text
OpenCapTable-v34-v0.0.2
```

The last `-v<semver>` segment must match `OpenCapTable-v34/daml.yaml`. The package prefix must be a configured package
from `scripts/packages.ts`; today that is `ocp` / `OpenCapTable-v34`.

## Automated Release

Pushing a matching tag runs `.github/workflows/release.yml`.

The workflow:

1. Parses the tag with `scripts/parse-release-tag.ts`.
2. Fails early if the current root `package.json` version is already published to npm.
3. Runs the same build, lint, codegen, package, and DAML test checks used by CI.
4. Uploads the DAR to devnet and mainnet with `npm run upload-dar`.
5. Detects whether devnet/mainnet already have factories for the current DAR package ID.
6. Creates only missing factories with `scripts/create-ocp-factory.ts`.
7. Verifies `dars/dars.lock`.
8. Prepares npm package artifacts and commits changed release artifacts back to `main` when the tag points at the
   current `origin/main`.
9. Publishes the npm package.

The tag version is the DAML package version from `OpenCapTable-v34/daml.yaml`. The npm version is the root
`package.json` version and must be bumped before tagging when a new npm publication is expected.

## Required GitHub Secrets

The workflow uses the committed public Canton topology in `scripts/config/cantonPublic.ts`. Secrets only need to provide
OAuth client secrets for the providers:

```text
CANTON_DEVNET_INTELLECT_LEDGER_JSON_API_CLIENT_SECRET
CANTON_DEVNET_5N_LEDGER_JSON_API_CLIENT_SECRET
CANTON_MAINNET_INTELLECT_LEDGER_JSON_API_CLIENT_SECRET
CANTON_MAINNET_5N_LEDGER_JSON_API_CLIENT_SECRET
NPM_TOKEN
```

The older generic names `DEVNET_AUTH_TOKEN` and `MAINNET_AUTH_TOKEN` are not enough for this repo's current client
configuration because the upload script targets both Intellect and 5n provider clients.

## Manual Checks

Before pushing a release tag:

```bash
npx tsx scripts/parse-release-tag.ts OpenCapTable-v34-v0.0.2
npm run build
npm run test
```

After a workflow run, confirm that `dars/dars.lock`, any new `dars/` artifact, and
`generated/ocp-factory-contract-id.json` were committed when they changed.
