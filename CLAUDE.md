# Repository guidance

Read the public wiki before changing contracts or automation:

- [`README.md`](./README.md)
- [Contract architecture](https://github.com/Fairmint/open-captable-protocol-daml/wiki/Contract-Architecture)
- [OCF validation policy](https://github.com/Fairmint/open-captable-protocol-daml/wiki/OCF-Validation-Policy)
- [Development and testing](https://github.com/Fairmint/open-captable-protocol-daml/wiki/Development-and-Testing)
- [DAR backup and release policy](https://github.com/Fairmint/open-captable-protocol-daml/wiki/DAR-Backup)

Keep repository guidance synchronized with the code:

- Treat `multi-package.yaml`, the active `OpenCapTable-v*/daml.yaml`, `package.json`, and the
  implementation in `scripts/` as the current source of truth. Do not copy versions or dependency
  lists into prose.
- Run `npm run build` and `npm test` for contract changes. Also run `npm run lint:daml`,
  `npm run check-upgrade-compat`, `npm run codegen`, and `npm run verify-package` when DAML source,
  upgrade compatibility, generated bindings, or the npm surface may change.
- For DAR backup or release metadata changes, run the applicable policy checks from `package.json`,
  including `npm run check:dar-version-policy` and `npm run verify-dars`.
- `Fairmint/OpenCapTable/CapTable.daml` is generated and gitignored. Change
  `scripts/codegen/generate-captable.ts`, its configuration, or its templates instead, then
  regenerate through the repository scripts.
- Validate protocol behavior against the official OCF schema, `scripts/schema-gap-checker/`, and
  `Test/daml/OpenCapTable/`. Do not add Fairmint-specific requirements to OCF data validity.
