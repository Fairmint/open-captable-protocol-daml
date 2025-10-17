## Shared Coding Guidelines for OCP DAML Packages

This repository contains multiple DAML packages (e.g., `OpenCapTable-v25`, `OpenCapTableReports-v01`, `OpenCapTableProofOfOwnership-v01`, `Shared`, `CantonPayments`). This document defines coding guidelines that apply to all packages.

For package-specific details about each implementation, see the README.md file in the respective package directory (e.g., `open-captable-protocol-daml/OpenCapTable-v25/README.md`).

### Global exceptions

- We use DAML `Time` instead of schema `Date` (schema excludes time) as a workaround for a JavaScript parsing issue.

### Implementation guidance
 
- **Non-empty Text values**:
  - Never allow empty `Text` strings. For `Optional Text`, if provided (`Some t`), ensure `t /= ""`.
  - For arrays of `Text`, validate each element is non-empty.
- **Arrays are non-optional**: Do not omit array fields. When there are no items, emit an empty array (`[]`) instead of leaving the field out.
- **Avoid trivial type aliases**: Do not create semantic aliases for native types (e.g., `type OcfMd5 = Text`). Prefer native types with validators. Example:

```daml
-- MD5
-- OCF: https://raw.githubusercontent.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF/main/schema/types/Md5.schema.json
validateOcfMd5 : Text -> Bool
validateOcfMd5 md5 =
  let n = Text.length md5 in
  n == 32 && CryptoText.isHex md5
```
- **Shared types and organization**:
  - Define any type used by more than one template in `Types.daml` (with its validator) and import where needed.
  - Keep template files focused; if a type is only used by a single template, define it in that template file.
  - Do not import a template module solely to access a type; move that type to `Types.daml` instead.
  - Within each record, maintain field ordering for readability:
    1) `id` first
    2) Required scalar fields (alphabetical)
    3) Arrays (alphabetical)
    4) Optional fields (alphabetical)
  - This ordering applies to all types/records (not only top-level transaction objects). If a record does not have an `id`, skip step 1 and still follow required → arrays → optional with alphabetical ordering within each group.
  - Required refers to types which are not `Optional` or an array. Keep the groups strict and correct.
  - Use short section headers and separators to denote these groups exactly as:
    - `-- Required fields (alphabetical)`
    - `-- ---------------------------------`
    - `-- Arrays (alphabetical)`
    - `-- ---------------------------------`
    - `-- Optional fields (alphabetical)`
    - `-- ---------------------------------`
 - **Declaration order in template files**: Place declarations in this order within each template file: 1) `template` block first, 2) top-level `data` (the main object record), 3) subtype `data` (helper or nested records specific to the template). Keep the two data definitions adjacent.
- **Validator placement**: Define the validator immediately after the corresponding `data` type it validates, in the same file. Example:

```daml
data OcfThing = OcfThing with field: Text deriving (Eq, Show)

validateOcfThing : OcfThing -> Bool
validateOcfThing t = t.field /= ""
```
- **Test helpers**: Place test helpers only in the `Test` package, never in main packages.

- **Choice ordering in templates**: When there is no clear logical lifecycle ordering, sort choice declarations alphabetically by choice name. As a convention, place create-style choices before archive-style choices (e.g., put `ArchiveByIssuer` last).

### Package-specific guidance

Each package may include additional constraints and domain guidance. Refer to:

- `open-captable-protocol-daml/OpenCapTable-v25/README.md` for Open Cap Table specifics (e.g., Issuer management patterns).
- Other package READMEs as applicable.

## Adding Support for New Packages

When adding a new DAML package to this repository (e.g., `NewPackage-v01`), follow these steps to ensure full integration with the build, deployment, and publishing pipeline:

### 1. Create the Package Directory

Create a new directory at the root level with your package name and version (e.g., `NewPackage-v01/`).

### 2. Set Up Package Structure

- Create `daml.yaml` with proper configuration
- Add your DAML modules under `daml/` directory
- Create a package-specific `README.md` documenting the package purpose and usage

### 3. Update Build Scripts

Update the following files to include your new package:

#### `package.json`
- **codegen script**: Add codegen step for your package in the `codegen` script
  ```
  cd NewPackage-v01 && daml codegen js && cd ..
  ```
- **upload-dar script**: Add new script for uploading DAR files
  ```json
  "upload-dar:newpackage": "npm run build && ts-node scripts/upload-dar-newpackage.ts --network devnet && ts-node scripts/upload-dar-newpackage.ts --network mainnet"
  ```
- **create-factory script**: Add new script for creating factory contracts
  ```json
  "create-factory:newpackage": "npm run codegen && ts-node scripts/create-newpackage-factory.ts --network devnet && ts-node scripts/create-newpackage-factory.ts --network mainnet"
  ```
- **upload-and-create script**: Add combined script
  ```json
  "upload-and-create:newpackage": "npm run upload-dar:newpackage && npm run create-factory:newpackage"
  ```
- **exports**: Add export for factory contract ID JSON
  ```json
  "./newpackage-factory-contract-id.json": {
    "types": "./generated/newpackage-factory-contract-id.json.d.ts",
    "default": "./generated/newpackage-factory-contract-id.json"
  }
  ```
- **files**: Add generated files to the npm package
  ```json
  "generated/newpackage-factory-contract-id.json",
  "generated/newpackage-factory-contract-id.json.d.ts"
  ```
- **typesVersions**: Add type definitions for JSON imports
  ```json
  "newpackage-factory-contract-id.json": [
    "generated/newpackage-factory-contract-id.json.d.ts"
  ]
  ```

#### `scripts/bundle-dependencies.ts`
Add your package directory to the `PACKAGE_DIRS` array:
```typescript
const PACKAGE_DIRS = [
  path.join(__dirname, '../generated/js/OpenCapTable-v25-0.0.1'),
  path.join(__dirname, '../generated/js/OpenCapTableReports-v01-0.0.2'),
  path.join(__dirname, '../generated/js/NewPackage-v01-0.0.1'),
];
```

#### `scripts/create-package-index.ts`
Add your package directory to the `packageDirs` array:
```typescript
const packageDirs = [
  path.join(__dirname, '..', 'generated', 'js', 'OpenCapTable-v25-0.0.1'),
  path.join(__dirname, '..', 'generated', 'js', 'OpenCapTableReports-v01-0.0.2'),
  path.join(__dirname, '..', 'generated', 'js', 'NewPackage-v01-0.0.1'),
];
```

#### `scripts/create-root-index.ts`
1. Add constants for your package directories:
   ```typescript
   const NEWPACKAGE_DIR = path.join(ROOT_DIR, 'generated', 'js', 'NewPackage-v01-0.0.1');
   const NEWPACKAGE_LIB = path.join(NEWPACKAGE_DIR, 'lib');
   ```

2. Copy your package namespace in `buildCombinedLib()`:
   ```typescript
   copyDir(path.join(NEWPACKAGE_LIB, 'Fairmint', 'NewPackage'), path.join(destFairmint, 'NewPackage'));
   ```

3. Update Fairmint index files to export your namespace:
   ```typescript
   // In index.js:
   var NewPackage = require('./NewPackage');
   exports.NewPackage = NewPackage;
   
   // In index.d.ts:
   export * as NewPackage from './NewPackage';
   ```

4. Add JSON type definition in `ensureJsonDts()`:
   ```typescript
   ensureJson(
     path.join(ROOT_DIR, 'generated', 'newpackage-factory-contract-id.json'),
     path.join(ROOT_DIR, 'generated', 'newpackage-factory-contract-id.json.d.ts'),
     `declare const data: {\n    devnet: {\n        newpackageFactoryContractId: string;\n        templateId: string;\n    };\n    mainnet: {\n        newpackageFactoryContractId: string;\n        templateId: string;\n    };\n};\nexport default data;\n`
   );
   ```

### 4. Create Deployment Scripts

Create two new scripts in the `scripts/` directory:

#### `scripts/upload-dar-newpackage.ts`
Upload the DAR file to both devnet and mainnet. Use existing scripts as templates (e.g., `upload-dar-reports.ts`).

Key elements:
- Parse `--network` argument
- Upload to both `intellect` and `5n` providers
- Point to correct DAR file path: `NewPackage-v01/.daml/dist/NewPackage-v01-{version}.dar`

#### `scripts/create-newpackage-factory.ts`
Create factory contract on both networks. Use existing factory scripts as templates.

Key elements:
- Import generated DAML types from `../lib`
- Create factory contract with appropriate arguments
- Save contract ID to `generated/newpackage-factory-contract-id.json`
- Include proper error handling and network argument parsing

### 5. Test the Integration

1. Build DAML packages:
   ```bash
   npm run build
   ```

2. Generate JavaScript bindings:
   ```bash
   npm run codegen
   ```

3. Verify generated files exist in `lib/Fairmint/NewPackage/`

4. Test deployment scripts:
   ```bash
   npm run upload-and-create:newpackage
   ```

### 6. Update Documentation

- Add package to the list in this README's introduction
- Create package-specific README with domain guidance
- Document any new contract templates and their usage


