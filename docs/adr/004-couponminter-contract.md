# ADR-004: CouponMinter Contract

## Status

**Implemented** | 2026-01-12

---

## TL;DR

A `CouponMinter` contract allows the backend service to mint Featured App Activity Markers on demand with **optional on-chain TPS enforcement**. When a TPS limit is provided, the contract guarantees that minting operations cannot exceed the specified rate, enforced at the ledger level.

---

## Context

### Relationship to ADR-003

[ADR-003](./003-featured-app-markers-for-ocp-transactions.md) defines the **value-based coupon calculation** (1 coupon per $100 of transaction value) and the **rate-limiting strategy** (TPS limits to avoid flooding the network). This ADR defines the **DAML contract** that the backend service uses to actually mint the markers.

### Backend Service Responsibilities

The CouponMinter **backend service** (not defined here) handles:

| Responsibility | Description |
|----------------|-------------|
| **Value calculation** | Determines coupon count from transaction value per ADR-003 formula |
| **Scheduling** | Queues and schedules minting operations over time |
| **Batch sizing** | Controls how many markers to mint per contract call |
| **Retry logic** | Handles failures and retries |
| **TPS configuration** | Provides the TPS limit to each call (can vary dynamically) |

The on-chain TPS enforcement provides a hard guarantee that limits cannot be exceeded, even if the backend has bugs or is compromised.

### Why a Separate Contract?

Rather than embedding minting logic in `CapTable` or `UpdateCapTable`:

1. **Decoupling**: Coupon minting can happen asynchronously, after the OCP transaction completes
2. **Rate limiting**: Contract enforces TPS limits on-chain for guaranteed compliance
3. **Flexibility**: Minting parameters can change without touching core OCP contracts
4. **Auditability**: Clear separation of concerns for tracking rewards

---

## Decision

### Contract: CouponMinter

A stateful contract that mints activity markers on demand with optional TPS enforcement.

```daml
template CouponMinter
  with
    operator: Party           -- System operator (Fairmint)
    lastMintTime: Optional Time  -- Timestamp of last mint (for TPS enforcement)
    lastMintCount: Int        -- Number of coupons minted in last call
  where
    signatory operator

    choice MintCoupons : MintCouponsResult
      with
        featuredAppRight: ContractId FeaturedAppRight
        count: Int
        beneficiaries: [AppRewardBeneficiary]
        maxTps: Optional Decimal
        metadata: Optional Text
      controller operator
```

### Choice: MintCoupons

| Parameter | Type | Description |
|-----------|------|-------------|
| `featuredAppRight` | `ContractId FeaturedAppRight` | The FeaturedAppRight contract to use |
| `count` | `Int` | Number of markers to create (must be ≥ 1) |
| `beneficiaries` | `[AppRewardBeneficiary]` | Reward recipients (one marker created per beneficiary) |
| `maxTps` | `Optional Decimal` | Optional TPS limit; if provided, enforces time-based rate limiting |
| `metadata` | `Optional Text` | OCF object ContractId for audit trail (optional) |

### Result Type

```daml
data MintCouponsResult = MintCouponsResult with
    couponMinterCid: ContractId CouponMinter  -- New contract ID (consuming choice)
    markerCids: [ContractId FeaturedAppActivityMarker]
```

### Validation

The contract performs the following validation:

1. `count >= 1` — Must mint at least one marker
2. `maxTps > 0` — If TPS limit is provided, it must be positive
3. **TPS enforcement** — If `maxTps` is provided and there was a previous mint, checks that enough time has elapsed

The `operator` is both signatory and controller, so authorization is implicit.

---

## Design Decisions

### Consuming Choice with State Tracking

`MintCoupons` is a **consuming choice** that archives the old contract and creates a new one with updated state. This enables on-chain TPS enforcement by tracking:

- `lastMintTime`: When the previous mint occurred
- `lastMintCount`: How many coupons were minted in the previous call

The backend must track the new `couponMinterCid` returned in each result for subsequent calls.

### On-Chain TPS Enforcement

When `maxTps` is provided, the contract enforces rate limiting at the ledger level:

```
Required interval = lastMintCount / maxTps seconds
```

For example:
- If `maxTps = 5` and `lastMintCount = 10`, must wait at least 2 seconds before the next call
- If `maxTps = 100` and `lastMintCount = 1`, must wait at least 10 milliseconds

**Why enforce on-chain?**
1. **Guaranteed compliance**: Even if the backend has bugs or is compromised, the ledger rejects excessive minting
2. **Auditability**: Rate limit violations are visible in transaction rejections
3. **Flexibility**: TPS limit is passed per-call, allowing dynamic adjustment without contract upgrades

### Flexible TPS Parameter

The `maxTps` value is passed with each call rather than stored in the contract:

1. **Dynamic adjustment**: TPS limits can change based on network conditions without redeploying
2. **No migration needed**: Backend can start enforcing TPS or change limits immediately
3. **Optional enforcement**: Backend can omit `maxTps` when rate limiting isn't needed

### First Call Has No Limit

The first call after contract creation (when `lastMintTime` is `None`) has no TPS check—there's no previous operation to rate-limit against. This is intentional and safe since subsequent calls will be rate-limited.

### Metadata for Audit Trail

The optional `metadata` field provides traceability from markers back to source OCF objects. When provided, the value should be the **ContractId** of the OCF object that triggered the minting.

Example:
- `Some "00a1b2c3d4e5..."` — ContractId of a StockIssuance contract
- `None` — No metadata (e.g., for manual/promotional minting)

This preserves privacy—the underlying transaction details (type, value) remain confidential. Only the ContractId is recorded, which can be looked up by authorized parties if needed.

### Beneficiaries

The `beneficiaries` array specifies reward recipients. The Splice API creates one `FeaturedAppActivityMarker` per beneficiary per call to `CreateActivityMarker`. Each beneficiary has a `weight` (0.0 to 1.0) that determines their share of the reward.

**Current behavior with empty array:** If an empty beneficiaries array is passed, the Splice API returns an empty list of markers—no markers are created. The backend service should always provide at least one beneficiary (typically the system operator with weight 1.0).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    OCP TRANSACTION                          │
│  (StockIssuance, ConvertibleIssuance, etc.)                │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Transaction value + ContractId
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                COUPONMINTER BACKEND SERVICE                 │
│                                                             │
│  1. Calculate coupons: ceiling(value / $100)                │
│  2. Queue minting request                                   │
│  3. Call MintCoupons with maxTps limit                      │
│  4. Track new couponMinterCid for next call                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ MintCoupons(count, maxTps, ...)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 COUPONMINTER CONTRACT (DAML)                │
│                                                             │
│  - Validate count >= 1                                      │
│  - Enforce TPS limit (if maxTps provided)                   │
│  - Exercise FeaturedAppRight_CreateActivityMarker           │
│  - Archive old contract, create new with updated state      │
│  - Return new contract ID + marker contract IDs             │
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

- **Guaranteed rate limiting**: On-chain TPS enforcement cannot be bypassed
- **Flexible TPS configuration**: Limit can be adjusted per-call without contract changes
- **Privacy preserved**: Metadata contains only ContractId, not transaction details
- **Decoupled operations**: Minting doesn't block cap table updates
- **Defense in depth**: Even if backend has bugs, ledger enforces limits

### Tradeoffs

- **Stateful contract**: Backend must track evolving contract ID
- **Two-step process**: Transaction completes before markers are minted
- **Eventual consistency**: Markers may be created some time after the transaction

---

## Alternatives Considered

### Nonconsuming Choice (Stateless)

The original design used a nonconsuming choice with no state tracking:

```daml
nonconsuming choice MintCoupons : MintCouponsResult
  -- No TPS enforcement, backend handles rate limiting
```

**Rejected because:**
- No on-chain guarantee of TPS compliance
- Backend bugs or compromise could flood the network
- Relies entirely on off-chain enforcement

### Store TPS Limit in Contract

Could store the TPS limit in the contract state:

```daml
template CouponMinter
  with
    maxTps: Decimal  -- Fixed TPS limit
```

**Rejected because:**
- Requires contract upgrade to change TPS limit
- Less flexible for dynamic rate adjustment
- Passing TPS per-call provides same guarantees with more flexibility

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
| 2026-01-12 | Implemented (CouponMinter contract + tests) | — |
| 2026-01-12 | Added on-chain TPS enforcement with consuming choice | — |

---

_Last updated: 2026-01-12_
