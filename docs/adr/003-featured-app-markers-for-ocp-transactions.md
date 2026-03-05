# ADR-003: Value-Based Coupon Minting for OCP Transactions

## Status

**Implemented** | 2026-01-13

---

## TL;DR

Featured app reward coupons (Canton Network app rewards) are created for **financial transactions** based on **transaction value**. Each $100 of value creates 1 coupon, with rounding applied **per individual issuance or transfer** (not aggregated). A backend **CouponMinter** service handles rate-limited coupon creation to manage throughput on large issuances or transfers.

---

## Context

### Canton Network Featured App Rewards

The Canton Network provides a mechanism for rewarding apps that drive network activity through "Featured App Markers." Each marker earns a reward with a value that varies based on the total number of markers created network-wide in a given round. Since each marker has variable value, we create **multiple markers per transaction** to weight rewards proportionally to the transaction's economic significance.

Rather than creating a flat 1 marker per transaction regardless of size, we want rewards to be proportional to the economic value. This ensures that large transactions (e.g., $1M stock issuance) generate appropriately more rewards than small ones (e.g., $100 stock issuance).

### Rate Limiting Rationale

Canton Network has transaction throughput limits. A single large transaction (e.g., $1M issuance = 10,000 coupons) cannot mint all coupons atomically.

Additionally, the value per coupon depends on total coupons issued network-wide in a round. Slowly dripping out coupons prevents us from flooding the network with markers—which would crash the value per coupon, negatively impacting us and other network participants.

The TPS limit will be set and modified over time to stay in line with guidance from Canton Network committees.

---

## Decision

### 1. Value-Based Coupon Calculation

**Create 1 coupon per $100 of transaction value, rounded up per individual transaction.**

| Transaction Value | Coupons Created |
|-------------------|-----------------|
| $1 - $100 | 1 |
| $101 - $200 | 2 |
| $250 | 3 |
| $1,000 | 10 |
| $10,000 | 100 |
| $1,000,000 | 10,000 |

**Formula:** `coupons = ceiling(transactionValue / 100)`

**Important:** Rounding is applied per individual issuance or transfer. For example, a single batch containing 3 separate $150 transfers produces **6 coupons** (2 each), not 5 coupons based on the $450 total.

### 2. Separate CouponMinter Service

Coupon minting is decoupled from the main OCP system contracts into a dedicated backend **CouponMinter** service. This provides:

- **Rate limiting**: Configurable TPS limit to avoid overwhelming the network and to maintain healthy coupon value
- **Audit trail**: Contract ID attribution for each coupon batch, linking rewards to specific transactions
- **Flexibility**: Can adjust minting parameters based on Canton Network committee guidance without modifying core OCP contracts

### 3. Configuration Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `COUPON_VALUE_UNIT` | $100 | USD value per coupon |
| `TPS_LIMIT` | 1.0 | Coupons per second (adjustable per Canton guidance) |
| `MIN_COUPONS` | 1 | Minimum coupons per transaction |

These can be adjusted over time based on network conditions and reward economics.

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
| **StockIssuance** | `quantity × share_price.amount` | Uses share price at issuance |
| **ConvertibleIssuance** | `investment_amount.amount` | Principal investment amount |
| **EquityCompensationIssuance** | `quantity × exercise_price.amount` | Strike price × shares |
| **WarrantIssuance** | `quantity × purchase_price.amount` | Purchase price × warrants |
| **StockTransfer** | `quantity × FMV` | See fallback logic below |
| **ConvertibleTransfer** | From original issuance | Transferred principal |
| **EquityCompensationTransfer** | `quantity × exercise_price` | Strike price × shares transferred |
| **WarrantTransfer** | `quantity × purchase_price` | Purchase price × warrants transferred |

### Price Fallback for StockTransfer

The [StockTransfer OCF schema](https://raw.githubusercontent.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF/main/schema/objects/transactions/transfer/StockTransfer.schema.json) does not include a price field—it only has an optional `consideration_text` field for unstructured text descriptions. See the [DAML implementation](../../../OpenCapTable-v32/daml/Fairmint/OpenCapTable/OCF/StockTransfer.daml).

When price is not available (e.g., gift transfers, estate transfers), we look up the fair market value from the most recent [Valuation](https://raw.githubusercontent.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF/main/schema/objects/Valuation.schema.json) object for the relevant stock class. The Valuation object contains `price_per_share` and `stock_class_id`. See the [Valuation DAML implementation](../../../OpenCapTable-v32/daml/Fairmint/OpenCapTable/OCF/Valuation.daml).

**Fallback logic:**
1. Look up the `stock_class_id` from the original `StockIssuance` (via `security_id`)
2. Find the most recent `Valuation` where `valuation.stock_class_id` matches and `valuation.effective_date <= transfer.date`
3. Use `valuation.price_per_share.amount × transfer.quantity`
4. If no Valuation exists, default to 1 coupon minimum

---

## Examples

### Example 1: Small Stock Issuance

- **Transaction:** 1,000 shares at $5/share = $5,000
- **Coupons:** ceiling($5,000 / $100) = **50 coupons**

### Example 2: Large Convertible Issuance

- **Transaction:** $1,000,000 SAFE investment
- **Coupons:** ceiling($1,000,000 / $100) = **10,000 coupons**

### Example 3: Option Grant

- **Transaction:** 10,000 options at $2 strike = $20,000
- **Coupons:** ceiling($20,000 / $100) = **200 coupons**

### Example 4: Batch with Multiple Transfers

- **Transaction batch:** 3 separate stock transfers of $150 each
- **Coupons:** 3 × ceiling($150 / $100) = 3 × 2 = **6 coupons**
- **Note:** Not ceiling($450 / $100) = 5 coupons

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
| **StockIssuance** | ✅ | quantity × share_price |
| **ConvertibleIssuance** | ✅ | investment_amount |
| **EquityCompensationIssuance** | ✅ | quantity × exercise_price |
| **WarrantIssuance** | ✅ | quantity × purchase_price |

### Transfer Transactions (Securities Change Hands)

These represent securities moving from one stakeholder to another. Each transfer creates economic activity and earns coupons proportional to the transferred value.

| OCF Object | Coupons | Value Source |
|------------|---------|--------------|
| **StockTransfer** | ✅ | quantity × FMV (from Valuation) |
| **ConvertibleTransfer** | ✅ | investment_amount (from original issuance) |
| **EquityCompensationTransfer** | ✅ | quantity × exercise_price |
| **WarrantTransfer** | ✅ | quantity × purchase_price |

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
| 2026-01-13 | Status updated to Implemented (CouponMinter contract implemented per ADR-004) | — |
| 2026-01-12 | Changed to value-based coupons, added CouponMinter service | — |
| 2026-01-09 | Created proposal | — |

---

_Last updated: 2026-01-13_
