# Repository guidance

Read the public wiki before changing contracts or automation:

- [`README.md`](./README.md)
- [Contract architecture](https://github.com/Fairmint/open-captable-protocol-daml/wiki/Contract-Architecture)
- [OCF validation policy](https://github.com/Fairmint/open-captable-protocol-daml/wiki/OCF-Validation-Policy)
- [Development and testing](https://github.com/Fairmint/open-captable-protocol-daml/wiki/Development-and-Testing)
- [DAR backup and release policy](https://github.com/Fairmint/open-captable-protocol-daml/wiki/DAR-Backup)

Keep repository guidance synchronized with the code:

- The packages are `OpenCapTable-v35` (the register,
  [ADR-040](https://github.com/Fairmint/dev-docs/blob/main/adrs/ADR-040-OCP-v35-Unbounded-Cap-Table.md)),
  `OpenCapTableApi-v01` (reader interfaces) and `OpenCapTableDeliveryProof-v01`, which v35
  data-depends on and embeds, plus `Test`. v35 targets DevNet only; keep MainNet steps gated off.
- Treat `multi-package.yaml`, each package's `daml.yaml`, `package.json`, `daml-js-bundle.json`, and
  the remaining OCP-specific implementation in `scripts/` as the current source of truth. Shared
  DAML tooling lives in `@fairmint/canton-dev-tools`. Do not copy versions or dependency lists into
  prose.
- Run `npm run build` and `npm test` for contract changes. Also run `npm run lint:daml`,
  `npm run check-upgrade-compat`, `npm run codegen`, and `npm run verify-package` when DAML source,
  upgrade compatibility, generated bindings, or the npm surface may change.
- For DAR backup or release metadata changes, run the applicable policy checks from `package.json`,
  including `npm run check:dar-version-policy` and `npm run verify-dars`.
- `Fairmint/OpenCapTable/OcfRecords.daml` is generated and gitignored; `CapTable.daml` (the anchor)
  is hand-written. Change `scripts/codegen/generate-captable.ts` or its template instead, then
  regenerate through the repository scripts (`npm run generate-captable` / `npm run build`).
- Builds run from `generated/build/` via `canton-dev-tools prepare-build`. Keep source
  `Test/daml.yaml` sibling-relative paths; prepare-build rewrites them for the generated tree.
- `npm run codegen` uses CDT `codegen-js` → `bundle-dependencies` → `create-root-index` →
  `scripts/bundle-local-packages.ts` (bundles the two sibling packages into `lib/`) →
  `fix-splice-refs`, then DAR staging (`stage-npm-opencaptable-dar`, all three DARs) and npm-runtime
  lib. The root entry points are `OCP_TEMPLATES`, `OCP_INTERFACES` and
  `OCP_DELIVERY_PROOF_TEMPLATES` (`daml-js-bundle.json`).
- Validate protocol behavior against the official OCF schema, `scripts/schema-gap-checker/`, and
  `Test/daml/OpenCapTable/`. Do not add Fairmint-specific requirements to OCF data validity. The one
  Fairmint OCF extension, the hold pair, lives in `ocf-extension/` and the checker's registry.
- `test-vectors/v35.json` (derived IDs, claim hashes, floor function) is shared with the SDK and
  apiv2. `Test/daml/OpenCapTable/TestVectors.daml` asserts the same values, copied by hand, so
  change the two together.
