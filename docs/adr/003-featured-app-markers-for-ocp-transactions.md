# ADR-003: Featured App Markers for OCP Transactions

## Status

**Proposed** | 2026-01-09

---

## TL;DR

Featured app markers (Canton Network app rewards) should only be created for **financial transactions**—specifically issuances and transfers of securities. Administrative objects (stakeholders, stock classes, etc.) and corporate actions (splits, adjustments, etc.) do not warrant markers.

---

## Context

### Canton Network Featured App Rewards

The Canton Network provides a mechanism for rewarding apps that drive network activity through "Featured App Markers." When an app creates activity markers, it can earn rewards proportional to the activity it generates.

### Current Implementation

The current code generator adds `createMarker` calls to every individual choice (`CreateXxx`, `EditXxx`, `DeleteXxx`). This is problematic because:

1. **Over-rewards administrative operations** — Creating a stakeholder record shouldn't earn the same reward as issuing securities
2. **Inflates activity metrics** — Not all cap table operations represent genuine financial activity
3. **Misaligned incentives** — Rewards should correlate with economic value creation

### Proposed Change

Markers should only be created when calling the batch `UpdateCapTable` choice, with the caller explicitly specifying how many markers to create based on the financial transactions in the batch.

---

## Decision

**Create 1 marker per financial transaction.** A financial transaction is defined as an operation that:

1. **Creates new securities** (issuances)
2. **Transfers securities between parties** (transfers)

All other OCF object types do not create markers.

---

## OCF Object Classification

### Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Creates 1 marker |
| ❌ | No marker |

---

### Objects (Setup/Configuration)

These are foundational objects that define the cap table structure. They do not represent financial transactions.

| OCF Object | Markers | Rationale |
|------------|---------|-----------|
| **Issuer** | ❌ | Company setup record, not a transaction |
| **Stakeholder** | ❌ | Person/entity record, not a transaction |
| **StockClass** | ❌ | Class definition, not a transaction |
| **StockPlan** | ❌ | Plan definition, not a transaction |
| **StockLegendTemplate** | ❌ | Legal template, not a transaction |
| **VestingTerms** | ❌ | Vesting schedule definition, not a transaction |
| **Valuation** | ❌ | 409A valuation record, not a transaction |
| **Document** | ❌ | Document metadata, not a transaction |

---

### Issuance Transactions (Securities Created)

These represent new securities being issued to stakeholders. Each issuance creates economic value and should earn 1 marker.

| OCF Object | Markers | Rationale |
|------------|---------|-----------|
| **StockIssuance** | ✅ | New stock shares issued to stakeholder |
| **ConvertibleIssuance** | ✅ | New convertible security issued |
| **EquityCompensationIssuance** | ✅ | New options/RSUs issued to stakeholder |
| **WarrantIssuance** | ✅ | New warrant issued |

---

### Transfer Transactions (Securities Change Hands)

These represent securities moving from one stakeholder to another. Each transfer creates economic activity and should earn 1 marker.

| OCF Object | Markers | Rationale |
|------------|---------|-----------|
| **StockTransfer** | ✅ | Stock shares transferred between parties |
| **ConvertibleTransfer** | ✅ | Convertible transferred between parties |
| **EquityCompensationTransfer** | ✅ | Options/RSUs transferred between parties |
| **WarrantTransfer** | ✅ | Warrant transferred between parties |

---

### Acceptance Transactions (Securities Formally Accepted)

These represent stakeholders formally accepting securities. While important legally, acceptances do not create new securities—they acknowledge existing ones.

| OCF Object | Markers | Rationale |
|------------|---------|-----------|
| **StockAcceptance** | ❌ | Acknowledgment of existing issuance |
| **ConvertibleAcceptance** | ❌ | Acknowledgment of existing issuance |
| **EquityCompensationAcceptance** | ❌ | Acknowledgment of existing grant |
| **WarrantAcceptance** | ❌ | Acknowledgment of existing issuance |

---

### Cancellation Transactions (Securities Destroyed)

These represent securities being cancelled/voided. While they modify the cap table, cancellations destroy value rather than creating it.

| OCF Object | Markers | Rationale |
|------------|---------|-----------|
| **StockCancellation** | ❌ | Removes existing securities |
| **ConvertibleCancellation** | ❌ | Removes existing securities |
| **EquityCompensationCancellation** | ❌ | Removes existing grant |
| **WarrantCancellation** | ❌ | Removes existing securities |

---

### Retraction Transactions (Securities Retracted)

These represent the issuer retracting securities (typically due to errors or legal issues). Similar to cancellations, they modify but don't create value.

| OCF Object | Markers | Rationale |
|------------|---------|-----------|
| **StockRetraction** | ❌ | Issuer retracts securities |
| **ConvertibleRetraction** | ❌ | Issuer retracts securities |
| **EquityCompensationRetraction** | ❌ | Issuer retracts grant |
| **WarrantRetraction** | ❌ | Issuer retracts securities |

---

### Conversion/Exercise Transactions (Securities Transformed)

These represent securities being converted from one form to another or exercised. While economically significant, the underlying value was created at issuance.

| OCF Object | Markers | Rationale |
|------------|---------|-----------|
| **StockConversion** | ❌ | Converts existing securities to different class |
| **ConvertibleConversion** | ❌ | Converts existing convertible to stock |
| **EquityCompensationExercise** | ❌ | Exercises existing options/warrants |
| **WarrantExercise** | ❌ | Exercises existing warrant |

---

### Corporate Actions (Structural Changes)

These represent company-wide structural changes that affect all securities of a class. They are administrative in nature.

| OCF Object | Markers | Rationale |
|------------|---------|-----------|
| **IssuerAuthorizedSharesAdjustment** | ❌ | Changes total authorized shares |
| **StockClassAuthorizedSharesAdjustment** | ❌ | Changes class authorized shares |
| **StockClassConversionRatioAdjustment** | ❌ | Changes conversion ratio |
| **StockClassSplit** | ❌ | Stock split (affects all holders equally) |
| **StockConsolidation** | ❌ | Reverse split (affects all holders equally) |
| **StockPlanPoolAdjustment** | ❌ | Adjusts equity pool size |
| **StockPlanReturnToPool** | ❌ | Returns shares to pool |

---

### Other Transactions

| OCF Object | Markers | Rationale |
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

## Summary Table

| Category | OCF Types | Markers |
|----------|-----------|---------|
| **Objects (Setup)** | Issuer, Stakeholder, StockClass, StockPlan, StockLegendTemplate, VestingTerms, Valuation, Document | ❌ None |
| **Issuances** | StockIssuance, ConvertibleIssuance, EquityCompensationIssuance, WarrantIssuance | ✅ 1 each |
| **Transfers** | StockTransfer, ConvertibleTransfer, EquityCompensationTransfer, WarrantTransfer | ✅ 1 each |
| **Acceptances** | StockAcceptance, ConvertibleAcceptance, EquityCompensationAcceptance, WarrantAcceptance | ❌ None |
| **Cancellations** | StockCancellation, ConvertibleCancellation, EquityCompensationCancellation, WarrantCancellation | ❌ None |
| **Retractions** | StockRetraction, ConvertibleRetraction, EquityCompensationRetraction, WarrantRetraction | ❌ None |
| **Conversions/Exercises** | StockConversion, ConvertibleConversion, EquityCompensationExercise, WarrantExercise | ❌ None |
| **Corporate Actions** | All adjustments, splits, consolidations, pool changes | ❌ None |
| **Other Transactions** | Repurchase, Reissuance, Release, Repricing, Vesting events, Status changes | ❌ None |

**Total marker-creating types: 8** (4 issuances + 4 transfers)

---

## Implementation

### UpdateCapTable Choice

The batch `UpdateCapTable` choice accepts an `appRewards` parameter:

```daml
data AppRewardsConfig = AppRewardsConfig with
    couponCount: Int
    featuredAppRight: ContractId FeaturedAppRight

choice UpdateCapTable : UpdateCapTableResult
  with
    creates: [OcfCreateData]
    edits: [OcfEditData]
    deletes: [OcfObjectId]
    appRewards: Optional AppRewardsConfig
  controller context.issuer
```

### Caller Responsibility

The caller (typically the SDK or application layer) is responsible for:

1. Counting the number of issuances and transfers in the batch
2. Passing the appropriate `couponCount` in `AppRewardsConfig`

```typescript
// Example: SDK calculates marker count
const markerCount = batch.creates.filter(c => 
  isIssuance(c) || isTransfer(c)
).length;

await exerciseUpdateCapTable({
  creates: batch.creates,
  edits: batch.edits,
  deletes: batch.deletes,
  appRewards: markerCount > 0 ? {
    couponCount: markerCount,
    featuredAppRight: featuredAppRightCid
  } : null
});
```

---

## Consequences

### Positive

- **Aligned incentives** — Rewards correlate with genuine financial activity
- **Predictable costs** — Each issuance/transfer = 1 marker
- **Simple mental model** — "Did securities get created or change hands?"
- **Flexible** — Caller controls marker creation, not hardcoded in contracts

### Negative

- **SDK complexity** — Caller must count marker-worthy transactions
- **Potential gaming** — Malicious actors could create many small issuances

### Mitigations

- SDK provides helper functions to calculate marker counts
- Business logic in application layer can enforce minimum transaction sizes

---

## Alternatives Considered

### Alternative 1: Marker per operation

Every create/edit/delete operation creates a marker. Rejected because:
- Over-rewards administrative operations
- Incentivizes unnecessary edits

### Alternative 2: Marker per batch

One marker per `UpdateCapTable` call regardless of contents. Rejected because:
- Under-rewards batches with many issuances
- Doesn't scale with actual activity

### Alternative 3: Contract-level marker logic

Contracts internally decide whether to create markers. Rejected because:
- Inflexible — can't change policy without contract upgrade
- Complex — marker logic spread across generated code

---

## References

- [Task: Add App Rewards to Batch UpdateCapTable](../../tasks/2026/01/2026.01.08-batch-captable-app-rewards.md)
- [Task: Review Marker Creation Logic](../../tasks/2026/01/2026.01.09-review-marker-creation-logic.md)
- [ADR-002: Stateful Cap Table](./002-stateful-issuer-with-position-tracking.md)
- [Splice Featured App API](https://github.com/digital-asset/decentralized-canton-sync)

---

## Changelog

| Date | Change | PR |
|------|--------|-----|
| 2026-01-09 | Created proposal | — |

---

_Last updated: 2026-01-09_
