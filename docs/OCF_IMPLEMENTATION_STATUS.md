# OCF Object Types Implementation Status

This document tracks the implementation status of [Open Cap Format (OCF)](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF) object types in this DAML repository. It serves as a checklist for remaining implementation work.

> **Authority**: The canonical reference for OCF schema is https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF

## Summary

| Category | Implemented | Total | Coverage |
|----------|-------------|-------|----------|
| **Objects (Core)** | 8 | 9 | 89% |
| **Transactions - Issuance** | 4 | 4 | 100% |
| **Transactions - Cancellation** | 4 | 4 | 100% |
| **Transactions - Transfer** | 4 | 4 | 100% |
| **Transactions - Acceptance** | 4 | 4 | 100% |
| **Transactions - Exercise** | 2 | 2 | 100% |
| **Transactions - Conversion** | 2 | 2 | 100% |
| **Transactions - Adjustment** | 4 | 6 | 67% |
| **Transactions - Retraction** | 4 | 4 | 100% |
| **Transactions - Other** | 3 | 5 | 60% |
| **Transactions - Vesting** | 3 | 3 | 100% |
| **Change Events** | 0 | 2 | 0% |
| **TOTAL** | 42 | 52 | 81% |

---

## OCF Objects (Core/Static)

These are the foundational objects that define the structure of a cap table.

| Object Type | Status | DAML Module | Tests | Notes |
|-------------|--------|-------------|-------|-------|
| **Issuer** | ✅ Implemented | `Issuer.daml` | ✅ | Company whose cap table this is |
| **Stakeholder** | ✅ Implemented | `Stakeholder.daml` | ✅ | Individuals/institutions holding securities |
| **StockClass** | ✅ Implemented | `StockClass.daml` | ✅ | Classes of stock (Common, Preferred, etc.) |
| **StockLegendTemplate** | ✅ Implemented | `StockLegendTemplate.daml` | ✅ | Legend templates for stock certificates |
| **StockPlan** | ✅ Implemented | `StockPlan.daml` | ✅ | Equity incentive plans |
| **VestingTerms** | ✅ Implemented | `VestingTerms.daml` | ✅ | Vesting schedule definitions |
| **Valuation** | ✅ Implemented | `Valuation.daml` | ✅ | 409A and other valuations |
| **Document** | ✅ Implemented | `Document.daml` | ✅ | Document references and metadata |
| **Financing** | ❌ Not Started | — | — | Financing round objects |

---

## OCF Transactions - Issuance

Transactions that create new securities.

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_STOCK_ISSUANCE** | ✅ Implemented | `StockIssuance.daml` | ✅ | Stock issuance (including RSAs via `stock_plan_id`) |
| **TX_CONVERTIBLE_ISSUANCE** | ✅ Implemented | `ConvertibleIssuance.daml` | ✅ | SAFE, Note, and other convertible issuances |
| **TX_WARRANT_ISSUANCE** | ✅ Implemented | `WarrantIssuance.daml` | ✅ | Warrant issuances with exercise triggers |
| **TX_EQUITY_COMPENSATION_ISSUANCE** | ✅ Implemented | `EquityCompensationIssuance.daml` | ✅ | Options (ISO/NSO), RSUs, SARs |

---

## OCF Transactions - Cancellation

Transactions that cancel securities.

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_STOCK_CANCELLATION** | ✅ Implemented | `StockCancellation.daml` | ✅ | Supports partial cancellations with `balance_security_id` |
| **TX_CONVERTIBLE_CANCELLATION** | ✅ Implemented | `ConvertibleCancellation.daml` | ✅ | Cancel convertible instruments |
| **TX_WARRANT_CANCELLATION** | ✅ Implemented | `WarrantCancellation.daml` | ✅ | Cancel warrant instruments |
| **TX_EQUITY_COMPENSATION_CANCELLATION** | ✅ Implemented | `EquityCompensationCancellation.daml` | ✅ | Cancel equity compensation grants |

---

## OCF Transactions - Transfer

Transactions that transfer securities between stakeholders. Per OCF spec, transfers require companion re-papered issuances.

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_STOCK_TRANSFER** | ✅ Implemented | `StockTransfer.daml` | ✅ | Transfer stock to new holder |
| **TX_CONVERTIBLE_TRANSFER** | ✅ Implemented | `ConvertibleTransfer.daml` | ✅ | Transfer convertibles (uses `amount`) |
| **TX_WARRANT_TRANSFER** | ✅ Implemented | `WarrantTransfer.daml` | ✅ | Transfer warrants |
| **TX_EQUITY_COMPENSATION_TRANSFER** | ✅ Implemented | `EquityCompensationTransfer.daml` | ✅ | Transfer equity compensation (rare) |

---

## OCF Transactions - Acceptance

Optional metadata-only transactions recording stakeholder acceptance of securities.

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_STOCK_ACCEPTANCE** | ✅ Implemented | `StockAcceptance.daml` | ✅ | Record stock acceptance |
| **TX_CONVERTIBLE_ACCEPTANCE** | ✅ Implemented | `ConvertibleAcceptance.daml` | ✅ | Record convertible acceptance |
| **TX_WARRANT_ACCEPTANCE** | ✅ Implemented | `WarrantAcceptance.daml` | ✅ | Record warrant acceptance |
| **TX_EQUITY_COMPENSATION_ACCEPTANCE** | ✅ Implemented | `EquityCompensationAcceptance.daml` | ✅ | Record equity comp acceptance |

---

## OCF Transactions - Exercise

Transactions that exercise convertible securities into stock.

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_EQUITY_COMPENSATION_EXERCISE** | ✅ Implemented | `EquityCompensationExercise.daml` | ✅ | Exercise options/SARs |
| **TX_WARRANT_EXERCISE** | ✅ Implemented | `WarrantExercise.daml` | ✅ | Exercise warrants into stock |

---

## OCF Transactions - Conversion

Transactions that convert securities.

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_STOCK_CONVERSION** | ✅ Implemented | `StockConversion.daml` | ✅ | Manual stock conversions (e.g., preferred → common) |
| **TX_CONVERTIBLE_CONVERSION** | ✅ Implemented | `ConvertibleConversion.daml` | ✅ | Convert SAFEs/Notes to stock |

---

## OCF Transactions - Adjustment

Transactions that adjust cap table parameters.

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_ISSUER_AUTHORIZED_SHARES_ADJUSTMENT** | ✅ Implemented | `IssuerAuthorizedSharesAdjustment.daml` | ✅ | Adjust issuer-level authorized shares |
| **TX_STOCK_CLASS_AUTHORIZED_SHARES_ADJUSTMENT** | ✅ Implemented | `StockClassAuthorizedSharesAdjustment.daml` | ✅ | Adjust stock class authorized shares |
| **TX_STOCK_PLAN_POOL_ADJUSTMENT** | ✅ Implemented | `StockPlanPoolAdjustment.daml` | ✅ | Adjust stock plan pool size |
| **TX_STOCK_CLASS_CONVERSION_RATIO_ADJUSTMENT** | ❌ Not Started | — | — | Adjust conversion ratios (anti-dilution) |
| **TX_STOCK_CLASS_SPLIT** | ✅ Implemented | `StockClassSplit.daml` | ✅ | Stock splits (forward/reverse) |
| **TX_STOCK_PLAN_RETURN_TO_POOL** | ❌ Not Started | — | — | Return cancelled shares to pool |

---

## OCF Transactions - Retraction

Transactions that invalidate prior issuances (ab initio).

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_STOCK_RETRACTION** | ✅ Implemented | `StockRetraction.daml` | ✅ | Retract stock issuance |
| **TX_CONVERTIBLE_RETRACTION** | ✅ Implemented | `ConvertibleRetraction.daml` | ✅ | Retract convertible issuance |
| **TX_WARRANT_RETRACTION** | ✅ Implemented | `WarrantRetraction.daml` | ✅ | Retract warrant issuance |
| **TX_EQUITY_COMPENSATION_RETRACTION** | ✅ Implemented | `EquityCompensationRetraction.daml` | ✅ | Retract equity comp grant |

---

## OCF Transactions - Other

Other security lifecycle transactions.

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_STOCK_REPURCHASE** | ✅ Implemented | `StockRepurchase.daml` | ✅ | Company repurchase of stock |
| **TX_STOCK_REISSUANCE** | ✅ Implemented | `StockReissuance.daml` | ✅ | Re-paper stock certificates |
| **TX_STOCK_CONSOLIDATION** | ✅ Implemented | `StockConsolidation.daml` | ✅ | Merge multiple securities into one |
| **TX_EQUITY_COMPENSATION_RELEASE** | ❌ Not Started | — | — | RSU/restricted stock release |
| **TX_EQUITY_COMPENSATION_REPRICING** | ❌ Not Started | — | — | Reprice equity compensation |

---

## OCF Transactions - Vesting

Transactions that manage vesting schedules.

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_VESTING_START** | ✅ Implemented | `VestingStart.daml` | ✅ | Start vesting clock |
| **TX_VESTING_EVENT** | ✅ Implemented | `VestingEvent.daml` | ✅ | Record explicit vesting event |
| **TX_VESTING_ACCELERATION** | ✅ Implemented | `VestingAcceleration.daml` | ✅ | Accelerate vesting |

---

## OCF Change Events

Metadata events for stakeholder changes (optional per OCF spec, no cap table impact).

| Event Type | Status | DAML Module | Tests | Notes |
|------------|--------|-------------|-------|-------|
| **TX_STAKEHOLDER_RELATIONSHIP_CHANGE_EVENT** | ❌ Not Started | — | — | Track relationship changes |
| **TX_STAKEHOLDER_STATUS_CHANGE_EVENT** | ❌ Not Started | — | — | Track status changes (termination, etc.) |

---

## Deprecated OCF Types

These are deprecated aliases in OCF v1.x that route to equity compensation equivalents.

| Deprecated Type | Status | Maps To |
|-----------------|--------|---------|
| TX_PLAN_SECURITY_ISSUANCE | N/A | TX_EQUITY_COMPENSATION_ISSUANCE |
| TX_PLAN_SECURITY_EXERCISE | N/A | TX_EQUITY_COMPENSATION_EXERCISE |
| TX_PLAN_SECURITY_RELEASE | N/A | TX_EQUITY_COMPENSATION_RELEASE |
| TX_PLAN_SECURITY_CANCELLATION | N/A | TX_EQUITY_COMPENSATION_CANCELLATION |
| TX_PLAN_SECURITY_RETRACTION | N/A | TX_EQUITY_COMPENSATION_RETRACTION |
| TX_PLAN_SECURITY_TRANSFER | N/A | TX_EQUITY_COMPENSATION_TRANSFER |
| TX_PLAN_SECURITY_ACCEPTANCE | N/A | TX_EQUITY_COMPENSATION_ACCEPTANCE |

> **Note**: We do not plan to implement deprecated types. Our implementation uses the current naming convention.

---

## Implementation Priority Recommendations

### High Priority (Remaining)
1. **TX_EQUITY_COMPENSATION_RELEASE** - RSU settlements
2. **TX_STOCK_CLASS_CONVERSION_RATIO_ADJUSTMENT** - Anti-dilution adjustments
3. **TX_STOCK_PLAN_RETURN_TO_POOL** - Return cancelled shares to pool

### Medium Priority
4. **TX_EQUITY_COMPENSATION_REPRICING** - Reprice equity compensation
5. **Financing object** - Financing round tracking

### Lower Priority (Optional/Edge Cases)
6. **TX_STAKEHOLDER_RELATIONSHIP_CHANGE_EVENT** - Track relationship changes
7. **TX_STAKEHOLDER_STATUS_CHANGE_EVENT** - Track status changes

---

## Types and Enums Implementation

The `Types.daml` module contains shared OCF types and enums. Current implementation includes:

### Implemented Types
- `OcfMonetary` - Currency amounts
- `OcfRatio` - Mathematical ratios
- `OcfAddress` - Addresses with country codes
- `OcfEmail` / `OcfPhone` - Contact information
- `OcfTaxID` - Tax identifiers
- `OcfVesting` - Vesting schedule entries
- `OcfTerminationWindow` - Post-termination exercise windows
- `OcfSecurityExemption` - Securities law exemptions
- `OcfShareNumberRange` - Certificate share ranges
- `OcfCapitalizationDefinition` - Cap calculation rules
- `OcfInterestRate` - Interest rate definitions
- Conversion rights and triggers (Stock, Warrant, Convertible)
- Conversion mechanisms (SAFE, Note, Ratio, Custom, etc.)

### Implemented Enums
- `OcfStockClassType` - Common/Preferred
- `OcfCompensationType` - Option types, RSU, SAR
- `OcfConvertibleType` - SAFE/Note/Security
- `OcfStakeholderType` - Individual/Institution
- `OcfStakeholderRelationshipType` - Employee, Investor, etc.
- `OcfValuationType` - 409A
- `OcfObjectType` - All OCF object type identifiers
- Various period, trigger, and mechanism enums

---

## Related Documentation

- **Repository README**: `/README.md` - Package structure and coding guidelines
- **AI Context**: `/llms.txt` - DAML coding standards and quick reference
- **Package README**: `/OpenCapTable-v25/README.md` - Implementation-specific guidance
- **OCF Schema**: https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF/tree/main/schema

---

## Changelog

| Date | Update |
|------|--------|
| 2025-12-24 | Added Exercise, Conversion, Vesting, and Stock Operations (42/52, 81%) - Exercise, Conversion, Vesting categories complete |
| 2025-12-24 | Added all Acceptance and Retraction transactions (32/52, 62%) - Both categories complete |
| 2025-12-24 | Added all Transfer transactions (24/52, 46%) - Transfer category complete |
| 2025-12-23 | Added TX_WARRANT_CANCELLATION and TX_EQUITY_COMPENSATION_CANCELLATION (20/52, 38%) - Cancellation category complete |
| 2025-12-23 | Added TX_CONVERTIBLE_CANCELLATION (18/52, 35%) |
| 2024-12-15 | Initial status document created |
