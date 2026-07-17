# Development, testing, and releases

Repository scripts are the executable source of truth for development and release operations. This
page explains how the pieces fit together without duplicating every script argument.

## Set up a checkout

The repository uses a pinned Splice submodule and the DAML Package Manager (`dpm`):

```bash
git submodule update --init --recursive
npm install
scripts/install-dpm-sdks.sh
```

`scripts/install-dpm-sdks.sh` reads the package manifests and installs the required SDK versions.
Use the npm commands from the repository root so multi-package dependencies and code generation run
consistently with CI.

## Build and test

```bash
npm run build
npm test
```

`npm run build` regenerates the aggregate `CapTable.daml` before building all active packages.
`npm test` runs the DAML Script suite. Specialized local checks are indexed in
[`package.json`](../package.json); important change-dependent checks include:

```bash
npm run lint:daml
npm run check-upgrade-compat
npm run codegen
npm run verify-package
```

The protected OCF replay path and cross-participant traffic checks have separate scripts and a
manual GitHub Actions workflow. Read
[`replay-ocf-database.yml`](../.github/workflows/replay-ocf-database.yml) and the corresponding
TypeScript scripts for their exact inputs, secrets boundary, and artifacts.

## Generated and packaged artifacts

- `OpenCapTable-v*/daml/Fairmint/OpenCapTable/CapTable.daml` is generated from OCF modules, config,
  and templates and is intentionally gitignored.
- `generated/js/` and `lib/` are generated JavaScript bindings and the merged npm surface.
- `published-dars/OpenCapTable.dar` is staged during package preparation for the npm DAR export.
- `generated/ocp-factory-contract-id.json` is the reviewed deployment-metadata export.
- `dars/` plus `dars/dars.lock` record backed-up DAR bytes and integrity metadata.

Change the source or generator, then rerun the owning command. Do not hand-edit generated output to
make a check pass.

## Package upgrades and releases

The active DAML package name and version come from its `daml.yaml`; the npm package version comes
from `package.json`. They serve different compatibility domains and need not match. Never infer the
deployed package solely from a directory name or npm version: inspect `dars/dars.lock` and the
deployment tags used by the workflows.

The package-scoped [`release.yml`](../.github/workflows/release.yml) flow is policy-driven:

1. Prepare and review the package/source version change.
2. Build, test, lint, check upgrade compatibility, generate bindings, and verify the npm surface.
3. Back up the selected DAR and verify `dars.lock` integrity and version policy.
4. Upload only through the guarded workflow or repository script for the selected network.
5. Record successful network deployment with the package-scoped deployment tag.
6. Publish the npm package only after its workflow gates are satisfied.

The repository also has a separate [`publish.yml`](../.github/workflows/publish.yml) npm path. It
runs on pushes to `main` and by manual dispatch, then builds, generates bindings, prepares the npm
artifact, publishes it, and creates an npm-version tag. It does not run the DAR version, upload, or
deployment-tag gates above, so its success is not evidence that a DAR was deployed. Account for both
workflows when changing package versions or release policy until the paths are consolidated.

The exact policy is implemented in [`scripts/`](../scripts/) and the two workflows above. Use
`npm run verify-dars` and `npm run check:dar-version-policy` for DAR changes. Major package-line
upgrades require an explicit design decision because they create a new DAML upgrade lineage; do not
start one as a routine version bump.
