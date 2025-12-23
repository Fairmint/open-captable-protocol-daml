# OCF Object Types Implementation Status

This document tracks the implementation status of [Open Cap Format (OCF)](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF) object types in this DAML repository. It serves as a checklist for remaining implementation work.

> **Authority**: The canonical reference for OCF schema is https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF

## Summary

| Category | Implemented | Total | Coverage |
|----------|-------------|-------|----------|
| **Objects (Core)** | 8 | 9 | 89% |
| **Transactions - Issuance** | 4 | 4 | 100% |
| **Transactions - Cancellation** | 2 | 4 | 50% |
| **Transactions - Transfer** | 0 | 4 | 0% |
| **Transactions - Acceptance** | 0 | 4 | 0% |
| **Transactions - Exercise** | 1 | 2 | 50% |
| **Transactions - Conversion** | 0 | 2 | 0% |
| **Transactions - Adjustment** | 3 | 6 | 50% |
| **Transactions - Retraction** | 0 | 4 | 0% |
| **Transactions - Other** | 0 | 8 | 0% |
| **Transactions - Vesting** | 0 | 3 | 0% |
| **Change Events** | 0 | 2 | 0% |
| **TOTAL** | 18 | 52 | 35% |

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
| **TX_CONVERTIBLE_CANCELLATION** | ✅ Implemented | `ConvertibleCancellation.daml` | ✅ | Cancel convertible instruments; uses `amount` (monetary) instead of `quantity` |
| **TX_WARRANT_CANCELLATION** | ❌ Not Started | — | — | Cancel warrant instruments |
| **TX_EQUITY_COMPENSATION_CANCELLATION** | ❌ Not Started | — | — | Cancel equity compensation grants |

---

## OCF Transactions - Transfer

Transactions that transfer securities between stakeholders. Per OCF spec, transfers require companion re-papered issuances.

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_STOCK_TRANSFER** | ❌ Not Started | — | — | Transfer stock to new holder |
| **TX_CONVERTIBLE_TRANSFER** | ❌ Not Started | — | — | Transfer convertibles |
| **TX_WARRANT_TRANSFER** | ❌ Not Started | — | — | Transfer warrants |
| **TX_EQUITY_COMPENSATION_TRANSFER** | ❌ Not Started | — | — | Transfer equity compensation |

---

## OCF Transactions - Acceptance

Optional metadata-only transactions recording stakeholder acceptance of securities.

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_STOCK_ACCEPTANCE** | ❌ Not Started | — | — | Record stock acceptance |
| **TX_CONVERTIBLE_ACCEPTANCE** | ❌ Not Started | — | — | Record convertible acceptance |
| **TX_WARRANT_ACCEPTANCE** | ❌ Not Started | — | — | Record warrant acceptance |
| **TX_EQUITY_COMPENSATION_ACCEPTANCE** | ❌ Not Started | — | — | Record equity comp acceptance |

---

## OCF Transactions - Exercise

Transactions that exercise convertible securities into stock.

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_EQUITY_COMPENSATION_EXERCISE** | ✅ Implemented | `EquityCompensationExercise.daml` | ✅ | Exercise options/SARs |
| **TX_WARRANT_EXERCISE** | ❌ Not Started | — | — | Exercise warrants into stock |

---

## OCF Transactions - Conversion

Transactions that convert securities.

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_STOCK_CONVERSION** | ❌ Not Started | — | — | Manual stock conversions (e.g., preferred → common) |
| **TX_CONVERTIBLE_CONVERSION** | ❌ Not Started | — | — | Convert SAFEs/Notes to stock |

---

## OCF Transactions - Adjustment

Transactions that adjust cap table parameters.

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_ISSUER_AUTHORIZED_SHARES_ADJUSTMENT** | ✅ Implemented | `IssuerAuthorizedSharesAdjustment.daml` | ✅ | Adjust issuer-level authorized shares |
| **TX_STOCK_CLASS_AUTHORIZED_SHARES_ADJUSTMENT** | ✅ Implemented | `StockClassAuthorizedSharesAdjustment.daml` | ✅ | Adjust stock class authorized shares |
| **TX_STOCK_PLAN_POOL_ADJUSTMENT** | ✅ Implemented | `StockPlanPoolAdjustment.daml` | ✅ | Adjust stock plan pool size |
| **TX_STOCK_CLASS_CONVERSION_RATIO_ADJUSTMENT** | ❌ Not Started | — | — | Adjust conversion ratios (anti-dilution) |
| **TX_STOCK_CLASS_SPLIT** | ❌ Not Started | — | — | Stock splits (forward/reverse) |
| **TX_STOCK_PLAN_RETURN_TO_POOL** | ❌ Not Started | — | — | Return cancelled shares to pool |

---

## OCF Transactions - Retraction

Transactions that invalidate prior issuances (ab initio).

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_STOCK_RETRACTION** | ❌ Not Started | — | — | Retract stock issuance |
| **TX_CONVERTIBLE_RETRACTION** | ❌ Not Started | — | — | Retract convertible issuance |
| **TX_WARRANT_RETRACTION** | ❌ Not Started | — | — | Retract warrant issuance |
| **TX_EQUITY_COMPENSATION_RETRACTION** | ❌ Not Started | — | — | Retract equity comp grant |

---

## OCF Transactions - Other

Other security lifecycle transactions.

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_STOCK_REPURCHASE** | ❌ Not Started | — | — | Company repurchase of stock |
| **TX_STOCK_REISSUANCE** | ❌ Not Started | — | — | Re-paper stock certificates |
| **TX_STOCK_CONSOLIDATION** | ❌ Not Started | — | — | Merge multiple securities into one |
| **TX_EQUITY_COMPENSATION_RELEASE** | ❌ Not Started | — | — | RSU/restricted stock release |
| **TX_EQUITY_COMPENSATION_REPRICING** | ❌ Not Started | — | — | Reprice equity compensation |

---

## OCF Transactions - Vesting

Transactions that manage vesting schedules.

| Transaction Type | Status | DAML Module | Tests | Notes |
|------------------|--------|-------------|-------|-------|
| **TX_VESTING_START** | ❌ Not Started | — | — | Start vesting clock |
| **TX_VESTING_EVENT** | ❌ Not Started | — | — | Record explicit vesting event |
| **TX_VESTING_ACCELERATION** | ❌ Not Started | — | — | Accelerate vesting |

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

### High Priority (Core Cap Table Operations)
1. **TX_STOCK_TRANSFER** - Required for secondary sales and stakeholder changes
2. **TX_CONVERTIBLE_CONVERSION** - Required for financing rounds
3. **TX_WARRANT_EXERCISE** - Complete exercise transaction coverage
4. **TX_STOCK_REPURCHASE** - Common corporate action

### Medium Priority (Complete Transaction Coverage)
5. **TX_CONVERTIBLE_CANCELLATION** - Cancel unconverted instruments
6. **TX_WARRANT_CANCELLATION** - Cancel unexercised warrants
7. **TX_EQUITY_COMPENSATION_CANCELLATION** - Handle forfeitures
8. **TX_EQUITY_COMPENSATION_RELEASE** - RSU settlements
9. **TX_STOCK_CLASS_SPLIT** - Stock split operations
10. **TX_STOCK_CLASS_CONVERSION_RATIO_ADJUSTMENT** - Anti-dilution adjustments

### Lower Priority (Advanced/Edge Cases)
11. **TX_VESTING_START/EVENT/ACCELERATION** - Vesting lifecycle management
12. **Acceptance transactions** - Optional metadata
13. **Retraction transactions** - Error correction
14. **Change events** - Stakeholder metadata tracking
15. **Financing object** - Financing round tracking

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
| 2025-12-23 | Added TX_CONVERTIBLE_CANCELLATION (18/52, 35%) |
| 2024-12-15 | Initial status document created |
