# ADR-002: Stateful Issuer with OCF Object References

## Status

**Proposed** | 2026-01-02

---

## TL;DR

Replace the current event-sourcing pattern with a **Stateful Issuer** that:
- Maintains arrays of ContractIds pointing to all OCF objects
- Acts as the sole authority for create/edit/delete operations
- Enables reference integrity validation at transaction time

---

## Context

### Current Design Problems

The existing implementation uses an event-sourcing pattern where the `Issuer` contract acts as a factory with ~40+ nonconsuming choices. This creates several problems:

| Problem | Impact |
|---------|--------|
| **No current state visibility** | Must replay all events off-chain to determine ownership |
| **No reference integrity** | Can issue stock to non-existent stakeholders |
| **Scattered data** | Cap table spread across many contracts |
| **No central lifecycle control** | Objects archived independently → orphaned references |
| **No edit/delete support** | OCF objects are immutable, but errors need correction |

---

## Decision

Implement a **Stateful Issuer** pattern:

1. Single `IssuerState` contract per issuer maintains **arrays of ContractIds**
2. OCF objects remain as separate contracts (existing templates)
3. `IssuerState` is the **sole authority** for creating, editing, and deleting
4. Remove `ArchiveByIssuer` from individual templates
5. Edit = archive old + create new + update ContractId in array
6. Delete = archive contract + remove ContractId from array

---

## Architecture

```mermaid
graph TB
    subgraph IssuerState["IssuerState Contract"]
        direction TB
        Meta["context, issuer_data"]

        subgraph Objects["Object References"]
            O1["stakeholders: ContractId[]"]
            O2["stock_classes: ContractId[]"]
            O3["stock_plans: ContractId[]"]
            O4["vesting_terms: ContractId[]"]
            O5["..."]
        end

        subgraph Transactions["Transaction References"]
            T1["stock_issuances: ContractId[]"]
            T2["stock_transfers: ContractId[]"]
            T3["stock_cancellations: ContractId[]"]
            T4["equity_comp_*: ContractId[]"]
            T5["..."]
        end

        Choices["Choices: Add*, Edit*, Delete*"]
    end

    IssuerState -->|creates/archives| OCF["OCF Object Contracts"]

    subgraph OCF["OCF Contracts"]
        C1[Stakeholder]
        C2[StockClass]
        C3[StockIssuance]
        C4[...]
    end
```

### Key Points

- **One IssuerState per issuer** — single source of truth
- **OCF contracts unchanged** — just remove `ArchiveByIssuer` choice
- **Same signatories** — IssuerState can directly archive OCF contracts

---

## Lifecycle Operations

### Add (Create)

```
choice AddStakeholder(data):
    // Validate ID uniqueness
    existing_ids = fetch_all(stakeholders).map(s => s.id)
    assert data.id not in existing_ids

    // Create OCF contract
    new_cid = create Stakeholder(context, data)

    // Update state
    return create this with { stakeholders: [new_cid, ...stakeholders] }
```

### Edit (Correct)

```
choice EditStakeholder(old_cid, new_data):
    // Validate exists in our list
    assert old_cid in stakeholders

    // Fetch and validate ID unchanged
    old = fetch(old_cid)
    assert old.id == new_data.id  // Can't change ID via edit

    // Replace contract
    archive old_cid
    new_cid = create Stakeholder(context, new_data)

    // Update state
    return create this with {
        stakeholders: [new_cid, ...stakeholders.filter(c => c != old_cid)]
    }
```

### Delete (Remove)

```
choice DeleteStakeholder(cid):
    // Validate exists
    assert cid in stakeholders

    // Optional: check no dependent objects

    // Remove
    archive cid
    return create this with { stakeholders: stakeholders.filter(c => c != cid) }
```

---

## Validation Example: Stock Issuance

Shows how reference integrity is enforced:

```
choice AddStockIssuance(data):
    // Validate stakeholder exists
    stakeholder_ids = fetch_all(stakeholders).map(s => s.id)
    assert data.stakeholder_id in stakeholder_ids

    // Validate stock class exists
    class_ids = fetch_all(stock_classes).map(c => c.id)
    assert data.stock_class_id in class_ids

    // Validate security ID unique
    existing_security_ids = fetch_all(stock_issuances).map(i => i.security_id)
    assert data.security_id not in existing_security_ids

    // Create
    new_cid = create StockIssuance(context, data)
    return create this with { stock_issuances: [new_cid, ...stock_issuances] }
```

---

## Template Changes

### Remove ArchiveByIssuer

**Before:**
```
template Stakeholder:
    signatory: issuer, system_operator

    choice ArchiveByIssuer:  // ← Remove this
        controller: issuer
        return ()
```

**After:**
```
template Stakeholder:
    signatory: issuer, system_operator
    // No ArchiveByIssuer — lifecycle controlled by IssuerState
```

Since `IssuerState` shares the same signatories, it can directly `archive` any OCF contract.

---

## Implementation Plan

### Phase 1: Create IssuerState
- Create `IssuerState.daml` with all ContractId arrays
- Implement `Add*`, `Edit*`, `Delete*` choices with validation
- Write comprehensive tests

### Phase 2: Update Templates
- Remove `ArchiveByIssuer` from all OCF templates
- Update `OcpFactory` to create `IssuerState` instead of `Issuer`
- Keep old `Issuer` template (deprecated) for backward compatibility
- Update SDK to use new contract

### Phase 3: Migration
- Create migration script to consolidate existing contracts
- Collect all existing OCF contracts for an issuer
- Create new `IssuerState` with ContractIds
- Archive old `Issuer` contract

---

## Consequences

### Positive

| Benefit | Description |
|---------|-------------|
| Central lifecycle control | All create/edit/delete through `IssuerState` |
| Reference integrity | Validate IDs exist before operations |
| Error correction | Edit and delete support for mistakes |
| Atomic operations | Multi-step operations in single transaction |
| OCF compliance | Objects remain in standard format |
| Queryable state | ContractId arrays show what exists |

### Negative

| Concern | Mitigation |
|---------|------------|
| Validation cost | Fetching contracts to validate; cache if needed |
| Array operations O(n) | Add indexes when scale requires |
| Breaking change | Provide migration path |

---

## Scale Considerations

**Typical startup** (~50 stakeholders, ~500 securities): Arrays are fast enough.

**If hitting limits:**
1. Add `Map<id, ContractId>` indexes for O(1) lookup
2. Batch validation (fetch once, check many)
3. Shard by object type into separate state contracts

---

## Alternatives Considered

| Alternative | Decision |
|-------------|----------|
| **Keep current design** | Rejected — no state tracking, no reference integrity, no edit/delete |
| **Embed OCF data in arrays** | Rejected — duplicates data, harder to query individual objects |
| **Maps instead of arrays** | Deferred — adds complexity, can add later when needed |

---

## References

- [OCF Schema](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF)
- [ADR-001: OCF Cap Table on Canton](https://github.com/fairmint/canton/blob/main/docs/developer/adr/001-ocf-captable-on-canton.md)
- [Canton Network Documentation](https://docs.canton.network/)
