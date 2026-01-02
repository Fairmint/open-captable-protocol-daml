# ADR-002: Stateful Issuer with Embedded OCF Objects

## Status

**Proposed** | 2026-01-02

## Context

The current OpenCapTable implementation on Canton uses an event-sourcing pattern where:

1. The `Issuer` contract acts as a factory with ~40+ nonconsuming choices to create OCF object contracts
2. Each transaction (issuance, transfer, cancellation) creates an independent contract
3. There's no on-chain tracking of current state—determining "what does Alice own?" requires off-chain event replay
4. Reference integrity is not enforced—IDs like `stakeholder_id` and `stock_class_id` are just strings with no validation that the referenced objects exist
5. Contract keys are not available on Canton Network, making lookups by business ID difficult

This creates several problems:

- **No current state visibility**: To know current ownership, you must query all events and replay them off-chain
- **No reference integrity**: Can issue stock to a non-existent stakeholder or reference invalid stock classes
- **Scattered data**: Cap table data spread across many contracts, hard to query holistically
- **No business rule enforcement**: Can't enforce rules like "issued shares must not exceed authorized shares" on-chain

## Decision

Redesign the OpenCapTable architecture to use a **Stateful Issuer** pattern where:

1. A single `IssuerState` contract per issuer contains **all OCF objects as arrays**
2. Objects are stored in their native OCF format (no transformation)
3. Arrays are sorted by creation date for consistent ordering
4. Computed values (balances, totals) are derived on-demand by looping through relevant arrays
5. Aggregates/indexes can be added later when scale requires it

### Design Principles

1. **Simplicity over optimization**: Loop through arrays rather than maintain derived state
2. **OCF objects as-is**: Store the standard OCF data structures directly
3. **No computed aggregates**: Avoid state that could get out of sync
4. **Scale later**: Add caching/indexes when hitting limits, not before

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         IssuerState                              │
│  (1 contract per issuer - contains all cap table data)          │
├─────────────────────────────────────────────────────────────────┤
│  context: Context                                                │
│  issuer_data: OcfIssuerData                                     │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ OBJECTS (arrays, sorted by creation date)                   ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ stakeholders: [OcfStakeholderData]                          ││
│  │ stock_classes: [OcfStockClassData]                          ││
│  │ stock_plans: [OcfStockPlanData]                             ││
│  │ stock_legend_templates: [OcfStockLegendTemplateData]        ││
│  │ vesting_terms: [OcfVestingTermsData]                        ││
│  │ documents: [OcfDocument]                                    ││
│  │ valuations: [OcfValuationData]                              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ TRANSACTIONS (arrays, sorted by date)                       ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ stock_issuances: [OcfStockIssuanceData]                     ││
│  │ stock_transfers: [OcfStockTransferData]                     ││
│  │ stock_cancellations: [OcfStockCancellationData]             ││
│  │ equity_compensation_issuances: [OcfEquityCompIssuanceData]  ││
│  │ convertible_issuances: [OcfConvertibleIssuanceData]         ││
│  │ warrant_issuances: [OcfWarrantIssuanceData]                 ││
│  │ ... (all other transaction types)                           ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Core Template Structure

```daml
template IssuerState
  with
    context: Context
    issuer_data: OcfIssuerData
    
    -- Objects (sorted by creation date)
    stakeholders: [OcfStakeholderData]
    stock_classes: [OcfStockClassData]
    stock_plans: [OcfStockPlanData]
    stock_legend_templates: [OcfStockLegendTemplateData]
    vesting_terms: [OcfVestingTermsData]
    documents: [OcfDocument]
    
    -- Stock transactions
    stock_issuances: [OcfStockIssuanceData]
    stock_transfers: [OcfStockTransferData]
    stock_cancellations: [OcfStockCancellationData]
    stock_repurchases: [OcfStockRepurchaseData]
    stock_reissuances: [OcfStockReissuanceData]
    stock_conversions: [OcfStockConversionData]
    stock_acceptances: [OcfStockAcceptanceData]
    stock_retractions: [OcfStockRetractionData]
    
    -- Equity compensation transactions
    equity_comp_issuances: [OcfEquityCompensationIssuanceData]
    equity_comp_exercises: [OcfEquityCompensationExerciseData]
    equity_comp_cancellations: [OcfEquityCompensationCancellationData]
    equity_comp_transfers: [OcfEquityCompensationTransferData]
    equity_comp_acceptances: [OcfEquityCompensationAcceptanceData]
    equity_comp_retractions: [OcfEquityCompensationRetractionData]
    equity_comp_releases: [OcfEquityCompensationReleaseData]
    equity_comp_repricings: [OcfEquityCompensationRepricingData]
    
    -- Convertible transactions
    convertible_issuances: [OcfConvertibleIssuanceData]
    convertible_transfers: [OcfConvertibleTransferData]
    convertible_conversions: [OcfConvertibleConversionData]
    convertible_cancellations: [OcfConvertibleCancellationData]
    convertible_acceptances: [OcfConvertibleAcceptanceData]
    convertible_retractions: [OcfConvertibleRetractionData]
    
    -- Warrant transactions
    warrant_issuances: [OcfWarrantIssuanceData]
    warrant_transfers: [OcfWarrantTransferData]
    warrant_exercises: [OcfWarrantExerciseData]
    warrant_cancellations: [OcfWarrantCancellationData]
    warrant_acceptances: [OcfWarrantAcceptanceData]
    warrant_retractions: [OcfWarrantRetractionData]
    
    -- Vesting transactions
    vesting_starts: [OcfVestingStartData]
    vesting_events: [OcfVestingEventData]
    vesting_accelerations: [OcfVestingAccelerationData]
    
    -- Adjustment transactions
    issuer_authorized_shares_adjustments: [OcfIssuerAuthorizedSharesAdjustmentData]
    stock_class_authorized_shares_adjustments: [OcfStockClassAuthorizedSharesAdjustmentData]
    stock_class_conversion_ratio_adjustments: [OcfStockClassConversionRatioAdjustmentData]
    stock_class_splits: [OcfStockClassSplitData]
    stock_plan_pool_adjustments: [OcfStockPlanPoolAdjustmentData]
    stock_plan_returns_to_pool: [OcfStockPlanReturnToPoolData]
    
    -- Stakeholder events
    stakeholder_relationship_changes: [OcfStakeholderRelationshipChangeEventData]
    stakeholder_status_changes: [OcfStakeholderStatusChangeEventData]
    
  where
    signatory context.issuer, context.system_operator
```

### Helper Functions for Queries

```daml
-- Find stakeholder by ID (loops through array)
findStakeholder : Text -> [OcfStakeholderData] -> Optional OcfStakeholderData
findStakeholder id stakeholders = 
  find (\s -> s.id == id) stakeholders

-- Check if stakeholder exists
stakeholderExists : Text -> [OcfStakeholderData] -> Bool
stakeholderExists id stakeholders = 
  isSome (findStakeholder id stakeholders)

-- Find stock class by ID
findStockClass : Text -> [OcfStockClassData] -> Optional OcfStockClassData
findStockClass id classes = 
  find (\c -> c.id == id) classes

-- Get all active securities for a stakeholder
-- (issuances minus cancellations/transfers out)
getStakeholderSecurities : Text -> IssuerState -> [SecurityInfo]
getStakeholderSecurities stakeholderId state =
  let 
    -- Get all issuances for this stakeholder
    stockIssuances = filter (\i -> i.stakeholder_id == stakeholderId) state.stock_issuances
    
    -- Get security IDs that have been cancelled or transferred
    cancelledIds = map (.security_id) state.stock_cancellations
    transferredIds = map (.security_id) state.stock_transfers
    inactiveIds = cancelledIds ++ transferredIds
    
    -- Filter to active securities
    activeIssuances = filter (\i -> not (i.security_id `elem` inactiveIds)) stockIssuances
  in
    map toSecurityInfo activeIssuances

-- Calculate shares issued for a stock class
getSharesIssuedForClass : Text -> IssuerState -> Decimal
getSharesIssuedForClass classId state =
  let
    -- Sum issuances for this class
    issuances = filter (\i -> i.stock_class_id == classId) state.stock_issuances
    totalIssued = sum (map (.quantity) issuances)
    
    -- Subtract cancellations
    cancellations = filter (\c -> 
      any (\i -> i.security_id == c.security_id && i.stock_class_id == classId) 
          state.stock_issuances
    ) state.stock_cancellations
    totalCancelled = sum (map (.quantity) cancellations)
  in
    totalIssued - totalCancelled
```

### Example: Stock Issuance

```daml
    choice IssueStock : ContractId IssuerState
      with
        issuance_data: OcfStockIssuanceData
      controller context.issuer
      do
        -- VALIDATION: Stakeholder must exist
        assertMsg "Stakeholder not found" 
          (stakeholderExists issuance_data.stakeholder_id stakeholders)
        
        -- VALIDATION: Stock class must exist
        let maybeClass = findStockClass issuance_data.stock_class_id stock_classes
        assertMsg "Stock class not found" (isSome maybeClass)
        let stockClass = fromSome maybeClass
        
        -- VALIDATION: Security ID must be unique
        let existingIds = map (.security_id) stock_issuances
        assertMsg "Security ID already exists" 
          (not (issuance_data.security_id `elem` existingIds))
        
        -- VALIDATION: Sufficient authorized shares
        let currentIssued = getSharesIssuedForClass issuance_data.stock_class_id this
        let newTotal = currentIssued + issuance_data.quantity
        assertMsg "Exceeds authorized shares" 
          (newTotal <= stockClass.initial_shares_authorized)
        
        -- Create marker for featured app rewards
        createMarker context
        
        -- Append to array (sorted by date)
        let newIssuances = sortOn (.date) (issuance_data :: stock_issuances)
        
        create this with stock_issuances = newIssuances
```

### Example: Stock Transfer

```daml
    choice TransferStock : ContractId IssuerState
      with
        transfer_data: OcfStockTransferData
      controller context.issuer
      do
        -- VALIDATION: Source security exists
        let maybeIssuance = find (\i -> i.security_id == transfer_data.security_id) stock_issuances
        assertMsg "Security not found" (isSome maybeIssuance)
        let sourceIssuance = fromSome maybeIssuance
        
        -- VALIDATION: Security not already cancelled/transferred
        let cancelledIds = map (.security_id) stock_cancellations
        let transferredIds = map (.security_id) stock_transfers
        assertMsg "Security already cancelled" 
          (not (transfer_data.security_id `elem` cancelledIds))
        assertMsg "Security already transferred" 
          (not (transfer_data.security_id `elem` transferredIds))
        
        -- VALIDATION: Recipient exists
        assertMsg "Recipient not found" 
          (stakeholderExists transfer_data.resulting_security_stakeholder_id stakeholders)
        
        -- VALIDATION: Quantity check
        assertMsg "Transfer quantity exceeds holdings" 
          (transfer_data.quantity <= sourceIssuance.quantity)
        
        createMarker context
        
        -- Record transfer
        let newTransfers = sortOn (.date) (transfer_data :: stock_transfers)
        
        -- Create new issuance for recipient
        let newIssuance = sourceIssuance with
              id = transfer_data.id <> "_issuance"
              security_id = transfer_data.resulting_security_id
              stakeholder_id = transfer_data.resulting_security_stakeholder_id
              quantity = transfer_data.quantity
              date = transfer_data.date
        
        let newIssuances = sortOn (.date) (newIssuance :: stock_issuances)
        
        create this with 
          stock_transfers = newTransfers
          stock_issuances = newIssuances
```

### Example: Add Stakeholder

```daml
    choice AddStakeholder : ContractId IssuerState
      with
        stakeholder_data: OcfStakeholderData
      controller context.issuer
      do
        -- VALIDATION: ID must be unique
        assertMsg "Stakeholder ID already exists" 
          (not (stakeholderExists stakeholder_data.id stakeholders))
        
        createMarker context
        
        -- Append to array
        let newStakeholders = stakeholder_data :: stakeholders
        
        create this with stakeholders = newStakeholders
```

## Implementation Plan

### Phase 1: Create IssuerState Template

1. Create `IssuerState.daml` with all arrays and basic choices
2. Add helper functions for common queries (find by ID, etc.)
3. Implement `Add*` choices for objects (stakeholders, stock classes, etc.)
4. Implement core transaction choices (issuances, transfers, cancellations)
5. Write tests for all choices

### Phase 2: Migration Support

1. Create migration script to consolidate existing contracts into `IssuerState`
2. Keep existing templates available for backward compatibility
3. Add `OcpFactory` choice to create `IssuerState` directly
4. Update SDK to work with new contract structure

### Phase 3: Deprecate Old Templates (Optional)

1. Mark old individual templates as deprecated
2. Provide tooling to export `IssuerState` as OCF JSON
3. Add convenience choices for common operations (batch operations, etc.)

### Future: Add Indexes When Needed

When scale requires it, add optional computed indexes:

```daml
-- Optional: Add when needed for performance
data IssuerIndexes = IssuerIndexes
  with
    securities_by_stakeholder: Map Text [Text]  -- stakeholder_id -> [security_id]
    shares_by_class: Map Text Decimal           -- class_id -> total_shares
  deriving (Eq, Show)
```

## Consequences

### Positive

| Benefit | Description |
|---------|-------------|
| **Simplicity** | No derived state to maintain, just arrays of OCF objects |
| **OCF Compliance** | Objects stored in native OCF format |
| **Single Source of Truth** | All cap table data in one contract |
| **Reference Integrity** | Validate IDs exist before operations |
| **Atomicity** | All changes happen in single transaction |
| **Easy Export** | Arrays can be directly serialized to OCF JSON |
| **Debuggability** | Easy to inspect current state |

### Negative

| Concern | Mitigation |
|---------|------------|
| **Query Performance** | O(n) loops; fine for most companies (<1000 securities) |
| **Contract Size** | May hit limits for very large cap tables |
| **Breaking Change** | Migration required from current design |
| **Serialization** | All writes go through one contract |

### Scale Limits

For a typical startup cap table:
- ~50 stakeholders
- ~100-500 securities
- ~1000 total transactions

Array operations will be fast. If hitting limits:
1. Add computed indexes
2. Archive historical transactions to separate contract
3. Shard by security type

## Alternatives Considered

### Alternative 1: Keep Current Event-Sourcing Design

**Rejected because**: Requires off-chain infrastructure to compute current state, no reference integrity, scattered data across many contracts.

### Alternative 2: Computed Aggregates (Maps, Running Totals)

**Rejected because**: More complex, risk of aggregate state getting out of sync with source data, harder to debug.

### Alternative 3: Per-Security Position Contracts

**Rejected because**: Still scatters data across contracts, doesn't provide holistic view.

## References

- [OCF Schema](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF)
- [ADR-001: OCF Cap Table on Canton](https://github.com/fairmint/canton/blob/main/docs/developer/adr/001-ocf-captable-on-canton.md)
- [Canton Network Documentation](https://docs.canton.network/)
