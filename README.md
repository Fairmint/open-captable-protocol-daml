# Open Cap Table Protocol DAML

This repository implements the
[Open Cap Format (OCF)](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF) as DAML
contracts for Canton. It also publishes generated JavaScript bindings and the built OpenCapTable DAR
as
[`@fairmint/open-captable-protocol-daml-js`](https://www.npmjs.com/package/@fairmint/open-captable-protocol-daml-js).

## Install and use the package

```bash
npm install @fairmint/open-captable-protocol-daml-js
```

The browser-safe root entry point exports the generated OpenCapTable namespace, bundled DAML/Splice
dependencies, and the three entry-point template IDs:

```ts
import { Fairmint, OCP_TEMPLATES } from '@fairmint/open-captable-protocol-daml-js';

const { OpenCapTable } = Fairmint;
const capTableTemplateId = OCP_TEMPLATES.capTable;
```

The package also exposes stable subpaths for deployment metadata and the DAR:

```ts
import factoryIds from '@fairmint/open-captable-protocol-daml-js/ocp-factory-contract-id.json';
import {
  getOpenCapTableDarPath,
  resolveOpenCapTableDarPath,
} from '@fairmint/open-captable-protocol-daml-js/openCapTableDarPath';
```

The DAR itself is exported at `@fairmint/open-captable-protocol-daml-js/opencaptable.dar`. Check
[`package.json`](https://github.com/Fairmint/open-captable-protocol-daml/blob/main/package.json) for
the complete export map and
[`scripts/test-imports.ts`](https://github.com/Fairmint/open-captable-protocol-daml/blob/main/scripts/test-imports.ts)
for the executable package-surface contract. `resolveOpenCapTableDarPath` checks
`OPEN_CAP_TABLE_DAR_PATH`, then the packaged DAR, then optional local-checkout paths; see its
[`source and options`](https://github.com/Fairmint/open-captable-protocol-daml/blob/main/scripts/npm-published-lib/openCapTableDarPath.ts)
for exact resolution behavior.

## Public documentation

The public [GitHub wiki](https://github.com/Fairmint/open-captable-protocol-daml/wiki) is the
canonical guide for contract architecture, OCF validation, development, testing, DAR backup, and
release policy. The active package's
[`daml.yaml`](https://github.com/Fairmint/open-captable-protocol-daml/blob/main/OpenCapTable-v34/daml.yaml),
[`multi-package.yaml`](https://github.com/Fairmint/open-captable-protocol-daml/blob/main/multi-package.yaml),
[`package.json`](https://github.com/Fairmint/open-captable-protocol-daml/blob/main/package.json),
and [`scripts/`](https://github.com/Fairmint/open-captable-protocol-daml/tree/main/scripts) remain
the source of truth for current versions, dependencies, and automation.

## Build and validate

```bash
git submodule update --init --recursive
npm install
scripts/install-dpm-sdks.sh
npm run build
npm test
```

When generated bindings or the published npm surface are affected, also run:

```bash
npm run codegen
npm run verify-package
```

See
[Development and Testing](https://github.com/Fairmint/open-captable-protocol-daml/wiki/Development-and-Testing)
for the generated-file boundary and specialized checks.
