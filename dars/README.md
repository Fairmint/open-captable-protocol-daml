# DAR File Backup System

This directory preserves versioned DAR (DAML Archive) files that have been uploaded to
mainnet/devnet. Since DAML builds are only deterministic when using the exact same compiler version,
we store the exact bytes of published packages here.

## Why We Need This

1. **Package verification** - Canton validates package hashes; rebuilt packages have different
   hashes
2. **Reproducibility** - Ensures we can always redeploy the exact same artifact
3. **Rollback safety** - Allows redeploying a known-good version if needed

## Directory Structure

```
dars/
├── README.md                          # This file
├── dars.lock                          # Hash manifest for CI verification
├── OpenCapTable-v27/
│   └── 0.0.1/
│       └── OpenCapTable-v27.dar       # Backed-up DAR file
├── OpenCapTableReports-v01/
│   └── 0.0.2/
│       └── OpenCapTableReports-v01.dar
└── CantonPayments/
    └── 0.0.30/
        └── CantonPayments.dar
```

## Using the Backup System

### After a Successful Upload

Back up the DAR file after uploading to mainnet:

```bash
npm run backup-dar -- --package OpenCapTable-v27 --version 0.0.1
```

This will:

1. Copy the DAR from `.daml/dist/` to `dars/{package}/{version}/`
2. Compute and store the SHA256 hash in `dars.lock`
3. Fail if the DAR already exists (prevents accidental overwrites)

### Verifying DAR Integrity

Check that all DAR files match their recorded hashes:

```bash
npm run verify-dars
```

### CI Integration

The CI workflow automatically:

1. Verifies all DAR hashes match `dars.lock`
2. Fails PRs that modify DAR files without updating `dars.lock`

## dars.lock Format

The `dars.lock` file contains SHA256 hashes and metadata for all backed-up DARs:

```json
{
  "version": 1,
  "packages": {
    "OpenCapTable-v27/0.0.1/OpenCapTable-v27.dar": {
      "sha256": "abc123...",
      "size": 12345,
      "sdkVersion": "3.3.0-snapshot.20250603.0",
      "uploadedAt": "2026-01-09T12:00:00Z",
      "networks": ["mainnet", "devnet"]
    }
  }
}
```

## Git LFS

DAR files are stored using Git LFS to keep the repository performant. The `.gitattributes` file
configures this automatically.

## Modifying DARs

**Never modify a DAR file directly.** If you need to deploy a new version:

1. Update the DAML source code
2. Bump the version in `daml.yaml`
3. Build and upload the new version
4. Back up the new DAR with `npm run backup-dar`

The CI will reject any PR that modifies existing DAR files without a corresponding version bump.

## Troubleshooting

### "DAR already exists" error

If you see this error when running `backup-dar`, it means the DAR for that package/version already
exists. This is intentional—we never overwrite backed-up DARs. If you need to deploy changes, bump
the version number.

### "Hash mismatch" error in CI

This means a DAR file has been modified without updating `dars.lock`. Either:

1. Restore the original DAR file
2. If intentional, update `dars.lock` with `npm run verify-dars -- --update`

### Git LFS not working

Make sure Git LFS is installed and initialized:

```bash
git lfs install
git lfs pull
```

## References

- [Splice DAR storage](https://github.com/hyperledger-labs/splice/tree/main/daml/dars) - Inspiration
  for this system
- [Git LFS documentation](https://git-lfs.github.com/)
