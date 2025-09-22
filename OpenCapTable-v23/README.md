## OpenCapTable implementation

This module contains the Open Cap Table Protocol (OpenCapTable) DAML implementation for the Canton Network. It mirrors the concepts and schema defined by the Open Cap Format (OCF) and is organized around the same core building blocks: objects and transactions using the schema's types and enums.

### Source of truth: schema (@schema)

**The single source of truth for all data structures is the JSON Schema under `Open-Cap-Format-OCF/schema/` (`@schema`).**

- **Strict adherence**: All models, types, events, and files must strictly match the schema definitions (required fields, `const` values, enums, oneOf/anyOf/allOf constraints, formats, and `additionalProperties` rules).
- **No drift**: Do not introduce fields, values, or shapes that are not defined in the schema. If a need arises, propose a schema change first and only then update code.
- **Validation first**: Any produced or ingested JSON must validate against the relevant schema (e.g., objects, transactions, and files as defined under `@schema`).

#### Exceptions

- In DAML we are currently using the `Time` type instead of `Date` even though the schema excludes a time component from dates. This is a workaround to a Javascript library parsing error.
- In DAML we exclude the `object_type` field since it is implied from the template used.

### Implementation guidance

- **Arrays are non-optional**: Do not omit array fields. When there are no items, emit an empty array (`[]`) instead of leaving the field out.
- **Required numbers may be zero**: A required numeric field may validly be `0` unless the schema specifies otherwise (e.g., via minimums or other constraints). Do not substitute `null` for required numeric fields, similarly if the number is optional `null` may have a different meaning than `0` (e.g. unknown vs none).
- **Code Comments**: The DAML code should be well commented, directly linking to the schema for each object or type and including the comments from the schema for each field.
- **Shared Types**: Shared types should be defined in the `Types.daml` file (and their validators) and imported into the other modules. Types which are specific to a template should be defined in the template module/file.
- **Deprecated fields**: Deprecated fields should be excluded from the DAML code. The SDK will map any deprecated inputs into the latest standard.
- **Signatories**: All OCP objects must use both the issuer and system operator as signatories. Because of this, we cannot directly create or archive contracts. The creation of new OCP objects should be done via the Issuer contract's choices. And archiving should be done via the `ArchiveByIssuer` choice in each template.

### Usage Guidance

- **Issuer Management**: The Issuer object is the primary object for managing the cap table. Most other objects are created via the Issuer contract's choices.
- **Edits**: When an object needs to be edited, the original contract(s) should be archived with `ArchiveByIssuer` choice and then a new contract should be created with the new data. Ideally both commands are bundled into a single transaction so that the edit is atomic.