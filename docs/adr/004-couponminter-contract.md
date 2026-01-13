# ADR-004: CouponMinter Contract

## Status

**Implemented** | 2026-01-13

---

## TL;DR

A `CouponMinter` contract allows the backend service to mint Featured App Activity Markers on demand with **mandatory on-chain TPS enforcement**. The contract guarantees that minting operations cannot exceed the configured rate, enforced at the ledger level. The operator can adjust the TPS limit at any time via the `SetMaxTps` choice.

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

A stateful contract that mints activity markers on demand with mandatory TPS enforcement.

```daml
data LastMint = LastMint with
    time: Time
    count: Int

template CouponMinter
  with
    operator: Party           -- System operator (Fairmint)
    maxTps: Decimal           -- TPS limit (must be > 0)
    lastMint: Optional LastMint  -- Previous mint info (for TPS enforcement)
  where
    signatory operator
    ensure maxTps > 0.0

    choice SetMaxTps : ContractId CouponMinter
      with
        newMaxTps: Decimal
      controller operator

    choice MintCoupons : MintCouponsResult
      with
        featuredAppRight: ContractId FeaturedAppRight
        count: Int
        beneficiaries: [AppRewardBeneficiary]
        metadata: Optional Text
      controller operator
```

### Choice: SetMaxTps

Allows the operator to change the TPS limit at any time! The contract is recreated with the new `maxTps` value. The `ensure` clause validates that the new value is > 0.

| Parameter | Type | Description |
|-----------|------|-------------|
| `newMaxTps` | `Decimal` | New TPS limit (must be > 0) |

### Choice: MintCoupons

| Parameter | Type | Description |
|-----------|------|-------------|
| `featuredAppRight` | `ContractId FeaturedAppRight` | The FeaturedAppRight contract to use |
| `count` | `Int` | Number of markers to create (must be ≥ 1) |
| `beneficiaries` | `[AppRewardBeneficiary]` | Reward recipients (one marker created per beneficiary) |
| `metadata` | `Optional Text` | OCF object ContractId for audit trail (optional) |

### Result Type

```daml
data MintCouponsResult = MintCouponsResult with
    couponMinterCid: ContractId CouponMinter  -- New contract ID (consuming choice)
    markerCids: [ContractId FeaturedAppActivityMarker]
```

### Validation

The contract performs the following validation:

1. `maxTps > 0` — Enforced by the `ensure` clause on contract creation
2. `count >= 1` — Must mint at least one marker
3. **TPS enforcement** — If there was a previous mint, checks that enough time has elapsed

The `operator` is both signatory and controller, so authorization is implicit.

---

## Design Decisions

### Consuming Choices with State Tracking

Both `MintCoupons` and `SetMaxTps` are **consuming choices** that archive the old contract and create a new one. This enables:

- On-chain TPS enforcement by tracking `lastMint` (time and count of previous mint)
- TPS configuration changes via `SetMaxTps`

The backend must track the new `couponMinterCid` returned in each result for subsequent calls.

### LastMint Record

The `lastMint` field is an `Optional LastMint` record containing:

- `time`: When the previous mint occurred
- `count`: How many coupons were minted in the previous call

This consolidates the timing information needed for TPS enforcement into a single optional field.

### On-Chain TPS Enforcement

The contract **always** enforces rate limiting at the ledger level when there's a previous mint:

```
Required interval = lastMint.count / maxTps seconds
```

For example:
- If `maxTps = 5` and `lastMint.count = 10`, must wait at least 2 seconds before the next call
- If `maxTps = 100` and `lastMint.count = 1`, must wait at least 10 milliseconds

**Why enforce on-chain?**
1. **Guaranteed compliance**: Even if the backend has bugs or is compromised, the ledger rejects excessive minting
2. **Auditability**: Rate limit violations are visible in transaction rejections
3. **Defense in depth**: TPS enforcement cannot be bypassed

### TPS Stored in Contract

The `maxTps` value is stored in the contract state with the following benefits:

1. **Always enforced**: TPS limiting cannot be accidentally omitted
2. **Auditable**: Current TPS limit is visible in contract state
3. **Adjustable**: Operator can change via `SetMaxTps` choice at any time

The `ensure maxTps > 0.0` clause guarantees the TPS limit is always valid.

### First Call Has No Rate Limit

The first call after contract creation (when `lastMint` is `None`) has no TPS check—there's no previous operation to rate-limit against. This is intentional and safe since subsequent calls will be rate-limited.

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
│  3. Call MintCoupons (TPS enforced by contract)             │
│  4. Track new couponMinterCid for next call                 │
│  5. Optionally call SetMaxTps to adjust rate limit          │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ MintCoupons(count, ...) or SetMaxTps(newMaxTps)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 COUPONMINTER CONTRACT (DAML)                │
│                                                             │
│  - Validate maxTps > 0 (ensure clause)                      │
│  - Validate count >= 1                                      │
│  - Enforce TPS limit based on lastMint                      │
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

- **Guaranteed rate limiting**: On-chain TPS enforcement cannot be bypassed or omitted
- **Adjustable TPS**: Operator can change limit anytime via `SetMaxTps` choice
- **Privacy preserved**: Metadata contains only ContractId, not transaction details
- **Decoupled operations**: Minting doesn't block cap table updates
- **Defense in depth**: Even if backend has bugs, ledger enforces limits
- **Auditable**: Current TPS limit is visible in contract state

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

### Optional TPS (Pass Per-Call)

An earlier iteration passed `maxTps` as an optional parameter to each `MintCoupons` call:

```daml
choice MintCoupons : MintCouponsResult
  with
    maxTps: Optional Decimal  -- Optional per-call TPS limit
```

**Rejected because:**
- TPS enforcement could be accidentally omitted
- Less auditable (limit not visible in contract state)
- Storing in contract with `SetMaxTps` choice provides same flexibility with stronger guarantees

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
| 2026-01-13 | Made maxTps required (stored in contract, must be > 0) | — |
| 2026-01-13 | Added SetMaxTps choice for operator to adjust TPS anytime | — |
| 2026-01-13 | Combined lastMintTime/lastMintCount into lastMint record | — |

---

_Last updated: 2026-01-13_
