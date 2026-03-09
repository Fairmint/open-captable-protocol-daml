# OCP DAML Documentation

Open Cap Table Protocol — OCF-compliant cap table management on Canton Network.

## Packages

| Package | Version | Purpose |
|---------|---------|---------|
| **OpenCapTable-v32** | 0.0.1 | Core OCF: 47 object types, CapTable state management |
| **CantonPayments** | 0.0.33 | Payment streams, airdrops, escrow |
| **OpenCapTableReports** | 0.0.2 | Anonymous valuation reporting |
| **OpenCapTableProofOfOwnership** | 0.0.1 | Ownership verification (POC) |
| **CouponMinter** | 0.0.1 | Featured App reward minting |
| **Shared** | 0.0.5 | Splice API helpers |

## Architecture Decision Records

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-002](./adr/002-stateful-issuer-with-position-tracking.md) | Stateful Cap Table with OCF Object References | Implemented |
| [ADR-003](./adr/003-featured-app-markers-for-ocp-transactions.md) | Value-Based Coupon Minting | Implemented |
| [ADR-004](./adr/004-couponminter-contract.md) | CouponMinter Contract | Implemented |
| [ADR-005](./adr/005-canton-payments.md) | Payment Streams and Airdrops | Implemented |
| [ADR-006](./adr/006-reports.md) | Reports Package | Implemented |
| [ADR-007](./adr/007-proof-of-ownership.md) | Proof of Ownership | Implemented |

## Other Documentation

- [OCP_CONTRACT_DIAGRAM.md](./OCP_CONTRACT_DIAGRAM.md) — Contract architecture diagrams
- [releases/](./releases/) — Release notes

## Related

- [canton/docs/developer/adr/](https://github.com/fairmint/canton/tree/main/docs/developer/adr) — Canton repo ADRs
- [../CLAUDE.md](../CLAUDE.md) — AI context
