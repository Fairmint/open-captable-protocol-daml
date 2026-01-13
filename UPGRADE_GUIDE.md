# DAML Package Upgrade Guide

Quick reference for upgrading DAML packages in this repository.

## Quick Commands

### Major Version Upgrade (v07 → v08)

```bash
npm run upgrade-package -- --package Subscriptions --type major
```

### Minor Version Upgrade (0.0.1 → 0.0.2)

```bash
npm run upgrade-package -- --package Subscriptions --type minor
```

## What Gets Changed

### Major Upgrade

- ✅ Folder renamed (e.g., `CantonPayments/` → `CantonPayments/`)
- ✅ Package name updated in `daml.yaml`
- ✅ Version reset to `0.0.1` in `daml.yaml`
- ✅ All file references updated across the repository
- ✅ `multi-package.yaml` updated

### Minor Upgrade

- ✅ Version incremented in `daml.yaml` (e.g., `0.0.1` → `0.0.2`)
- ✅ All version references updated across the repository

## Available Packages

Current packages that can be upgraded:

- `Subscriptions` (currently at `CantonPayments`)
- `OpenCapTable` (currently at `OpenCapTable-v26`)
- `OpenCapTableReports` (currently at `OpenCapTableReports-v01`)
- `OpenCapTableProofOfOwnership` (currently at `OpenCapTableProofOfOwnership-v01`)
- `Shared` (no version suffix)

## Workflow

1. **Run the upgrade script:**

   ```bash
   npm run upgrade-package -- --package <name> --type <major|minor>
   ```

2. **Review the changes:**

   ```bash
   git status
   git diff
   ```

3. **Build and test:**

   ```bash
   cd <package-folder>
   daml build
   cd ..
   npm test
   ```

4. **Commit the changes:**
   ```bash
   git add -A
   git commit -m "Upgrade <package> to <new-version>"
   ```

## Examples

### Example 1: Major Upgrade

```bash
# Before: CantonPayments (version 0.2.3)
npm run upgrade-package -- --package Subscriptions --type major
# After: CantonPayments (version 0.0.1)
```

Files changed:

- `CantonPayments/` → `CantonPayments/`
- `CantonPayments/daml.yaml` (name and version fields)
- `multi-package.yaml`
- All scripts referencing `CantonPayments`
- README files
- Test files

### Example 2: Minor Upgrade

```bash
# Before: CantonPayments (version 0.2.3)
npm run upgrade-package -- --package Subscriptions --type minor
# After: CantonPayments (version 0.2.4)
```

Files changed:

- `CantonPayments/daml.yaml` (version field only)
- Any files with hardcoded version strings

## Script Details

See [scripts/README.md](./scripts/README.md) for full documentation of the upgrade script.

## Notes

- The script skips `node_modules`, `.daml`, `lib`, and `generated` directories
- All changes are made to source files only
- The script validates folder and version formats before making changes
- Review all changes with `git diff` before committing
