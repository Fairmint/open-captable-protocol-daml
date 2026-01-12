# Task & ADR Index

**Maintain this file** when creating, completing, or modifying tasks and ADRs.

## Open Tasks

| Task | Date | Summary |
|------|------|---------|
| [CI/CD Optimization](./2026/01/2026.01.07-ci-cd-optimization.md) | 2026-01-07 | Add caching, concurrency controls, consistent Node versions |
| [Code Generation Enhancements](./2026/01/2026.01.07-code-generation-enhancements.md) | 2026-01-07 | Add tests, error handling, validation to CapTable generator |
| [Documentation Improvements](./2026/01/2026.01.07-documentation-improvements.md) | 2026-01-07 | Complete missing ADRs, SDK docs, contribution guide |
| [Test Coverage & Quality](./2026/01/2026.01.07-test-coverage-quality.md) | 2026-01-07 | Coverage thresholds, negative tests, TypeScript tests |
| [Batch CapTable App Rewards](./2026/01/2026.01.08-batch-captable-app-rewards.md) | 2026-01-08 | Add `appRewards` param to batch `UpdateCapTable` |
| [DAR File Backup System](./2026/01/2026.01.09-dar-file-backup-system.md) | 2026-01-09 | Preserve mainnet DARs with Git LFS and integrity checks |
| [Review Marker Creation Logic](./2026/01/2026.01.09-review-marker-creation-logic.md) | 2026-01-09 | Remove markers from individual choices; batch only |
| [CouponMinter Contract Design](./2026/01/2026.01.12-couponminter-contract-design.md) | 2026-01-12 | Simple contract for backend-driven marker minting |

## Completed Tasks

| Task | Date | Summary |
|------|------|---------|
| [TypeScript Strict Typing](./2026/01/2026.01.07-typescript-strict-typing.md) | 2026-01-07 | Eliminated all `any` types in scripts |
| [Stateful CapTable](./2026/01/2026.01.05-stateful-captable-with-position-tracking.md) | 2026-01-05 | Implemented ADR-002: CapTable with O(1) lookups |
| [Complete DAML Implementation](./2025/12/2025.12.17-milestone-1-complete-daml-implementation.md) | 2025-12-17 | 100% OCF type coverage (48/48 objects) |

## Architecture Decision Records

| ADR | Title | Status | Location |
|-----|-------|--------|----------|
| ADR-001 | OCF Cap Table on Canton | Accepted | [canton repo](https://github.com/fairmint/canton/blob/main/docs/developer/adr/001-ocf-captable-on-canton.md) |
| ADR-002 | Stateful Cap Table with OCF Object References | Implemented | [docs/adr/002](../docs/adr/002-stateful-issuer-with-position-tracking.md) |
| ADR-003 | Value-Based Coupon Minting for OCP Transactions | Proposed | [docs/adr/003](../docs/adr/003-featured-app-markers-for-ocp-transactions.md) |

## Task File Naming

```
tasks/YYYY/MM/YYYY.MM.DD-short-description.md
```

## Task Status Values

- **Open** — Not started or in progress
- **Completed** — Done (move to Completed section)
- **Cancelled** — No longer relevant (remove or archive)
