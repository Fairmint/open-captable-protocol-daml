## OpenCapTable implementation

This module contains the Open Cap Table Protocol (OpenCapTable) implementation used in this workspace. It mirrors the concepts defined by the Open Cap Format (OCF) and is organized around the same core building blocks: enums, types, objects, transactions, and files.

### Source of truth: schema (@schema/)

**The single source of truth for all data structures is the JSON Schema under `@schema/`.** In this workspace that refers to the schema directory at `Open-Cap-Format-OCF/schema/`.

- **Strict adherence**: All models, types, events, and files must strictly match the schema definitions (required fields, `const` values, enums, oneOf/anyOf/allOf constraints, formats, and `additionalProperties` rules).
- **No drift**: Do not introduce fields, values, or shapes that are not defined in the schema. If a need arises, propose a schema change first and only then update code.
- **Validation first**: Any produced or ingested JSON must validate against the relevant schema (e.g., objects, transactions, and files as defined under `@schema/`).

### What the schema covers

The schema defines a comprehensive canonical contract including but not limited to:

- **Enums**: E.g., `ObjectType`, `FileType`, `StockClassType`, `CompensationType`.
- **Types**: E.g., `Numeric`, `Monetary`, `Percentage`, `Ratio`, `Name`, `Address`.
- **Objects**: E.g., `Issuer`, `Stakeholder`, `StockClass`, `StockPlan`, `Valuation`, `VestingTerms`, `Document`.
- **Transactions**: Issuance, acceptance, transfer, cancellation, conversion, exercise, vesting, split, adjustments, reissuance, repurchase, retraction, return-to-pool, and stakeholder change events.
- **Files**: OCF package files including `OCF_MANIFEST_FILE`, `OCF_STAKEHOLDERS_FILE`, `OCF_STOCK_CLASSES_FILE`, `OCF_TRANSACTIONS_FILE`, etc.

### Implementation guidance

- **Generate/validate from schema**: Prefer generating types and validators from `@schema/` or using runtime JSON Schema validation to guarantee correctness.
- **Honor invariants**: Respect `required`, `const`, `enum`, and composition constraints (`allOf`/`oneOf`/`anyOf`), and use the exact shapes the schema specifies.
- **Derived `object_type`**: In templates (e.g., DAML), an object's `object_type` is implied from the template type/module. When serializing to OCF JSON or validating, set the exact `object_type` const value defined by the schema for that object.
- **Arrays are non-optional**: Do not omit array fields. When there are no items, emit an empty array (`[]`) instead of leaving the field out.
- **Required numbers may be zero**: A required numeric field may validly be `0` unless the schema specifies otherwise (e.g., via minimums or other constraints). Do not substitute `null` for required numeric fields.
- **Versioning**: Track the OCF version in the manifest and ensure any changes remain compatible with the referenced schema version.
- **Interoperability**: Treat schema-conformant JSON as canonical for exchange across services and tools.

### Quick checklist (before merging changes)

1) Do all new/updated structures validate against `@schema/`?
2) Are object `object_type` and file `file_type` `const` values correct?
3) Are all `required` fields present and formats correct (e.g., dates, emails, MD5, currency codes)?
4) Are enums restricted to allowed values and rounding/period/trigger types honored?
5) Are `additionalProperties` rules respected (no extra fields)?

If any of the above fails, update the DAML to conform to the schema. The schema is authoritative and must not be changed here.

### Paths

- Schema (source of truth): `Open-Cap-Format-OCF/schema/` (aka `@schema/`)
- This module: `open-captable-protocol-daml/OpenCapTable-v21/`

For questions or proposed schema changes, open an issue with a concrete diff to `@schema/` and the rationale for the change.

