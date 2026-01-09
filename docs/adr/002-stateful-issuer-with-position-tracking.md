# ADR-002: Stateful Cap Table with OCF Object References

## Status

**Implemented** | 2026-01-05

---

## TL;DR

Introduce a new **CapTable** contract that:
- Maintains `Map Text ContractId` for all OCF objects (O(1) lookup by business ID)
- Acts as the sole authority for create/edit/delete operations
- Validates references on **create** (can't issue stock to non-existent stakeholder)

---

## Context

### Current Design Problems

The existing implementation uses an event-sourcing pattern where the `Issuer` contract acts as a factory with ~40+ nonconsuming choices. This creates several problems:

| Problem | Impact |
|---------|--------|
| **No current state visibility** | Must replay all events off-chain to determine ownership |
| **No reference validation** | Can issue stock to non-existent stakeholders or invalid stock classes |
| **Scattered data** | Cap table spread across many independent contracts |

---

## Decision

Introduce a new **CapTable** contract (separate from the OCF `Issuer` object):

1. Single `CapTable` contract per cap table maintains **Maps of id → ContractId** for all OCF objects
2. The `Issuer` remains a simple OCF object (just data, no factory methods)
3. All create/edit/delete operations go through `CapTable`
4. `CapTable` validates references exist before allowing transactions (O(1) map lookup)
5. Edit = archive old + create new + update ContractId in map
6. Delete = archive contract + remove from map

---

## Architecture

### Factory Creates CapTable

The `OcpFactory` creates a `CapTable` contract given Issuer data. The Issuer is required to initialize a cap table and cannot be added or removed—only edited.

```haskell
choice CreateCapTable(issuer_data):
    -- Create the Issuer OCF contract
    issuer_cid <- create Issuer(context, issuer_data)

    -- Create CapTable with Issuer reference and empty maps
    create CapTable with {
        issuer = issuer_cid,
        issuer_id = issuer_data.id,
        -- All other maps start empty
        stakeholders = Map.empty,
        stock_classes = Map.empty,
        ...
    }
```

### CapTable Structure

The CapTable maintains maps organized by OCF schema categories:

```mermaid
graph LR
    subgraph CapTable["CapTable Contract"]
        direction TB
        subgraph " "
            direction LR
            Issuer["Issuer<br/><i>exactly 1, edit only</i>"]
            Objects["Objects<br/><i>stakeholders, stock_classes,<br/>stock_plans, vesting_terms, ...</i>"]
            Transactions["Transactions<br/><i>issuances, transfers,<br/>cancellations, exercises, ...</i>"]
        end
    end

    CapTable -->|"Add/Edit/Delete"| OCF

    subgraph OCF["OCF Contracts"]
        direction LR
        C1[Issuer]
        C2[Stakeholder]
        C3[StockClass]
        C4[StockIssuance]
        C5[...]
    end
```

| Category | Maps | Notes |
|----------|------|-------|
| **Issuer** | `issuer: ContractId Issuer` | Exactly 1. No Add/Delete, only Edit. |
| **Objects** | `stakeholders`, `stock_classes`, `stock_plans`, `stock_legend_templates`, `vesting_terms`, `valuations`, `financings`, `documents` | Add/Edit/Delete |
| **Transactions** | `stock_issuances`, `stock_transfers`, `stock_cancellations`, `equity_compensation_issuances`, `convertible_issuances`, `warrant_issuances`, ... | Add/Edit/Delete |

### Key Points

- **CapTable is a new custom contract** — not an OCF object
- **Issuer is exactly 1** — created with CapTable, can only be edited
- **All OCF contracts remain unchanged** — just remove `ArchiveByIssuer` choice
- **Same signatories** — CapTable can directly archive OCF contracts
- **Maps for O(1) lookup** — instant validation by business ID

---

## Lifecycle Operations

### Issuer (Edit Only)

The Issuer is created with the CapTable and cannot be added or deleted—only edited:

```haskell
choice EditIssuer(new_data):
    assert issuer_id == new_data.id  -- Can't change ID

    -- Replace contract
    archive issuer
    new_cid <- create Issuer(context, new_data)

    -- Update state
    create this with { issuer = new_cid }
```

### Objects: Create / Edit / Delete

**Create:**
```haskell
choice CreateStakeholder(data):
    -- Validate ID uniqueness (O(1) map lookup)
    assert data.id not in stakeholders

    -- Create OCF contract
    new_cid <- create Stakeholder(context, data)

    -- Update state
    create this with { stakeholders = Map.insert data.id new_cid stakeholders }
```

**Edit:**
```haskell
choice EditStakeholder(id, new_data):
    -- Lookup by ID (O(1))
    old_cid <- lookup id stakeholders
    assert (isSome old_cid) "Stakeholder not found"
    assert id == new_data.id  -- Can't change ID via edit

    -- Replace contract
    archive (fromSome old_cid)
    new_cid <- create Stakeholder(context, new_data)

    -- Update state
    create this with { stakeholders = Map.insert id new_cid stakeholders }
```

**Delete:**
```haskell
choice DeleteStakeholder(id):
    -- Lookup by ID (O(1))
    cid <- lookup id stakeholders
    assert (isSome cid) "Stakeholder not found"

    -- Archive and remove from map
    archive (fromSome cid)
    create this with { stakeholders = Map.delete id stakeholders }
```

> ⚠️ **Note**: Delete does not validate reverse references. Deleting an object that is referenced by transactions will leave dangling references. Operational policy should ensure dependents are cleaned up first.

---

### Transactions: Create with Reference Validation

Transactions reference objects (stakeholders, stock classes, etc.). We validate these references exist before creating:

```haskell
choice CreateStockIssuance(data):
    -- Validate stakeholder exists (O(1) map lookup)
    assert (isSome $ Map.lookup data.stakeholder_id stakeholders)
        "Stakeholder not found"

    -- Validate stock class exists (O(1))
    assert (isSome $ Map.lookup data.stock_class_id stock_classes)
        "Stock class not found"

    -- Validate security ID unique (O(1))
    assert (isNone $ Map.lookup data.security_id stock_issuances)
        "Security ID already exists"

    -- Create OCF contract
    new_cid <- create StockIssuance(context, data)

    -- Update state
    create this with {
        stock_issuances = Map.insert data.security_id new_cid stock_issuances
    }
```

Edit and Delete follow the same pattern as Objects above.

---

## Template Changes

### Issuer: Remove Factory Methods

**Before:**
```haskell
template Issuer:
    signatory: issuer, system_operator

    -- ~40+ factory choices
    choice CreateStakeholder(data): ...
    choice CreateStockIssuance(data): ...
```

**After:**
```haskell
template Issuer:
    signatory: issuer, system_operator
```

### OCF Objects: Remove ArchiveByIssuer

**Before:**
```haskell
template Stakeholder:
    signatory: issuer, system_operator

    choice ArchiveByIssuer:
        controller: issuer
        return ()
```

**After:**
```haskell
template Stakeholder:
    signatory: issuer, system_operator
```

Since `CapTable` shares the same signatories, it can directly `archive` any OCF contract.

---

## Consequences

- **Reference validation on create** — O(1) validation that referenced objects exist
- **Clean separation** — CapTable is custom logic; OCF objects stay standard
- **Queryable state** — Maps show what exists by ID
- **Atomic operations** — Multi-step operations in single transaction
- **OCF compliance** — Issuer and all objects remain in standard OCF format

---

## Future Considerations

**Delete validation via reverse-reference indexes**: To prevent deleting objects that are still referenced, we could maintain `Map Text (Set Text)` indexes that track what references each object. This would enable O(1) delete validation but adds complexity—every add/edit/delete must maintain the reverse indexes, creating risk of inconsistency. Not planned for initial implementation.

---

## Related Documentation

- **[OCP Contract Diagram](../OCP_CONTRACT_DIAGRAM.md)** - Visual Mermaid diagrams of the contract architecture

> **Maintenance**: When updating this ADR or the contract design, also update the diagram at `docs/OCP_CONTRACT_DIAGRAM.md`.

---

## References

- [OCF Schema](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF)
- [ADR-001: OCF Cap Table on Canton](https://github.com/fairmint/canton/blob/main/docs/developer/adr/001-ocf-captable-on-canton.md)
- [Canton Network Documentation](https://docs.canton.network/)
