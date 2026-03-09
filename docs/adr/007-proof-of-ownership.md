# ADR-007: Proof of Ownership Contract

## Status

**Implemented** | 2026-03-09

---

## TL;DR

An `OwnershipProof` contract allows stakeholders to prove ownership of a specific quantity of stock to third parties without revealing underlying transaction details. The proof references source contracts (issuances/cancellations) and can be verified on-demand via a non-consuming choice.

---

## Context

Third parties (investors, auditors, counterparties) may need to verify that a stakeholder owns a claimed quantity of stock without full ledger access. The proof must be:

1. **Verifiable on-chain** — Anyone with observer access can trigger verification
2. **Privacy-preserving** — Observers see the proof, not the underlying contracts
3. **Point-in-time** — Reflects ownership at creation time

---

## Decision

### Contract: OwnershipProof

A proof that a stakeholder owns `expected_total` shares, backed by referenced source contracts.

```daml
template OwnershipProof
  with
    context: Context
    stakeholder_id: Text
    expected_total: Decimal
    stock_issuances: [ContractId StockIssuance]
    stock_cancellations: [ContractId StockCancellation]
    created_at: Time
    observers: [Party]
  where
    signatory context.system_operator
    observer observers
    ensure expected_total >= 0.0 && stakeholder_id /= ""
```

| Field | Type | Description |
|-------|------|-------------|
| `context` | `Context` | System operator party (signatory) |
| `stakeholder_id` | `Text` | OCF stakeholder ID |
| `expected_total` | `Decimal` | Claimed total shares owned |
| `stock_issuances` | `[ContractId StockIssuance]` | Source issuance contracts |
| `stock_cancellations` | `[ContractId StockCancellation]` | Source cancellation contracts |
| `created_at` | `Time` | Proof creation timestamp |
| `observers` | `[Party]` | Parties who can view and verify |

### Choice: AddObservers

Adds new observers to the proof. Deduplicates and aborts if no new observers provided.

### Choice: Verify (non-consuming)

Validates the proof without consuming the contract:

1. **Stakeholder match** — All issuances belong to `stakeholder_id`
2. **Security linkage** — All cancellations reference securities from those issuances
3. **Total validation** — `sum(issuances) - sum(cancellations) == expected_total`

Aborts with descriptive error if any check fails.

---

## Design Decisions

### Non-Consuming Verification

`Verify` is non-consuming so the proof can be verified multiple times by different parties. The proof contract persists until explicitly archived.

### Observer-Based Access Control

Third parties are added as observers rather than signatories. They can view the proof and trigger `Verify`, but the system operator retains full control.

### Contract References vs Snapshots

The proof stores **contract IDs** rather than copied data. This means:

- **Pro**: Smaller proof, always verifies against current contract state
- **Con**: Referenced contracts must still exist; proof breaks if source contracts are archived

---

## Limitations (POC)

This is a proof-of-concept with significant limitations:

| Limitation | Impact |
|------------|--------|
| **Stock only** | Only supports `StockIssuance`/`StockCancellation`; no convertibles, warrants, options, etc. |
| **No transfers** | Ignores `StockTransfer` transactions affecting ownership |
| **Point-in-time fragility** | If source contracts are archived (e.g., exercised, cancelled), verification fails |
| **Manual assembly** | No automated proof generation from cap table state |
| **Single stakeholder** | One proof per stakeholder; no aggregate/portfolio proofs |

### Missing for Production

- Support for all OCF transaction types affecting ownership
- Integration with `CapTable` for automated proof generation
- Proof refresh mechanism when source contracts change
- Multi-stakeholder aggregate proofs
- Historical ownership verification

---

## Consequences

### Benefits

- **Privacy**: Observers see proof without full ledger access
- **On-chain verification**: Trustless validation via DAML choice
- **Simple model**: Easy to understand and extend

### Tradeoffs

- **Contract dependency**: Proof validity depends on source contract existence
- **Incomplete coverage**: Only stock issuances/cancellations supported
- **Manual workflow**: No automated proof lifecycle

---

## References

- Package: `OpenCapTableProofOfOwnership-v01` (v0.0.1)
- Contract: `Fairmint.OpenCapTableProof.OwnershipProof`

---

_Last updated: 2026-03-09_
