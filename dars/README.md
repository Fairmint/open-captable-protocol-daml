# Backed-up DARs (`dars/`)

This tree holds **immutable copies** of built DARs that were uploaded (or are candidates for upload) to Canton networks, plus `dars.lock` for integrity checks (`npm run verify-dars`, CI).

## Keep previous versions

When you **bump** a package version (e.g. `Shared` `0.0.5` → `0.0.6`):

1. **Add** the new backup under `dars/<Package>/<newVersion>/` via `npm run backup-dar` (and ensure `dars.lock` is updated).
2. **Do not delete** older `dars/<Package>/<oldVersion>/` directories that were already committed, unless you have an explicit archival process elsewhere.

Older DARs are small compared to the cost of **not** having them when you need to diff hashes, re-upload, debug vetting, or reference what was on-chain historically.

## Layout

- `dars/<PackageName>/<semver>/<PackageName>.dar` — one DAR per backed-up version.
- `dars.lock` — SHA-256, size, SDK version, upload metadata per path.

## Related commands

- `npm run backup-dar -- --package <key> --version <semver>` — copy from `.daml/dist/` into `dars/` and update the lock (see `scripts/packages.ts` for keys).
- `npm run upload-dar -- --package <key> --network devnet|mainnet` — upload the **current** backed-up DAR for that package (see script for provider behavior).
- `npm run verify-dars` — confirm every file under `dars/` matches `dars.lock`.

If this policy is duplicated on the team wiki, keep it in sync with this file.
