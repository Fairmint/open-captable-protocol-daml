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
- `Issuer.formation_date` is required by the OCF schema, but we are temporarily making it Optional due to missing data in upstream sources. This violates the schema requirements and should be reverted to required when data is available.

### Implementation guidance

- **Arrays are non-optional**: Do not omit array fields. When there are no items, emit an empty array (`[]`) instead of leaving the field out.
- **Required numbers may be zero**: A required numeric field may validly be `0` unless the schema specifies otherwise (e.g., via minimums or other constraints). Do not substitute `null` for required numeric fields, similarly if the number is optional `null` may have a different meaning than `0` (e.g. unknown vs none).
- **Code Comments**: The DAML code should be well commented, directly linking to the schema for each object or type and including the comments from the schema for each field.
  - Use the JSON Schema `$id` raw GitHub URL for links (copy from the `$id` field in the schema). Example:
    - `-- OCF: https://raw.githubusercontent.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF/main/schema/enums/ConversionTriggerType.schema.json`
  - Place the link immediately above each corresponding DAML type/enum/record definition.
  - Ensure links reference the canonical repository (`Open-Cap-Table-Coalition/Open-Cap-Format-OCF`) and not versioned site URLs.
  - To find the correct schema quickly, grep the `@schema/` folder (i.e., `Open-Cap-Format-OCF/schema/`) for the type or object/type/enum name and copy its `$id` value.
- **Shared Types**: Shared types should be defined in the `Types.daml` file (and their validators) and imported into the other modules. Types which are specific to a template should be defined in the template module/file.
  - Do not introduce trivial alias types that do not add semantics (e.g., `type OcfNumeric = Decimal`). Prefer using the underlying DAML type directly. Exception: validators may still use a dedicated function name (e.g., keep `validateOcfPercentage`, but use `Decimal` as the type).
- **Deprecated fields**: Deprecated fields should be excluded from the DAML code. The SDK will map any deprecated inputs into the latest standard.
- **Signatories**: All OCP objects must use both the issuer and system operator as signatories. Because of this, we cannot directly create or archive contracts. The creation of new OCP objects should be done via the Issuer contract's choices. And archiving should be done via the `ArchiveByIssuer` choice in each template.
- **Test Helpers**: Test helpers should be defined in the Test package, never in the main package (OpenCapTable, OpenCapTableReports, or OpenCapTableShared).

#### Shared types organization

- Define any type used by more than one template in `Types.daml` (with its validator), and import it where needed.
- Keep template files focused: if a type is only used by a single template, define it in that template file.
- Do not import a template module solely to access a type; move that type to `Types.daml` instead.

### Usage Guidance

- **Issuer Management**: The Issuer object is the primary object for managing the cap table. Most other objects are created via the Issuer contract's choices.
- **Edits**: When an object needs to be edited, the original contract(s) should be archived with `ArchiveByIssuer` choice and then a new contract should be created with the new data. Ideally both commands are bundled into a single transaction so that the edit is atomic.