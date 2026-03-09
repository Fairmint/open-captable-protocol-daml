# DAML Package Upgrade Script

This directory contains scripts for managing DAML package versions.

## upgrade-package.ts

Automates the process of upgrading DAML package versions, supporting both major and minor version
bumps.

### Usage

```bash
npm run upgrade-package -- --package <name> --type <major|minor>
```

### Parameters

- `--package <name>`: The base name of the package (e.g., `OpenCapTable`, `CantonPayments`)
- `--type <major|minor>`: The type of upgrade to perform

### Major Upgrade

A major upgrade increments the major version number and resets the semantic version to `0.0.1`.

**Example:**

```bash
npm run upgrade-package -- --package OpenCapTable --type major
```

**What it does:**

1. Renames folder: `ExamplePackage-v01/` → `ExamplePackage-v02/`
2. Updates `daml.yaml`:
   - `name`: `ExamplePackage-v01` → `ExamplePackage-v02`
   - `version`: `0.2.3` → `0.0.1`
3. Searches and replaces across all files:
   - `ExamplePackage-v01-0.2.3` → `ExamplePackage-v02-0.0.1`
   - `ExamplePackage-v01` → `ExamplePackage-v02`
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
npm run upgrade-package -- --package OpenCapTable --type minor
```

**What it does:**

1. Reads current version from `<package>/daml.yaml` (e.g., `0.2.3`)
2. Increments patch version: `0.2.3` → `0.2.4`
3. Updates `daml.yaml` with the new version
4. Searches and replaces across all files:
   - `ExamplePackage-0.2.3` → `ExamplePackage-0.2.4`

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

2. **Build the packages (repo standard):**

   ```bash
   npm run build
   # Optional package-scoped check:
   # cd <package-folder> && PATH="$HOME/.dpm/bin:$PATH" dpm build
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

**Generic major upgrade:**

```bash
npm run upgrade-package -- --package <PackageName> --type major
# Output: <PackageName>-vNN (x.y.z) → <PackageName>-v(NN+1) (0.0.1)
```

**Generic minor (patch) upgrade:**

```bash
npm run upgrade-package -- --package <PackageName> --type minor
# Output: <PackageName>-vNN (x.y.z) → <PackageName>-vNN (x.y.(z+1))
```

**Upgrade OpenCapTable major version (current baseline example):**

```bash
npm run upgrade-package -- --package OpenCapTable --type major
# Output: OpenCapTable-v32 (x.y.z) → OpenCapTable-v33 (0.0.1)
```

### Troubleshooting

**Error: "Package folder not found"**

- Ensure the package name is the base package name (e.g., `OpenCapTable`), not the full versioned
  folder name (e.g., `OpenCapTable-v32`)
- Check that the folder follows the pattern `<PackageName>-v<NN>`

**Error: "Target folder already exists"**

- The target version folder already exists. Either remove it or use a different version.

**Error: "Invalid version format"**

- The version in `daml.yaml` should follow semantic versioning: `X.Y.Z`
