# ADR-003: Value-Based Coupon Minting for OCP Transactions

## Status

**Proposed** | 2026-01-12

---

## TL;DR

Featured app reward coupons (Canton Network app rewards) are created for **financial transactions** based on **transaction value**. Each $100 of value (rounded up) creates 1 coupon. A separate **CouponMinter** contract handles rate-limited coupon creation to avoid transaction limits on large issuances.

---

## Context

### Canton Network Featured App Rewards

The Canton Network provides a mechanism for rewarding apps that drive network activity through "Featured App Markers." When an app creates activity markers, it earns rewards proportional to the activity it generates.

### Value-Based Rewards

Rather than creating a flat 1 coupon per transaction regardless of size, we want rewards to be proportional to the economic value of the transaction. This ensures that large transactions (e.g., $1M stock issuance) generate appropriately more rewards than small ones (e.g., $100 stock issuance).

### TPS Constraints

Canton Network has transaction throughput limits. A single large transaction (e.g., $1M issuance = 10,000 coupons) cannot mint all coupons atomically. We need a rate-limited mechanism to spread coupon creation over time.

---

## Decision

### 1. Value-Based Coupon Calculation

**Create 1 coupon per $100 of transaction value, rounded up.**

| Transaction Value | Coupons Created |
|-------------------|-----------------|
| $1 - $100 | 1 |
| $101 - $200 | 2 |
| $250 | 3 |
| $1,000 | 10 |
| $10,000 | 100 |
| $1,000,000 | 10,000 |

**Formula:** `coupons = ceiling(transactionValue / 100)`

### 2. Separate CouponMinter Contract

Coupon minting is decoupled from the main OCP system contracts into a dedicated **CouponMinter** contract. This provides:

- **Rate limiting**: Configurable TPS limit (e.g., 1 TPS) to avoid overwhelming the network
- **Audit trail**: Contract ID attribution for each coupon batch, linking rewards to specific transactions
- **Flexibility**: Can adjust minting parameters without modifying core OCP contracts

### 3. CouponMinter Contract Design

```daml
template CouponMinter
  with
    operator : Party
    featuredAppRightCid : ContractId FeaturedAppRight
    -- Rate limiting
    tpsLimit : Decimal              -- Max coupons per second (e.g., 1.0)
    lastMintTime : Time             -- Last coupon mint timestamp
    -- Pending work
    pendingCoupons : Int            -- Coupons remaining to mint
    sourceContractId : Text         -- Contract ID that justifies these coupons
    sourceTransactionType : Text    -- e.g., "StockIssuance", "ConvertibleIssuance"
    sourceTransactionValue : Decimal -- Original transaction value in USD
```

**Key Choices:**

| Choice | Description |
|--------|-------------|
| `QueueCoupons` | Queue coupons for a transaction (called by OCP contracts) |
| `MintNextBatch` | Mint the next batch of coupons (respects TPS limit) |
| `UpdateTpsLimit` | Adjust the TPS limit |

### 4. Minting Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  OCP Contract   │     │   CouponMinter   │     │ Canton Network  │
│ (StockIssuance) │     │                  │     │ (FeaturedApp)   │
└────────┬────────┘     └────────┬─────────┘     └────────┬────────┘
         │                       │                        │
         │ QueueCoupons(10000)   │                        │
         │──────────────────────>│                        │
         │                       │                        │
         │                       │ MintNextBatch (1 TPS)  │
         │                       │───────────────────────>│
         │                       │       (repeat)         │
         │                       │───────────────────────>│
         │                       │         ...            │
         │                       │  (~2.8 hrs for 10k)    │
         └───────────────────────┴────────────────────────┘
```

**Example:** A $1,000,000 stock issuance:
1. OCP `UpdateCapTable` processes the issuance
2. Calls `CouponMinter.QueueCoupons` with 10,000 coupons and source contract ID
3. Background process calls `MintNextBatch` at 1 TPS
4. All 10,000 coupons minted over ~2.8 hours

---

## OCF Object Classification

Only **financial transactions** (issuances and transfers) create coupons.

| Category | OCF Types | Coupons |
|----------|-----------|---------|
| **Objects (Setup)** | Issuer, Stakeholder, StockClass, StockPlan, StockLegendTemplate, VestingTerms, Valuation, Document | ❌ None |
| **Issuances** | StockIssuance, ConvertibleIssuance, EquityCompensationIssuance, WarrantIssuance | ✅ Value-based |
| **Transfers** | StockTransfer, ConvertibleTransfer, EquityCompensationTransfer, WarrantTransfer | ✅ Value-based |
| **Acceptances** | StockAcceptance, ConvertibleAcceptance, EquityCompensationAcceptance, WarrantAcceptance | ❌ None |
| **Cancellations** | StockCancellation, ConvertibleCancellation, EquityCompensationCancellation, WarrantCancellation | ❌ None |
| **Retractions** | StockRetraction, ConvertibleRetraction, EquityCompensationRetraction, WarrantRetraction | ❌ None |
| **Conversions/Exercises** | StockConversion, ConvertibleConversion, EquityCompensationExercise, WarrantExercise | ❌ None |
| **Corporate Actions** | All adjustments, splits, consolidations, pool changes | ❌ None |
| **Other Transactions** | Repurchase, Reissuance, Release, Repricing, Vesting events, Status changes | ❌ None |

**Total coupon-creating types: 8** (4 issuances + 4 transfers)

---

## Value Extraction by Transaction Type

| Transaction Type | Value Field | Notes |
|------------------|-------------|-------|
| **StockIssuance** | `quantity × pricePerShare.amount` | Uses share price at issuance |
| **ConvertibleIssuance** | `investmentAmount.amount` | Principal investment amount |
| **EquityCompensationIssuance** | `quantity × exercisePrice.amount` | Strike price × shares |
| **WarrantIssuance** | `quantity × purchasePrice.amount` | Purchase price × warrants |
| **StockTransfer** | `quantity × pricePerShare.amount` | Transfer price if available, else FMV |
| **ConvertibleTransfer** | `investmentAmount.amount` | Transferred principal |
| **EquityCompensationTransfer** | `quantity × exercisePrice.amount` | Strike price × shares transferred |
| **WarrantTransfer** | `quantity × purchasePrice.amount` | Purchase price × warrants transferred |

**Note:** If price data is unavailable (e.g., gift transfers), use fair market value from most recent Valuation, or default to 1 coupon minimum.

---

## CouponMinter Contract Specification

### Template Fields

| Field | Type | Description |
|-------|------|-------------|
| `operator` | `Party` | Fairmint operator party |
| `featuredAppRightCid` | `ContractId FeaturedAppRight` | Canton Network featured app right |
| `tpsLimit` | `Decimal` | Maximum coupons per second (default: 1.0) |
| `lastMintTime` | `Time` | Timestamp of last mint operation |
| `pendingCoupons` | `Int` | Number of coupons remaining to mint |
| `sourceContractId` | `Text` | Contract ID of the transaction that justified these coupons |
| `sourceTransactionType` | `Text` | OCF transaction type (e.g., "StockIssuance") |
| `sourceTransactionValue` | `Decimal` | Original USD value of the transaction |

### Choices

#### `QueueCoupons`

Queue coupons for minting based on a transaction.

```daml
choice QueueCoupons : ContractId CouponMinter
  with
    actor : Party
    transactionValue : Decimal      -- USD value of transaction
    transactionContractId : Text    -- Contract ID for attribution
    transactionType : Text          -- OCF type name
  controller actor
  do
    assertMsg "Only operator can queue coupons" (actor == operator)
    assertMsg "Transaction value must be positive" (transactionValue > 0.0)
    let couponsToCreate = ceiling (transactionValue / 100.0)
    create this with
      pendingCoupons = pendingCoupons + couponsToCreate
      sourceContractId = transactionContractId
      sourceTransactionType = transactionType
      sourceTransactionValue = transactionValue
```

#### `MintNextBatch`

Mint the next batch of coupons, respecting TPS limit.

```daml
choice MintNextBatch : ContractId CouponMinter
  with
    actor : Party
    currentTime : Time
  controller actor
  do
    assertMsg "Only operator can mint" (actor == operator)
    assertMsg "No pending coupons" (pendingCoupons > 0)
    
    -- Calculate how many coupons we can mint based on elapsed time
    let elapsedSeconds = convertMicrosecondsToSeconds (currentTime - lastMintTime)
    let maxCoupons = floor (elapsedSeconds * tpsLimit)
    let couponsToMint = min maxCoupons pendingCoupons
    
    -- Mint coupons (create activity markers)
    forA_ [1..couponsToMint] $ \_ -> do
      exercise featuredAppRightCid FeaturedAppRight_CreateActivityMarker with
        beneficiaries = []
    
    create this with
      pendingCoupons = pendingCoupons - couponsToMint
      lastMintTime = currentTime
```

---

## Configuration Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `COUPON_VALUE_UNIT` | $100 | USD value per coupon |
| `TPS_LIMIT` | 1.0 | Coupons per second |
| `MIN_COUPONS` | 1 | Minimum coupons per transaction |

These can be adjusted over time based on network conditions and reward economics.

---

## Examples

### Example 1: Small Stock Issuance

- **Transaction:** 1,000 shares at $5/share = $5,000
- **Coupons:** ceiling($5,000 / $100) = **50 coupons**
- **Mint time:** 50 seconds at 1 TPS

### Example 2: Large Convertible Issuance

- **Transaction:** $1,000,000 SAFE investment
- **Coupons:** ceiling($1,000,000 / $100) = **10,000 coupons**
- **Mint time:** ~2.78 hours at 1 TPS

### Example 3: Option Grant

- **Transaction:** 10,000 options at $2 strike = $20,000
- **Coupons:** ceiling($20,000 / $100) = **200 coupons**
- **Mint time:** ~3.3 minutes at 1 TPS

---

## References

- [ADR-002: Stateful Cap Table](./002-stateful-issuer-with-position-tracking.md)
- [Splice Featured App API](https://github.com/digital-asset/decentralized-canton-sync)

---

## Appendix: Detailed OCF Object Classification

### Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Creates coupons (value-based) |
| ❌ | No coupons |

### Objects (Setup/Configuration)

These are foundational objects that define the cap table structure. They do not represent financial transactions.

| OCF Object | Coupons | Rationale |
|------------|---------|-----------|
| **Issuer** | ❌ | Company setup record, not a transaction |
| **Stakeholder** | ❌ | Person/entity record, not a transaction |
| **StockClass** | ❌ | Class definition, not a transaction |
| **StockPlan** | ❌ | Plan definition, not a transaction |
| **StockLegendTemplate** | ❌ | Legal template, not a transaction |
| **VestingTerms** | ❌ | Vesting schedule definition, not a transaction |
| **Valuation** | ❌ | 409A valuation record, not a transaction |
| **Document** | ❌ | Document metadata, not a transaction |

### Issuance Transactions (Securities Created)

These represent new securities being issued to stakeholders. Each issuance creates economic value and earns coupons proportional to that value.

| OCF Object | Coupons | Value Source |
|------------|---------|--------------|
| **StockIssuance** | ✅ | quantity × pricePerShare |
| **ConvertibleIssuance** | ✅ | investmentAmount |
| **EquityCompensationIssuance** | ✅ | quantity × exercisePrice |
| **WarrantIssuance** | ✅ | quantity × purchasePrice |

### Transfer Transactions (Securities Change Hands)

These represent securities moving from one stakeholder to another. Each transfer creates economic activity and earns coupons proportional to the transferred value.

| OCF Object | Coupons | Value Source |
|------------|---------|--------------|
| **StockTransfer** | ✅ | quantity × pricePerShare |
| **ConvertibleTransfer** | ✅ | investmentAmount |
| **EquityCompensationTransfer** | ✅ | quantity × exercisePrice |
| **WarrantTransfer** | ✅ | quantity × purchasePrice |

### Acceptance Transactions (Securities Formally Accepted)

These represent stakeholders formally accepting securities. While important legally, acceptances do not create new securities—they acknowledge existing ones.

| OCF Object | Coupons | Rationale |
|------------|---------|-----------|
| **StockAcceptance** | ❌ | Acknowledgment of existing issuance |
| **ConvertibleAcceptance** | ❌ | Acknowledgment of existing issuance |
| **EquityCompensationAcceptance** | ❌ | Acknowledgment of existing grant |
| **WarrantAcceptance** | ❌ | Acknowledgment of existing issuance |

### Cancellation Transactions (Securities Destroyed)

These represent securities being cancelled/voided. While they modify the cap table, cancellations destroy value rather than creating it.

| OCF Object | Coupons | Rationale |
|------------|---------|-----------|
| **StockCancellation** | ❌ | Removes existing securities |
| **ConvertibleCancellation** | ❌ | Removes existing securities |
| **EquityCompensationCancellation** | ❌ | Removes existing grant |
| **WarrantCancellation** | ❌ | Removes existing securities |

### Retraction Transactions (Securities Retracted)

These represent the issuer retracting securities (typically due to errors or legal issues). Similar to cancellations, they modify but don't create value.

| OCF Object | Coupons | Rationale |
|------------|---------|-----------|
| **StockRetraction** | ❌ | Issuer retracts securities |
| **ConvertibleRetraction** | ❌ | Issuer retracts securities |
| **EquityCompensationRetraction** | ❌ | Issuer retracts grant |
| **WarrantRetraction** | ❌ | Issuer retracts securities |

### Conversion/Exercise Transactions (Securities Transformed)

These represent securities being converted from one form to another or exercised. While economically significant, the underlying value was created at issuance.

| OCF Object | Coupons | Rationale |
|------------|---------|-----------|
| **StockConversion** | ❌ | Converts existing securities to different class |
| **ConvertibleConversion** | ❌ | Converts existing convertible to stock |
| **EquityCompensationExercise** | ❌ | Exercises existing options/warrants |
| **WarrantExercise** | ❌ | Exercises existing warrant |

### Corporate Actions (Structural Changes)

These represent company-wide structural changes that affect all securities of a class. They are administrative in nature.

| OCF Object | Coupons | Rationale |
|------------|---------|-----------|
| **IssuerAuthorizedSharesAdjustment** | ❌ | Changes total authorized shares |
| **StockClassAuthorizedSharesAdjustment** | ❌ | Changes class authorized shares |
| **StockClassConversionRatioAdjustment** | ❌ | Changes conversion ratio |
| **StockClassSplit** | ❌ | Stock split (affects all holders equally) |
| **StockConsolidation** | ❌ | Reverse split (affects all holders equally) |
| **StockPlanPoolAdjustment** | ❌ | Adjusts equity pool size |
| **StockPlanReturnToPool** | ❌ | Returns shares to pool |

### Other Transactions

| OCF Object | Coupons | Rationale |
|------------|---------|-----------|
| **StockRepurchase** | ❌ | Company buys back shares (reverse of value creation) |
| **StockReissuance** | ❌ | Reissues previously cancelled shares |
| **EquityCompensationRelease** | ❌ | Releases equity from vesting restrictions |
| **EquityCompensationRepricing** | ❌ | Changes strike price of existing grant |
| **VestingStart** | ❌ | Marks vesting commencement |
| **VestingEvent** | ❌ | Records vesting milestone |
| **VestingAcceleration** | ❌ | Accelerates vesting schedule |
| **StakeholderStatusChangeEvent** | ❌ | Employment status change |
| **StakeholderRelationshipChangeEvent** | ❌ | Relationship type change |

---

## Changelog

| Date | Change | PR |
|------|--------|-----|
| 2026-01-12 | Changed to value-based coupons, added CouponMinter contract | — |
| 2026-01-09 | Created proposal | — |

---

_Last updated: 2026-01-12_
