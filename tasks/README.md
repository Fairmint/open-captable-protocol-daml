# Task & ADR Index

**Maintain this file** when creating, completing, or modifying tasks and ADRs.

## Open Tasks

| Task                                                                                                 | Date       | Summary                                                        |
| ---------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------- |
| [Security ID Validation](./2026/01/2026.01.21-security-id-validation.md)                             | 2026-01-21 | Add security_id validation for tier 4 transactions             |
| [Types Module Splitting](./2026/01/2026.01.21-types-module-splitting.md)                             | 2026-01-21 | Split large Types.daml into domain-focused modules             |
| [Test Helper Functions](./2026/01/2026.01.21-test-helper-functions.md)                               | 2026-01-21 | Create reusable test helpers to reduce boilerplate             |
| [Package Upgrade Directory Generation](./2026/01/2026.01.15-package-upgrade-directory-generation.md) | 2026-01-15 | Generate versioned directories at build time for cleaner diffs |
| [GitHub Tag Release Process](./2026/01/2026.01.15-github-tag-release-process.md)                     | 2026-01-15 | Automate releases via Git tags with CI deployments             |

## Completed Tasks

| Task                                                                                             | Date       | Summary                                                                  |
| ------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------ |
| [Validator Naming Consistency](./2026/01/2026.01.21-validator-naming-consistency.md)             | 2026-01-22 | Standardize validator function naming patterns                           |
| [DAML Linting](./2026/01/2026.01.13-daml-linting.md)                                             | 2026-01-16 | Add `daml lint` to CI for DAML code quality                              |
| [OCF Schema Field Completeness](./2026/01/2026.01.15-ocf-schema-field-completeness.md)           | 2026-01-15 | Add missing `option_grant_type` and fix `initial_shares_authorized` type |
| [dpm Migration](./2026/01/2026.01.13-dpm-migration.md)                                           | 2026-01-13 | Migrate from deprecated `daml` CLI to `dpm`                              |
| [Canton 3.4 Upgrade](./2026/01/2026.01.12-canton-3.4-upgrade.md)                                 | 2026-01-12 | Upgrade DAML SDK from 3.3 to Canton 3.4.10                               |
| [Contract Generation Templates](./2026/01/2026.01.12-contract-generation-templates.md)           | 2026-01-12 | Replace string building with template files for reviewable codegen       |
| [CouponMinter Contract](./2026/01/2026.01.12-couponminter-contract-design.md)                    | 2026-01-12 | DAML implementation per ADR-004                                          |
| [DAR File Backup System](./2026/01/2026.01.09-dar-file-backup-system.md)                         | 2026-01-09 | Preserve mainnet DARs with Git LFS and integrity checks                  |
| [Batch CapTable App Rewards](./2026/01/2026.01.08-batch-captable-app-rewards.md)                 | 2026-01-08 | Add `appRewards` param to batch `UpdateCapTable`                         |
| [TypeScript Strict Typing](./2026/01/2026.01.07-typescript-strict-typing.md)                     | 2026-01-07 | Eliminated all `any` types in scripts                                    |
| [Stateful CapTable](./2026/01/2026.01.05-stateful-captable-with-position-tracking.md)            | 2026-01-05 | Implemented ADR-002: CapTable with O(1) lookups                          |
| [Complete DAML Implementation](./2025/12/2025.12.17-milestone-1-complete-daml-implementation.md) | 2025-12-17 | 100% OCF type coverage (48/48 objects)                                   |

## Architecture Decision Records

| ADR     | Title                                           | Status      | Location                                                                                                     |
| ------- | ----------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| ADR-001 | OCF Cap Table on Canton                         | Accepted    | [canton repo](https://github.com/fairmint/canton/blob/main/docs/developer/adr/001-ocf-captable-on-canton.md) |
| ADR-002 | Stateful Cap Table with OCF Object References   | Implemented | [docs/adr/002](../docs/adr/002-stateful-issuer-with-position-tracking.md)                                    |
| ADR-003 | Value-Based Coupon Minting for OCP Transactions | Implemented | [docs/adr/003](../docs/adr/003-featured-app-markers-for-ocp-transactions.md)                                 |
| ADR-004 | CouponMinter Contract                           | Implemented | [docs/adr/004](../docs/adr/004-couponminter-contract.md)                                                     |

## Task File Naming

```
tasks/YYYY/MM/YYYY.MM.DD-short-description.md
```

## Task Status Values

- **Open** — Not started or in progress
- **Completed** — Done (move to Completed section)
- **Cancelled** — No longer relevant (remove or archive)
