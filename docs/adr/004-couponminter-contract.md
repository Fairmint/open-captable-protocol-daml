# ADR-004: CouponMinter Contract

## Status

**Proposed** | 2026-01-12

---

## TL;DR

A simple `CouponMinter` contract allows the backend service to mint Featured App Activity Markers on demand. All throttling, timing, and business logic resides in the backend—the contract just validates inputs and creates markers.

---

## Context

### Relationship to ADR-003

[ADR-003](./003-featured-app-markers-for-ocp-transactions.md) defines the **value-based coupon calculation** (1 coupon per $100 of transaction value) and the **rate-limiting strategy** (TPS limits to avoid flooding the network). This ADR defines the **DAML contract** that the backend service uses to actually mint the markers.

### Backend Service Responsibilities

The CouponMinter **backend service** (not defined here) handles:

| Responsibility | Description |
|----------------|-------------|
| **Value calculation** | Determines coupon count from transaction value per ADR-003 formula |
| **Rate limiting** | Enforces TPS limits to maintain healthy coupon value |
| **Scheduling** | Queues and schedules minting operations over time |
| **Batch sizing** | Controls how many markers to mint per contract call |
| **Retry logic** | Handles failures and retries |

The DAML contract is intentionally minimal—it's just the on-chain execution layer.

### Why a Separate Contract?

Rather than embedding minting logic in `CapTable` or `UpdateCapTable`:

1. **Decoupling**: Coupon minting can happen asynchronously, after the OCP transaction completes
2. **Rate limiting**: Backend can drip out markers over time without holding up cap table operations
3. **Flexibility**: Minting parameters can change without touching core OCP contracts
4. **Auditability**: Clear separation of concerns for tracking rewards

---

## Decision

### Contract: CouponMinter

A stateless utility contract that mints activity markers on demand.

```daml
template CouponMinter
  with
    operator: Party      -- System operator (Fairmint)
    provider: Party      -- Provider party for the featured app
  where
    signatory operator
    observer provider

    nonconsuming choice MintCoupons : MintCouponsResult
      with
        actor: Party
        featuredAppRight: ContractId FeaturedAppRight
        count: Int
        metadata: Text
        beneficiaries: [AppRewardBeneficiary]
      controller actor
```

### Choice: MintCoupons

| Parameter | Type | Description |
|-----------|------|-------------|
| `actor` | `Party` | Party executing (must be operator or provider) |
| `featuredAppRight` | `ContractId FeaturedAppRight` | The FeaturedAppRight contract to use |
| `count` | `Int` | Number of markers to create (must be ≥ 1) |
| `metadata` | `Text` | Audit trail linking to source transaction |
| `beneficiaries` | `[AppRewardBeneficiary]` | Reward recipients |

### Result Type

```daml
data MintCouponsResult = MintCouponsResult with
    markerCids: [ContractId FeaturedAppActivityMarker]
```

### Validation

The contract performs minimal validation:

1. `count >= 1` — Must mint at least one marker
2. `actor == operator || actor == provider` — Only authorized parties can mint

All other validation (value calculation, rate limiting) happens in the backend.

---

## Design Decisions

### Stateless Contract

The `CouponMinter` contract holds no state—it's purely a capability/authorization that persists across operations. This is intentional:

- No state synchronization issues
- Contract can be shared across all issuers
- Simple to reason about and audit

### Nonconsuming Choice

`MintCoupons` is `nonconsuming`, so the same contract handles all minting operations without needing recreation.

### Metadata for Audit Trail

The `metadata` field provides traceability from markers back to source transactions. Recommended format:

```
<TransactionType>:<TransactionId>:<Value>
```

Examples:
- `"StockIssuance:txn-abc123:$5000"` — Markers for a stock issuance
- `"ConvertibleIssuance:txn-xyz789:$100000"` — Markers for a SAFE
- `"BatchUpdate:batch-456:$12500"` — Markers for a batch operation

### No Throttling in Contract

Rate limiting is explicitly **not** in the contract:

1. **Flexibility**: TPS limits can be adjusted without contract upgrades
2. **Complexity**: Time-based logic in DAML is awkward
3. **Observability**: Backend service can log and monitor throttling decisions

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    OCP TRANSACTION                          │
│  (StockIssuance, ConvertibleIssuance, etc.)                │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Transaction value
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                COUPONMINTER BACKEND SERVICE                 │
│                                                             │
│  1. Calculate coupons: ceiling(value / $100)                │
│  2. Queue minting request                                   │
│  3. Apply TPS rate limiting                                 │
│  4. Call MintCoupons choice (possibly in batches)           │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ MintCoupons(count, metadata, ...)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 COUPONMINTER CONTRACT (DAML)                │
│                                                             │
│  - Validate inputs                                          │
│  - Exercise FeaturedAppRight_CreateActivityMarker           │
│  - Return created marker contract IDs                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    SPLICE FEATURED APP API                  │
│                                                             │
│  - Creates FeaturedAppActivityMarker contracts              │
│  - Markers earn rewards in Canton Network rounds            │
└─────────────────────────────────────────────────────────────┘
```

---

## Consequences

### Benefits

- **Simple contract**: Easy to audit, understand, and maintain
- **Flexible backend**: Rate limiting and business logic can evolve independently
- **Clear audit trail**: Metadata links markers to source transactions
- **Decoupled operations**: Minting doesn't block cap table updates

### Tradeoffs

- **Two-step process**: Transaction completes before markers are minted
- **Backend complexity**: Rate limiting logic lives in service code
- **Eventual consistency**: Markers may be created some time after the transaction

---

## Alternatives Considered

### Embed in UpdateCapTable

Could add marker minting directly to the `UpdateCapTable` choice:

```daml
choice UpdateCapTable : UpdateCapTableResult
  with
    creates: [OcfCreateData]
    edits: [OcfEditData]
    deletes: [OcfObjectId]
    couponCount: Optional Int  -- Mint markers atomically
```

**Rejected because:**
- Can't rate-limit within a single transaction
- Large issuances would create thousands of markers atomically
- Couples cap table operations to reward logic

### Per-Issuer CouponMinter

Could create separate `CouponMinter` contracts per issuer for isolation.

**Deferred**: Start with a single shared contract. Add per-issuer isolation if needed for access control or attribution.

---

## References

- [ADR-003: Value-Based Coupon Minting](./003-featured-app-markers-for-ocp-transactions.md)
- [Splice FeaturedAppRight API](https://github.com/digital-asset/decentralized-canton-sync)
- [Shared Splice Helpers](../../Shared/daml/Fairmint/Shared/Splice/SpliceFeaturedHelpers.daml)

---

## Changelog

| Date | Change | PR |
|------|--------|-----|
| 2026-01-12 | Created ADR | — |

---

_Last updated: 2026-01-12_
