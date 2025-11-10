# DAML Package Upgrade Script

This directory contains scripts for managing DAML package versions.

## upgrade-package.ts

Automates the process of upgrading DAML package versions, supporting both major and minor version bumps.

### Usage

```bash
npm run upgrade-package -- --package <name> --type <major|minor>
```

### Parameters

- `--package <name>`: The base name of the package (e.g., `Subscriptions`, `OpenCapTable`)
- `--type <major|minor>`: The type of upgrade to perform

### Major Upgrade

A major upgrade increments the major version number and resets the semantic version to `0.0.1`.

**Example:**
```bash
npm run upgrade-package -- --package Subscriptions --type major
```

**What it does:**
1. Renames folder: `CantonPayments/` → `CantonPayments/`
2. Updates `daml.yaml`:
   - `name`: `CantonPayments` → `CantonPayments`
   - `version`: `0.2.3` → `0.0.1`
3. Searches and replaces across all files:
   - `CantonPayments-0.2.3` → `CantonPayments-0.0.19`
   - `CantonPayments` → `CantonPayments`
4. Updates references in:
   - `daml.yaml` files
   - TypeScript files (`.ts`)
   - Markdown files (`.md`)
   - JSON files (`.json`)
   - DAML files (`.daml`)
   - `multi-package.yaml`

### Minor Upgrade

A minor upgrade increments the patch version (the last number in the semantic version).

**Example:**
```bash
npm run upgrade-package -- --package Subscriptions --type minor
```

**What it does:**
1. Reads current version from `<package>/daml.yaml` (e.g., `0.2.3`)
2. Increments patch version: `0.2.3` → `0.2.4`
3. Updates `daml.yaml` with the new version
4. Searches and replaces across all files:
   - `CantonPayments-0.2.3` → `CantonPayments-0.2.4`

### Files Modified

The script automatically updates references in:
- `<package>/daml.yaml`
- `multi-package.yaml`
- All TypeScript scripts in `scripts/`
- README.md files
- Any other files referencing the package version

### Safety Features

- Checks if target folder already exists (for major upgrades)
- Validates package folder format
- Validates version format in `daml.yaml`
- Provides detailed output of all changes made
- Skips build directories (`node_modules`, `.daml`, `lib`, `generated`)

### Post-Upgrade Steps

After running the script, you should:

1. **Review changes:**
   ```bash
   git diff
   ```

2. **Build the package:**
   ```bash
   cd <package-folder> && daml build
   ```

3. **Test the changes:**
   ```bash
   npm test
   ```

4. **Commit the changes:**
   ```bash
   git add -A
   git commit -m "Upgrade <package> to <new-version>"
   ```

### Examples

**Upgrade Subscriptions from v07 to v08:**
```bash
npm run upgrade-package -- --package Subscriptions --type major
# Output: CantonPayments (0.2.3) → CantonPayments (0.0.1)
```

**Bump Subscriptions patch version:**
```bash
npm run upgrade-package -- --package Subscriptions --type minor
# Output: CantonPayments (0.2.3) → CantonPayments (0.2.4)
```

**Upgrade OpenCapTable from v25 to v26:**
```bash
npm run upgrade-package -- --package OpenCapTable --type major
# Output: OpenCapTable-v25 (x.y.z) → OpenCapTable-v26 (0.0.1)
```

### Troubleshooting

**Error: "Package folder not found"**
- Ensure the package name matches a folder in the repository (e.g., `Subscriptions`, not `CantonPayments`)
- Check that the folder follows the pattern `<PackageName>-v<NN>`

**Error: "Target folder already exists"**
- The target version folder already exists. Either remove it or use a different version.

**Error: "Invalid version format"**
- The version in `daml.yaml` should follow semantic versioning: `X.Y.Z`

