# ADR-002: Stateful Issuer with OCF Object References

## Status

**Proposed** | 2026-01-02

## Context

The current OpenCapTable implementation on Canton uses an event-sourcing pattern where:

1. The `Issuer` contract acts as a factory with ~40+ nonconsuming choices to create OCF object contracts
2. Each transaction (issuance, transfer, cancellation) creates an independent contract
3. There's no on-chain tracking of current state—determining "what does Alice own?" requires off-chain event replay
4. Reference integrity is not enforced—IDs like `stakeholder_id` and `stock_class_id` are just strings with no validation that the referenced objects exist
5. Contract keys are not available on Canton Network, making lookups by business ID difficult
6. Each OCF object has its own `ArchiveByIssuer` choice, but there's no central control over the cap table state

This creates several problems:

- **No current state visibility**: To know current ownership, you must query all events and replay them off-chain
- **No reference integrity**: Can issue stock to a non-existent stakeholder or reference invalid stock classes
- **Scattered data**: Cap table data spread across many contracts, hard to query holistically
- **No central lifecycle control**: Objects can be archived independently, potentially leaving orphaned references
- **No edit/delete support**: OCF objects are immutable but errors need to be correctable

## Decision

Redesign the OpenCapTable architecture to use a **Stateful Issuer** pattern where:

1. A single `IssuerState` contract per issuer maintains **arrays of ContractIds** pointing to all OCF objects
2. OCF objects remain as separate contracts (existing templates)
3. `IssuerState` is the **sole authority** for creating, editing, and deleting OCF objects
4. Remove `ArchiveByIssuer` from individual templates—all archiving goes through `IssuerState`
5. Editing an object = archive old contract + create new contract + update ContractId in array
6. Deleting an object = archive contract + remove ContractId from array

### Design Principles

1. **Central lifecycle control**: All OCF object lifecycle managed through `IssuerState`
2. **Reference tracking**: `IssuerState` maintains the source of truth for what exists
3. **Support corrections**: Edit and delete operations for fixing errors
4. **Atomic operations**: Multi-step operations happen in single transactions
5. **OCF compliance**: Individual OCF objects remain in standard format

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         IssuerState                              │
│  (1 contract per issuer - maintains all ContractId references)  │
├─────────────────────────────────────────────────────────────────┤
│  context: Context                                                │
│  issuer_data: OcfIssuerData                                     │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ OBJECT REFERENCES (arrays of ContractIds)                   ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ stakeholders: [ContractId Stakeholder]                      ││
│  │ stock_classes: [ContractId StockClass]                      ││
│  │ stock_plans: [ContractId StockPlan]                         ││
│  │ stock_legend_templates: [ContractId StockLegendTemplate]    ││
│  │ vesting_terms: [ContractId VestingTerms]                    ││
│  │ documents: [ContractId Document]                            ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ TRANSACTION REFERENCES (arrays of ContractIds)              ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ stock_issuances: [ContractId StockIssuance]                 ││
│  │ stock_transfers: [ContractId StockTransfer]                 ││
│  │ stock_cancellations: [ContractId StockCancellation]         ││
│  │ ... (all other transaction types)                           ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  CHOICES: Add*, Edit*, Delete* for each object type             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ creates/archives
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              OCF Object Contracts (existing templates)           │
├─────────────────────────────────────────────────────────────────┤
│  Stakeholder | StockClass | StockIssuance | StockTransfer | ... │
│  (No ArchiveByIssuer - lifecycle controlled by IssuerState)     │
└─────────────────────────────────────────────────────────────────┘
```

### Core Template Structure

```daml
template IssuerState
  with
    context: Context
    issuer_data: OcfIssuerData
    
    -- Object references (ContractIds)
    stakeholders: [ContractId Stakeholder]
    stock_classes: [ContractId StockClass]
    stock_plans: [ContractId StockPlan]
    stock_legend_templates: [ContractId StockLegendTemplate]
    vesting_terms: [ContractId VestingTerms]
    documents: [ContractId Document]
    
    -- Stock transaction references
    stock_issuances: [ContractId StockIssuance]
    stock_transfers: [ContractId StockTransfer]
    stock_cancellations: [ContractId StockCancellation]
    stock_repurchases: [ContractId StockRepurchase]
    stock_reissuances: [ContractId StockReissuance]
    stock_conversions: [ContractId StockConversion]
    stock_acceptances: [ContractId StockAcceptance]
    stock_retractions: [ContractId StockRetraction]
    stock_consolidations: [ContractId StockConsolidation]
    
    -- Equity compensation transaction references
    equity_comp_issuances: [ContractId EquityCompensationIssuance]
    equity_comp_exercises: [ContractId EquityCompensationExercise]
    equity_comp_cancellations: [ContractId EquityCompensationCancellation]
    equity_comp_transfers: [ContractId EquityCompensationTransfer]
    equity_comp_acceptances: [ContractId EquityCompensationAcceptance]
    equity_comp_retractions: [ContractId EquityCompensationRetraction]
    equity_comp_releases: [ContractId EquityCompensationRelease]
    equity_comp_repricings: [ContractId EquityCompensationRepricing]
    
    -- Convertible transaction references
    convertible_issuances: [ContractId ConvertibleIssuance]
    convertible_transfers: [ContractId ConvertibleTransfer]
    convertible_conversions: [ContractId ConvertibleConversion]
    convertible_cancellations: [ContractId ConvertibleCancellation]
    convertible_acceptances: [ContractId ConvertibleAcceptance]
    convertible_retractions: [ContractId ConvertibleRetraction]
    
    -- Warrant transaction references
    warrant_issuances: [ContractId WarrantIssuance]
    warrant_transfers: [ContractId WarrantTransfer]
    warrant_exercises: [ContractId WarrantExercise]
    warrant_cancellations: [ContractId WarrantCancellation]
    warrant_acceptances: [ContractId WarrantAcceptance]
    warrant_retractions: [ContractId WarrantRetraction]
    
    -- Vesting transaction references
    vesting_starts: [ContractId VestingStart]
    vesting_events: [ContractId VestingEvent]
    vesting_accelerations: [ContractId VestingAcceleration]
    
    -- Adjustment transaction references
    issuer_authorized_shares_adjustments: [ContractId IssuerAuthorizedSharesAdjustment]
    stock_class_authorized_shares_adjustments: [ContractId StockClassAuthorizedSharesAdjustment]
    stock_class_conversion_ratio_adjustments: [ContractId StockClassConversionRatioAdjustment]
    stock_class_splits: [ContractId StockClassSplit]
    stock_plan_pool_adjustments: [ContractId StockPlanPoolAdjustment]
    stock_plan_returns_to_pool: [ContractId StockPlanReturnToPool]
    
    -- Stakeholder event references
    stakeholder_relationship_changes: [ContractId StakeholderRelationshipChangeEvent]
    stakeholder_status_changes: [ContractId StakeholderStatusChangeEvent]
    
  where
    signatory context.issuer, context.system_operator
```

### Lifecycle Operations

#### Add (Create new OCF object)

```daml
    -- Add a new stakeholder
    choice AddStakeholder : ContractId IssuerState
      with
        stakeholder_data: OcfStakeholderData
      controller context.issuer
      do
        -- VALIDATION: ID must be unique (fetch all and check)
        existingData <- mapA (\cid -> do
          c <- fetch cid
          pure c.stakeholder_data.id
        ) stakeholders
        assertMsg "Stakeholder ID already exists" 
          (stakeholder_data.id `notElem` existingData)
        
        createMarker context
        
        -- Create the OCF object contract
        newCid <- create Stakeholder with
          context = context
          stakeholder_data = stakeholder_data
        
        -- Add ContractId to array
        create this with stakeholders = newCid :: stakeholders
```

#### Edit (Correct an existing OCF object)

```daml
    -- Edit an existing stakeholder (archive old, create new)
    choice EditStakeholder : ContractId IssuerState
      with
        old_cid: ContractId Stakeholder
        new_data: OcfStakeholderData
      controller context.issuer
      do
        -- VALIDATION: Contract must be in our list
        assertMsg "Stakeholder not found in issuer state" 
          (old_cid `elem` stakeholders)
        
        -- Fetch old to verify and get context
        old <- fetch old_cid
        
        -- VALIDATION: ID should match (can't change ID via edit)
        assertMsg "Cannot change stakeholder ID via edit" 
          (old.stakeholder_data.id == new_data.id)
        
        createMarker context
        
        -- Archive old contract
        archive old_cid
        
        -- Create new contract with updated data
        newCid <- create Stakeholder with
          context = context
          stakeholder_data = new_data
        
        -- Replace ContractId in array
        let updatedList = newCid :: filter (/= old_cid) stakeholders
        create this with stakeholders = updatedList
```

#### Delete (Remove an OCF object)

```daml
    -- Delete a stakeholder
    choice DeleteStakeholder : ContractId IssuerState
      with
        cid: ContractId Stakeholder
      controller context.issuer
      do
        -- VALIDATION: Contract must be in our list
        assertMsg "Stakeholder not found in issuer state" 
          (cid `elem` stakeholders)
        
        -- Optional: Check for dependent objects (securities held by this stakeholder)
        -- This could be enforced or just warned depending on requirements
        
        createMarker context
        
        -- Archive the contract
        archive cid
        
        -- Remove ContractId from array
        create this with stakeholders = filter (/= cid) stakeholders
```

### Example: Stock Issuance with Validation

```daml
    choice AddStockIssuance : ContractId IssuerState
      with
        issuance_data: OcfStockIssuanceData
      controller context.issuer
      do
        -- VALIDATION: Stakeholder must exist
        stakeholderIds <- mapA (\cid -> do
          c <- fetch cid
          pure c.stakeholder_data.id
        ) stakeholders
        assertMsg "Stakeholder not found" 
          (issuance_data.stakeholder_id `elem` stakeholderIds)
        
        -- VALIDATION: Stock class must exist
        stockClassIds <- mapA (\cid -> do
          c <- fetch cid
          pure c.stock_class_data.id
        ) stock_classes
        assertMsg "Stock class not found" 
          (issuance_data.stock_class_id `elem` stockClassIds)
        
        -- VALIDATION: Security ID must be unique across all issuances
        existingSecurityIds <- mapA (\cid -> do
          c <- fetch cid
          pure c.issuance_data.security_id
        ) stock_issuances
        assertMsg "Security ID already exists" 
          (issuance_data.security_id `notElem` existingSecurityIds)
        
        createMarker context
        
        -- Create the issuance contract
        newCid <- create StockIssuance with
          context = context
          issuance_data = issuance_data
        
        create this with stock_issuances = newCid :: stock_issuances
```

### Changes to Existing Templates

#### Remove ArchiveByIssuer

All existing OCF object templates should have `ArchiveByIssuer` removed. The `IssuerState` contract will archive objects directly since it's a signatory.

**Before:**
```daml
template Stakeholder
  with
    context: Context
    stakeholder_data: OcfStakeholderData
  where
    signatory context.issuer, context.system_operator
    
    -- Remove this choice
    choice ArchiveByIssuer : ()
      controller context.issuer
      do pure ()
```

**After:**
```daml
template Stakeholder
  with
    context: Context
    stakeholder_data: OcfStakeholderData
  where
    signatory context.issuer, context.system_operator
    -- No ArchiveByIssuer - lifecycle controlled by IssuerState
```

#### Archive via IssuerState

Since `IssuerState` has the same signatories (`context.issuer`, `context.system_operator`), it can directly `archive` any OCF object contract without needing a special choice.

### Helper Functions

```daml
-- Check if a stakeholder ID exists
stakeholderIdExists : Text -> [ContractId Stakeholder] -> Update Bool
stakeholderIdExists targetId cids = do
  ids <- mapA (\cid -> do
    c <- fetch cid
    pure c.stakeholder_data.id
  ) cids
  pure (targetId `elem` ids)

-- Get stakeholder data by ID
getStakeholderById : Text -> [ContractId Stakeholder] -> Update (Optional (ContractId Stakeholder, OcfStakeholderData))
getStakeholderById targetId cids = do
  results <- mapA (\cid -> do
    c <- fetch cid
    pure (cid, c.stakeholder_data)
  ) cids
  pure $ find (\(_, d) -> d.id == targetId) results

-- Calculate shares issued for a stock class
getSharesIssuedForClass : Text -> [ContractId StockIssuance] -> [ContractId StockCancellation] -> Update Decimal
getSharesIssuedForClass classId issuanceCids cancellationCids = do
  -- Get all issuances for this class
  issuances <- mapA fetch issuanceCids
  let classIssuances = filter (\i -> i.issuance_data.stock_class_id == classId) issuances
  let totalIssued = sum (map (\i -> i.issuance_data.quantity) classIssuances)
  
  -- Get cancellations for securities in this class
  cancellations <- mapA fetch cancellationCids
  let cancelledQuantity = sum $ map (\c -> 
        let secId = c.cancellation_data.security_id
            maybeIssuance = find (\i -> i.issuance_data.security_id == secId) classIssuances
        in case maybeIssuance of
             Some i -> c.cancellation_data.quantity
             None -> 0.0
      ) cancellations
  
  pure (totalIssued - cancelledQuantity)
```

## Implementation Plan

### Phase 1: Create IssuerState Template

1. Create `IssuerState.daml` with all ContractId arrays
2. Implement `Add*` choices for all object types with validation
3. Implement `Edit*` choices for correcting errors
4. Implement `Delete*` choices for removing objects
5. Write comprehensive tests

### Phase 2: Update Existing Templates

1. Remove `ArchiveByIssuer` from all OCF object templates
2. Update `OcpFactory` to create `IssuerState` instead of `Issuer`
3. Keep old `Issuer` template for backward compatibility (deprecated)
4. Update SDK to use new `IssuerState` contract

### Phase 3: Migration Support

1. Create migration script to consolidate existing contracts into `IssuerState`
2. Script collects all existing OCF contracts for an issuer
3. Creates new `IssuerState` with ContractIds
4. Archives old `Issuer` contract

### Future Enhancements

When scale requires optimization:
- Add ID-based indexes: `Map Text (ContractId Stakeholder)`
- Cache computed values (shares issued per class)
- Implement batch operations

## Consequences

### Positive

| Benefit | Description |
|---------|-------------|
| **Central Lifecycle Control** | All create/edit/delete through `IssuerState` |
| **Reference Integrity** | Validate IDs exist before operations |
| **Error Correction** | Edit and delete support for fixing mistakes |
| **Atomic Operations** | Multi-step operations in single transaction |
| **OCF Compliance** | Objects remain in standard OCF format |
| **Queryable State** | ContractId arrays show what exists |
| **Existing Templates** | Reuse existing OCF object templates |

### Negative

| Concern | Mitigation |
|---------|------------|
| **Validation Cost** | Fetching contracts to validate; cache if needed |
| **Array Operations** | O(n) lookups; add indexes when scale requires |
| **Breaking Change** | Remove ArchiveByIssuer; provide migration |
| **Single Point of Control** | Intentional - central authority for cap table |

### Scale Considerations

For typical startup cap tables (~50 stakeholders, ~500 securities):
- Array operations are fast
- Validation fetches are acceptable

If hitting limits:
1. Add `Map Text (ContractId X)` indexes for O(1) lookup
2. Batch validation (fetch once, check many)
3. Shard by object type into separate state contracts

## Alternatives Considered

### Alternative 1: Keep Current Design

**Rejected because**: No central state tracking, no reference integrity, no edit/delete support, scattered lifecycle control.

### Alternative 2: Embed OCF Data in Arrays (Previous Version)

**Rejected because**: Duplicates data (both in array and in contracts), harder to query individual objects, larger contract size.

### Alternative 3: Maps Instead of Arrays

**Deferred**: Maps provide O(1) lookup but add complexity. Arrays are simpler to implement and sufficient for most cap tables. Can add Map indexes later.

## References

- [OCF Schema](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF)
- [ADR-001: OCF Cap Table on Canton](https://github.com/fairmint/canton/blob/main/docs/developer/adr/001-ocf-captable-on-canton.md)
- [Canton Network Documentation](https://docs.canton.network/)
