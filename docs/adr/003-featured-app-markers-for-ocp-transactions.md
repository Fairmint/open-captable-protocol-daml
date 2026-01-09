# ADR-003: Featured App Markers for OCP Transactions

## Status

**Proposed** | 2026-01-09

---

## TL;DR

Featured app markers (Canton Network app rewards) are created for **financial transactions**—specifically issuances and transfers of securities. Administrative objects (stakeholders, stock classes, etc.) and corporate actions (splits, adjustments, etc.) do not create markers.

---

## Context

### Canton Network Featured App Rewards

The Canton Network provides a mechanism for rewarding apps that drive network activity through "Featured App Markers." When an app creates activity markers, it earns rewards proportional to the activity it generates.

### Marker Creation Policy

Markers are created when the Fairmint operator calls the batch `UpdateCapTable` choice. The number of markers created corresponds to the number of financial transactions in the batch.

---

## Decision

**Create 1 marker per financial transaction.** A financial transaction is defined as an operation that:

1. **Creates new securities** (issuances)
2. **Transfers securities between parties** (transfers)

All other OCF object types do not create markers.

---

## OCF Object Classification

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

## References

- [ADR-002: Stateful Cap Table](./002-stateful-issuer-with-position-tracking.md)
- [Splice Featured App API](https://github.com/digital-asset/decentralized-canton-sync)

---

## Appendix: Detailed OCF Object Classification

### Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Creates 1 marker |
| ❌ | No marker |

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

### Issuance Transactions (Securities Created)

These represent new securities being issued to stakeholders. Each issuance creates economic value and earns 1 marker.

| OCF Object | Markers | Rationale |
|------------|---------|-----------|
| **StockIssuance** | ✅ | New stock shares issued to stakeholder |
| **ConvertibleIssuance** | ✅ | New convertible security issued |
| **EquityCompensationIssuance** | ✅ | New options/RSUs issued to stakeholder |
| **WarrantIssuance** | ✅ | New warrant issued |

### Transfer Transactions (Securities Change Hands)

These represent securities moving from one stakeholder to another. Each transfer creates economic activity and earns 1 marker.

| OCF Object | Markers | Rationale |
|------------|---------|-----------|
| **StockTransfer** | ✅ | Stock shares transferred between parties |
| **ConvertibleTransfer** | ✅ | Convertible transferred between parties |
| **EquityCompensationTransfer** | ✅ | Options/RSUs transferred between parties |
| **WarrantTransfer** | ✅ | Warrant transferred between parties |

### Acceptance Transactions (Securities Formally Accepted)

These represent stakeholders formally accepting securities. While important legally, acceptances do not create new securities—they acknowledge existing ones.

| OCF Object | Markers | Rationale |
|------------|---------|-----------|
| **StockAcceptance** | ❌ | Acknowledgment of existing issuance |
| **ConvertibleAcceptance** | ❌ | Acknowledgment of existing issuance |
| **EquityCompensationAcceptance** | ❌ | Acknowledgment of existing grant |
| **WarrantAcceptance** | ❌ | Acknowledgment of existing issuance |

### Cancellation Transactions (Securities Destroyed)

These represent securities being cancelled/voided. While they modify the cap table, cancellations destroy value rather than creating it.

| OCF Object | Markers | Rationale |
|------------|---------|-----------|
| **StockCancellation** | ❌ | Removes existing securities |
| **ConvertibleCancellation** | ❌ | Removes existing securities |
| **EquityCompensationCancellation** | ❌ | Removes existing grant |
| **WarrantCancellation** | ❌ | Removes existing securities |

### Retraction Transactions (Securities Retracted)

These represent the issuer retracting securities (typically due to errors or legal issues). Similar to cancellations, they modify but don't create value.

| OCF Object | Markers | Rationale |
|------------|---------|-----------|
| **StockRetraction** | ❌ | Issuer retracts securities |
| **ConvertibleRetraction** | ❌ | Issuer retracts securities |
| **EquityCompensationRetraction** | ❌ | Issuer retracts grant |
| **WarrantRetraction** | ❌ | Issuer retracts securities |

### Conversion/Exercise Transactions (Securities Transformed)

These represent securities being converted from one form to another or exercised. While economically significant, the underlying value was created at issuance.

| OCF Object | Markers | Rationale |
|------------|---------|-----------|
| **StockConversion** | ❌ | Converts existing securities to different class |
| **ConvertibleConversion** | ❌ | Converts existing convertible to stock |
| **EquityCompensationExercise** | ❌ | Exercises existing options/warrants |
| **WarrantExercise** | ❌ | Exercises existing warrant |

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

## Changelog

| Date | Change | PR |
|------|--------|-----|
| 2026-01-09 | Created proposal | — |

---

_Last updated: 2026-01-09_
