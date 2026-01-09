# OCP Contract Architecture Diagram

> **Maintenance Note**: Update this diagram when changes are made to the contract design or relationships. See [Maintenance](#maintenance) below.

## Contract Hierarchy

```mermaid
flowchart TB
    subgraph Factory["Factory Layer"]
        OcpFactory["OcpFactory<br/><i>signatory: system_operator</i>"]
    end

    subgraph Auth["Authorization Layer"]
        IssuerAuth["IssuerAuthorization<br/><i>signatory: system_operator</i><br/><i>observer: issuer</i>"]
    end

    subgraph State["State Management Layer"]
        CapTable["CapTable<br/><i>signatory: issuer, system_operator</i><br/><br/>Maps: id → ContractId"]
    end

    subgraph OCF["OCF Object Layer"]
        Issuer["Issuer<br/><i>(exactly 1, edit only)</i>"]
        
        subgraph Objects["Objects"]
            Stakeholder
            StockClass
            StockPlan
            StockLegendTemplate
            VestingTerms
            Valuation
            Document
        end
        
        subgraph Transactions["Transactions"]
            subgraph Stock["Stock"]
                StockIssuance
                StockTransfer
                StockCancellation
                StockAcceptance
                StockRetraction
                StockRepurchase
                StockConversion
                StockReissuance
                StockConsolidation
            end
            
            subgraph EquityComp["Equity Compensation"]
                EquityCompensationIssuance
                EquityCompensationExercise
                EquityCompensationTransfer
                EquityCompensationCancellation
                EquityCompensationAcceptance
                EquityCompensationRetraction
                EquityCompensationRelease
                EquityCompensationRepricing
            end
            
            subgraph Convertibles["Convertibles"]
                ConvertibleIssuance
                ConvertibleTransfer
                ConvertibleCancellation
                ConvertibleConversion
                ConvertibleAcceptance
                ConvertibleRetraction
            end
            
            subgraph Warrants["Warrants"]
                WarrantIssuance
                WarrantExercise
                WarrantTransfer
                WarrantCancellation
                WarrantAcceptance
                WarrantRetraction
            end
            
            subgraph Adjustments["Adjustments & Events"]
                IssuerAuthorizedSharesAdjustment
                StockClassAuthorizedSharesAdjustment
                StockClassConversionRatioAdjustment
                StockClassSplit
                StockPlanPoolAdjustment
                StockPlanReturnToPool
                VestingEvent
                VestingStart
                VestingAcceleration
                StakeholderStatusChangeEvent
                StakeholderRelationshipChangeEvent
            end
        end
    end

    OcpFactory -->|"AuthorizeIssuer"| IssuerAuth
    IssuerAuth -->|"CreateCapTable"| CapTable
    IssuerAuth -->|"creates"| Issuer
    CapTable -->|"holds reference to"| Issuer
    CapTable -->|"Create/Edit/Delete"| Objects
    CapTable -->|"Create/Edit/Delete"| Transactions
```

## Contract Flow Diagram

```mermaid
sequenceDiagram
    participant SO as System Operator
    participant F as OcpFactory
    participant IA as IssuerAuthorization
    participant I as Issuer (Party)
    participant CT as CapTable
    participant OCF as OCF Contracts

    Note over SO,F: 1. Factory Setup (once)
    SO->>F: Deploy OcpFactory

    Note over SO,IA: 2. Authorize Issuer
    SO->>F: AuthorizeIssuer(issuer)
    F->>IA: Create IssuerAuthorization

    Note over I,OCF: 3. Create Cap Table
    I->>IA: CreateCapTable(issuer_data)
    IA->>OCF: Create Issuer contract
    IA->>CT: Create CapTable (empty maps)

    Note over I,OCF: 4. Manage Cap Table
    I->>CT: CreateStakeholder(data)
    CT->>CT: Validate ID unique
    CT->>OCF: Create Stakeholder contract
    CT->>CT: Update stakeholders map

    I->>CT: CreateStockIssuance(data)
    CT->>CT: Validate stakeholder_id exists
    CT->>CT: Validate stock_class_id exists
    CT->>OCF: Create StockIssuance contract
    CT->>CT: Update stock_issuances map
```

## Reference Validation

```mermaid
flowchart LR
    subgraph Create["CreateStockIssuance"]
        direction TB
        Input["data.stakeholder_id<br/>data.stock_class_id"]
        V1{{"stakeholder_id ∈ stakeholders?"}}
        V2{{"stock_class_id ∈ stock_classes?"}}
        Create_["Create StockIssuance"]
        Update["Update stock_issuances map"]
        
        Input --> V1
        V1 -->|Yes| V2
        V1 -->|No| Error1["❌ Stakeholder not found"]
        V2 -->|Yes| Create_
        V2 -->|No| Error2["❌ Stock class not found"]
        Create_ --> Update
    end
```

## Context & Signatories

```mermaid
classDiagram
    class Context {
        +Party issuer
        +Party system_operator
        +ContractId FeaturedAppRight featured_app_right
    }
    
    class OCFContract {
        +Context context
        +*OcfData data
        <<signatory>> issuer
        <<signatory>> system_operator
    }
    
    class CapTable {
        +Context context
        +ContractId Issuer issuer
        +Map~Text, ContractId~ stakeholders
        +Map~Text, ContractId~ stock_classes
        +Map~Text, ContractId~ stock_issuances
        +... (47 maps total)
        <<signatory>> issuer
        <<signatory>> system_operator
    }
    
    Context --> OCFContract : used by
    Context --> CapTable : used by
    CapTable --> OCFContract : manages
```

## Key Design Patterns

| Pattern | Description |
|---------|-------------|
| **Dual Signatories** | All contracts require both `issuer` and `system_operator` signatures |
| **Factory Pattern** | OcpFactory → IssuerAuthorization → CapTable chain |
| **State Management** | CapTable maintains `Map Text (ContractId T)` for O(1) lookup |
| **Reference Validation** | CapTable validates references exist before creating transactions |
| **Archive + Recreate** | Edit = archive old contract + create new + update map |
| **Issuer is Immutable** | Issuer contract can only be edited, never deleted |

## File Structure

```
OpenCapTable-v25/daml/Fairmint/OpenCapTable/
├── OcpFactory.daml          # Factory contract
├── IssuerAuthorization.daml # Authorization contract
├── CapTable.daml           # State management (GENERATED)
├── Types.daml              # Shared types & enums
├── Helpers.daml            # Helper functions
└── OCF/                    # OCF object contracts
    ├── Issuer.daml
    ├── Stakeholder.daml
    ├── StockClass.daml
    ├── StockIssuance.daml
    ├── ... (47 OCF contracts)
```

## Maintenance

**Update this diagram when:**
- Adding new OCF object types or transactions
- Changing the contract hierarchy or relationships
- Modifying validation patterns
- Updating signatories or observers

**Diagram locations:**
1. This file: `docs/OCP_CONTRACT_DIAGRAM.md` (full documentation)
2. ADR-002: `docs/adr/002-stateful-issuer-with-position-tracking.md` (architecture decision context)

**Related files to update together:**
- `OpenCapTable-v25/README.md` - Package-specific documentation
- `scripts/codegen/captable-config.yaml` - Reference validation config
- `llms.txt` - AI context file

## References

- [ADR-002: Stateful Cap Table](./adr/002-stateful-issuer-with-position-tracking.md)
- [OCF Schema](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF)
- [Canton Network Documentation](https://docs.canton.network/)
