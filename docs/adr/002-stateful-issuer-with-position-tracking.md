# ADR-002: Stateful Issuer with Position Tracking

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
- **No atomic operations**: Multi-step operations (like transfers) are separate transactions that could partially fail
- **No business rule enforcement**: Can't enforce rules like "issued shares must not exceed authorized shares" on-chain

## Decision

Redesign the OpenCapTable architecture to use a **Stateful Issuer** pattern where:

1. A single `IssuerState` contract per issuer maintains all current state
2. Transaction log contracts remain immutable for OCF compliance and audit trail
3. Choices on `IssuerState` validate references and enforce business rules atomically
4. State updates and transaction logging happen in a single atomic operation

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         IssuerState                              │
│  (1 contract per issuer - maintains all current state)          │
├─────────────────────────────────────────────────────────────────┤
│  context: Context                                                │
│  issuer_data: OcfIssuerData                                     │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ CURRENT STATE (Maps for O(1) lookup)                        ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ stock_classes: Map<Text, StockClassState>                   ││
│  │ stakeholders: Map<Text, StakeholderState>                   ││
│  │ active_securities: Map<Text, SecurityPosition>              ││
│  │ vesting_terms: Map<Text, VestingTermsState>                 ││
│  │ stock_plans: Map<Text, StockPlanState>                      ││
│  │ stock_legends: Map<Text, StockLegendState>                  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ COMPUTED AGGREGATES                                          ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ total_shares_issued: Decimal                                ││
│  │ shares_by_class: Map<Text, Decimal>                         ││
│  │ securities_by_stakeholder: Map<Text, [Text]>                ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ choices create
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Transaction Log Contracts                      │
│  (Immutable audit trail - one contract per transaction)         │
├─────────────────────────────────────────────────────────────────┤
│  StockIssuance | StockTransfer | StockCancellation | ...        │
│  (Same OCF-compliant structure as today)                        │
└─────────────────────────────────────────────────────────────────┘
```

### Key Data Types

```daml
-- Position represents current ownership of a security
data SecurityPosition = SecurityPosition
  with
    security_id: Text
    security_type: SecurityType
    stakeholder_id: Text
    stock_class_id: Optional Text
    quantity: Decimal
    issuance_date: Time
    vesting_status: Optional VestingStatus
  deriving (Eq, Show)

data SecurityType = 
    SecurityTypeStock 
  | SecurityTypeOption 
  | SecurityTypeConvertible 
  | SecurityTypeWarrant
  deriving (Eq, Show)

-- Lightweight stakeholder entry in state
data StakeholderState = StakeholderState
  with
    id: Text
    name: Text
    stakeholder_type: OcfStakeholderType
    security_ids: [Text]  -- Quick lookup of securities owned
  deriving (Eq, Show)

-- Stock class with live tracking
data StockClassState = StockClassState
  with
    id: Text
    name: Text
    class_type: OcfStockClassType
    authorized_shares: Decimal
    issued_shares: Decimal  -- Always current
  deriving (Eq, Show)
```

### Example: Stock Issuance with Validation

```daml
template IssuerState
  with
    context: Context
    issuer_data: OcfIssuerData
    stock_classes: Map Text StockClassState
    stakeholders: Map Text StakeholderState
    active_securities: Map Text SecurityPosition
  where
    signatory context.issuer, context.system_operator

    choice IssueStock : (ContractId IssuerState, ContractId StockIssuance)
      with
        issuance_data: OcfStockIssuanceData
      controller context.issuer
      do
        -- VALIDATION: Stakeholder must exist
        assertMsg "Stakeholder not found" 
          (Map.member issuance_data.stakeholder_id stakeholders)
        
        -- VALIDATION: Stock class must exist
        let stockClass = Map.lookup issuance_data.stock_class_id stock_classes
        assertMsg "Stock class not found" (isSome stockClass)
        let sc = fromSome stockClass
        
        -- VALIDATION: Security ID must be unique
        assertMsg "Security ID already exists" 
          (not $ Map.member issuance_data.security_id active_securities)
        
        -- VALIDATION: Sufficient authorized shares
        let newIssued = sc.issued_shares + issuance_data.quantity
        assertMsg "Exceeds authorized shares" (newIssued <= sc.authorized_shares)
        
        -- Create marker for featured app rewards
        createMarker context
        
        -- Create immutable transaction log (OCF-compliant)
        txCid <- create StockIssuance with context, issuance_data
        
        -- Update state atomically
        let newPosition = SecurityPosition with
              security_id = issuance_data.security_id
              security_type = SecurityTypeStock
              stakeholder_id = issuance_data.stakeholder_id
              stock_class_id = Some issuance_data.stock_class_id
              quantity = issuance_data.quantity
              issuance_date = issuance_data.date
              vesting_status = None
        
        let updatedStockClass = sc with issued_shares = newIssued
        
        let newState = this with
              active_securities = Map.insert issuance_data.security_id newPosition active_securities
              stock_classes = Map.insert issuance_data.stock_class_id updatedStockClass stock_classes
        
        newStateCid <- create newState
        pure (newStateCid, txCid)
```

### Example: Stock Transfer (Atomic)

```daml
    choice TransferStock : (ContractId IssuerState, ContractId StockTransfer)
      with
        transfer_data: OcfStockTransferData
      controller context.issuer
      do
        -- VALIDATION: Source security exists and is active
        let sourcePos = Map.lookup transfer_data.security_id active_securities
        assertMsg "Source security not found" (isSome sourcePos)
        let src = fromSome sourcePos
        
        -- VALIDATION: Sufficient quantity
        assertMsg "Insufficient shares" (transfer_data.quantity <= src.quantity)
        
        -- VALIDATION: Recipient stakeholder exists
        assertMsg "Recipient not found" 
          (Map.member transfer_data.resulting_security_stakeholder_id stakeholders)
        
        createMarker context
        
        -- Create transfer log
        txCid <- create StockTransfer with context, transfer_data
        
        -- Update positions atomically
        let remainingQty = src.quantity - transfer_data.quantity
        let newPos = src with
              security_id = transfer_data.resulting_security_id
              stakeholder_id = transfer_data.resulting_security_stakeholder_id
              quantity = transfer_data.quantity
        
        let newSecurities = 
              if remainingQty == 0.0
              then Map.insert transfer_data.resulting_security_id newPos $
                   Map.delete transfer_data.security_id active_securities
              else Map.insert transfer_data.resulting_security_id newPos $
                   Map.insert transfer_data.security_id (src with quantity = remainingQty) 
                   active_securities
        
        newStateCid <- create (this with active_securities = newSecurities)
        pure (newStateCid, txCid)
```

## Implementation Plan

### Phase 1: Non-Breaking Enhancement (Add Position Tracking)

Add `SecurityPosition` contracts alongside existing templates without changing the current API:

1. Create `SecurityPosition` template that tracks current ownership
2. Update `Issuer` choices to also create/update `SecurityPosition` contracts
3. Add `ArchiveOnTransfer` choice to `SecurityPosition`
4. Existing clients continue to work unchanged

### Phase 2: Consolidated IssuerState

Replace the factory pattern with stateful issuer:

1. Create `IssuerState` template with embedded maps
2. Migrate `CreateX` choices from `Issuer` to `IssuerState`
3. Add validation logic to all state-changing choices
4. Transaction templates become pure immutable logs
5. Provide migration script for existing deployments

### Phase 3: Computed Views and Helpers

Add convenience features:

1. `GetStakeholderPortfolio` - all securities for a stakeholder
2. `GetStockClassSummary` - shares outstanding per class
3. `GetSecurityHistory` - all transactions for a security
4. Helper scripts for common queries

## Consequences

### Positive

| Benefit | Description |
|---------|-------------|
| **Reference Integrity** | On-chain validation that stakeholders, stock classes exist before operations |
| **Current State** | Always know current ownership without event replay |
| **Atomic Operations** | Transfers, exercises, cancellations happen in single transaction |
| **Business Rules** | Enforce "can't exceed authorized shares" and similar rules on-chain |
| **Simpler Queries** | Query current positions directly, no off-chain processing |
| **OCF Compliance** | Transaction logs remain fully OCF-compliant |

### Negative

| Concern | Mitigation |
|---------|------------|
| **Contract Size** | May grow large; consider sharding for 1000+ securities |
| **Serialization** | All writes through one contract; batching helps |
| **Breaking Change** | Phase 1 is non-breaking; Phase 2 requires migration |
| **Complexity** | More complex template logic, but clearer semantics |

### Scale Considerations

For very large cap tables (10,000+ securities):

- **Shard by stakeholder**: Separate `StakeholderPositions` contract per stakeholder
- **Shard by type**: Separate state for options vs. stock vs. convertibles
- **Archive historical**: Move terminated positions to archive contracts
- **Pagination**: Limit map sizes, use overflow contracts

## Alternatives Considered

### Alternative 1: Keep Current Event-Sourcing Design

**Rejected because**: Requires off-chain infrastructure to compute current state, no reference integrity, can't enforce business rules on-chain.

### Alternative 2: Contract Keys (When Available)

**Deferred**: Canton Network doesn't currently support contract keys. When available, could simplify lookups but wouldn't provide the validation benefits of stateful issuer.

### Alternative 3: Index Contract Pattern

Maintain a separate `IssuerIndex` contract with Maps for lookups while keeping objects as separate contracts.

**Rejected because**: Two-phase updates (update object + update index) create consistency risks. Stateful pattern is cleaner.

### Alternative 4: Per-Security Position Contracts Only

Create individual `SecurityPosition` contracts without consolidated state.

**Partially adopted**: Phase 1 uses this approach as a non-breaking step toward full stateful design.

## References

- [OCF Schema](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF)
- [ADR-001: OCF Cap Table on Canton](https://github.com/fairmint/canton/blob/main/docs/developer/adr/001-ocf-captable-on-canton.md)
- [Canton Network Documentation](https://docs.canton.network/)
- [DAML Maps Documentation](https://docs.daml.com/daml/stdlib/DA-Map.html)
