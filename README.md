# Open Cap Table Protocol DAML

This repository implements the
[Open Cap Format (OCF)](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF) as DAML
contracts for Canton. It also publishes generated JavaScript bindings and the built DARs as
[`@fairmint/open-captable-protocol-daml-js`](https://www.npmjs.com/package/@fairmint/open-captable-protocol-daml-js).

## Packages

[`multi-package.yaml`](multi-package.yaml) lists the DAML packages:

| Package               | What it holds                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OpenCapTable-v35`    | The register: `OcpFactory`, `IssuerAuthorization`, the `CapTable` anchor, one contract per OCF record, and the `StockSecurity`, `StockClassEpoch` and `OcfIdShard` states |
| `OpenCapTableApi-v01` | The reader interfaces `OcfObject` and `RegisterContract`, whose views hold only builtin types (OCF `object_type` strings), since an interface package is never upgraded   |
| `Test`                | Daml Script tests (not released)                                                                                                                                          |

OpenCapTable-v35 data-depends on `OpenCapTableApi-v01`, embeds it in its DAR and has no Splice
dependency. Its design is
[ADR-040](https://github.com/Fairmint/dev-docs/blob/main/adrs/ADR-040-OCP-v35-Unbounded-Cap-Table.md).
v35 deploys to DevNet only; MainNet is out of scope. Older majors stay in [`dars/`](dars) and in git
history.

Two more directories belong to v35:

- [`ocf-extension/`](ocf-extension) holds the JSON schemas of the one Fairmint OCF extension, the
  hold pair `TX_STOCK_HOLD` / `TX_STOCK_HOLD_CANCELLATION`.
- [`test-vectors/v35.json`](test-vectors/v35.json) holds the derived-ID, claim-hash and
  floor-function vectors that the Daml tests, the SDK and apiv2 must all reproduce.
  `npm run test:vectors` recomputes them and checks the generated `TestVectors.daml`.

## Install and use the package

```bash
npm install @fairmint/open-captable-protocol-daml-js
```

The browser-safe root entry point exports the generated `Fairmint.OpenCapTable` and
`Fairmint.OpenCapTableApi` namespaces, the bundled DAML standard-library types, and the entry-point
IDs:

```ts
import { Fairmint, OCP_INTERFACES, OCP_TEMPLATES } from '@fairmint/open-captable-protocol-daml-js';

OCP_TEMPLATES.capTable; // also ocpFactory, issuerAuthorization, stockSecurity, stockClassEpoch, ocfIdShard
OCP_INTERFACES.ocfObject; // and registerContract: what readers filter by
```

The package also exposes stable subpaths for deployment metadata and the DARs:

```ts
import factories from '@fairmint/open-captable-protocol-daml-js/ocp-factory-contract-id.json';
import {
  getOpenCapTableDarPaths,
  resolveOpenCapTableDarPath,
} from '@fairmint/open-captable-protocol-daml-js/openCapTableDarPath';
```

The v35 `OcpFactory` is consumed by each authorization, so `ocp-factory-contract-id.json` records
each network's factory identity (`templateId`, `system_operator`, `factory_id`), not a contract ID.
Find the live factory with an active-contracts query for that template, filtered on both fields. A
network is absent until its factory is created.

The DARs are exported at `./opencaptable.dar` (OpenCapTable-v35) and `./opencaptable-api.dar`;
`getOpenCapTableDarPaths()` lists both in upload order. Check [`package.json`](package.json) for the
complete export map and [`scripts/test-imports.ts`](scripts/test-imports.ts) for the executable
package-surface contract. `resolveOpenCapTableDarPath` checks `OPEN_CAP_TABLE_DAR_PATH`, then the
packaged DAR, then optional local-checkout paths; see its
[source and options](scripts/npm-published-lib/openCapTableDarPath.ts) for exact resolution
behavior.

## Deployment

Every push to `main` publishes the npm package ([`publish.yml`](.github/workflows/publish.yml)) and
tags the commit `v<npm version>`. Publishing deploys nothing.

The ledger providers accept traffic only from allowlisted IPs, so the DARs are deployed by the
[Deploy OCP to ledger](https://github.com/Fairmint/canton/blob/main/.github/workflows/deploy-ocp-ledger.yml)
workflow of Fairmint/canton, from its allowlisted scripts box. Given an npm version, it:

1. checks out this repository at that version's `v<version>` tag and runs the deployment preflight
   of `npm run check:dar-version-policy` for each DAR, dependency first;
2. uploads and vets the published DARs on both DevNet participants and makes sure the OCP factory
   exists;
3. records each deployment as the annotated tag `dar-deploy/devnet/<package>/v<version>` on that
   commit.

Those tags are the deployment evidence the DAR version policy reads. `record_only` records them for
DARs that are already deployed. Record a factory identity the workflow reports in
[`generated/ocp-factory-contract-id.json`](generated/ocp-factory-contract-id.json).

## Public documentation

The public [GitHub wiki](https://github.com/Fairmint/open-captable-protocol-daml/wiki) is the
canonical guide for contract architecture, OCF validation, development, testing, DAR backup, and
release policy. Each package's `daml.yaml`, [`multi-package.yaml`](multi-package.yaml),
[`package.json`](package.json), and [`scripts/`](scripts) remain the source of truth for current
versions, dependencies, and automation.

## Build and validate

Requires Node.js 22+ (see `@fairmint/canton-dev-tools`).

```bash
npm install
npx canton-dev-tools install-dpm-sdks
npm run build
npm test
```

`npm run build` generates `OpenCapTable-v35/daml/Fairmint/OpenCapTable/OcfRecords.daml` (the OCF
record dispatch, from `scripts/codegen/`), runs `prepare-build` into `generated/build/`, then builds
every package with `dpm`.

When generated bindings or the published npm surface are affected, also run:

```bash
npm run codegen
npm run verify-package
```

`npm run check:schema-gaps` compares the DAML types with the pinned OCF schemas (pass
`--ocf-schema-dir` unless `../ocp-canton-sdk/libs/Open-Cap-Format-OCF` is checked out) and with the
extension in `ocf-extension/`.

The LocalNet OCF replay and cross-participant traffic scripts drove the ledger through
`ocp-canton-sdk`, which does not support v35 yet. They were removed and return with SDK support; the
last versions are in git history, the scripts before `0a15f5c` and the `replay-ocf-database`
workflow, with its `sdk_ref` input, at `7d693fa`.

See
[Development and Testing](https://github.com/Fairmint/open-captable-protocol-daml/wiki/Development-and-Testing)
for the generated-file boundary and specialized checks.
