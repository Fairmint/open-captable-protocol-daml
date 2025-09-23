## OpenCapTable implementation

This module contains the Open Cap Table Protocol (OpenCapTable) DAML implementation for the Canton Network. It mirrors the concepts and schema defined by the Open Cap Format (OCF) and is organized around the same core building blocks: objects and transactions using the schema's types and enums.

For shared coding guidelines that apply to all OCP DAML packages, see `open-captable-protocol-daml/README.md`.

### Schema guidance

#### Source of truth: schema (@schema)

**The single source of truth for all data structures is the JSON Schema under `Open-Cap-Format-OCF/schema/` (`@schema`).**

- **Strict adherence**: All models, types, events, and files must strictly match the schema definitions (required fields, `const` values, enums, oneOf/anyOf/allOf constraints, formats, and `additionalProperties` rules).
- **No drift**: Do not introduce fields, values, or shapes that are not defined in the schema. If a need arises, propose a schema change first and only then update code.
- **Validation first**: Any produced or ingested JSON must validate against the relevant schema (e.g., objects, transactions, and files as defined under `@schema`).

#### Implementation guidance tied to schema

- **Deprecated fields**: Exclude deprecated schema fields from DAML. The SDK is responsible for mapping deprecated inputs to the latest standard.
- **Signatories**: All OCP objects must use both the issuer and system operator as signatories. New objects should be created via the Issuer contract's choices. Archiving should be done via the `ArchiveByIssuer` choice in each template.
- **Required numbers may be zero**: A required numeric field may validly be `0` unless the schema specifies otherwise (e.g., via minimums or other constraints). Do not substitute `null` for required numeric fields; for optional numerics, `None`/`null` may indicate unknown.
- **Code comments**: The DAML code should be well commented, directly linking to the schema for each object or type and including the comments from the schema for each field.
  - Use the JSON Schema `$id` raw GitHub URL for links (copy from the `$id` field in the schema). Example:
    - `-- OCF: https://raw.githubusercontent.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF/main/schema/enums/ConversionTriggerType.schema.json`
  - Place the link immediately above each corresponding DAML type/enum/record definition.
  - Ensure links reference the canonical repository (`Open-Cap-Table-Coalition/Open-Cap-Format-OCF`) and not versioned site URLs.
  - To find the correct schema quickly, grep the `@schema/` folder (i.e., `Open-Cap-Format-OCF/schema/`) for the type or object/type/enum name and copy its `$id` value.
  - For each type/object definition, include comments in this order directly above the DAML definition:
    1) schema `title`
    2) schema `description`
    3) schema `$comment` (if present)
    4) OCF `$id` URL
  - For every field in every object/type, copy the schema comments:
     - Use the field's `title`, then `description`, then `$comment` (if present), in that order; add them as preceding `--` comments above the DAML field. Follow with the OCF `$id` URL when helpful.
    - For arrays, include helpful constraints from the schema such as `minItems`, `uniqueItems` (e.g., `-- minItems: 1`).
    - Do not add `required`/`optional` comments; DAML types convey optionality (`Optional ...`) and the schema drives validation.
    - Prefer comments from the most specific schema that defines the field (e.g., use WarrantIssuance comments for `purchase_price`, but use Issuance primitive comments for `security_law_exemptions`).
    - When our code enforces a stronger constraint than the schema (e.g., non-empty arrays), note it explicitly in a comment (e.g., `-- minItems: 1`).
  - Follow `allOf` references to find inherited field comments:
    - Look at the `allOf` array in the object schema (e.g., WarrantIssuance) to identify referenced primitive/object schemas (e.g., Issuance).
    - Open those referenced schemas locally under `Open-Cap-Format-OCF/schema/...` and copy the `title`/`description`/`$comment` for inherited fields (e.g., `board_approval_date`, `stockholder_approval_date`, `consideration_text`).
    - Use the referenced schema's comments where the field originates; avoid inventing summaries.
  - Keep comments simple and high-signal; avoid provenance annotations like "From primitives ...".

### Package-specific notes

- `Issuer.formation_date` is required by the OCF schema, but we are temporarily making it Optional due to missing data in upstream sources. This violates the schema requirements and should be reverted to required when data is available.
- In DAML we exclude the `object_type` field since it is implied from the template used.

- In `StockIssuance`, the schema requires `stock_legend_ids` with `minItems: 1`. Our implementation temporarily allows an empty array for `stock_legend_ids` to support existing data that lacks legends. The validator therefore does not enforce non-empty `stock_legend_ids`. This exception should be reverted when upstream data is corrected.

See global exceptions and implementation guidance in the shared guidelines.

#### Field ordering (clarification)
- All types/records in this package must follow the field ordering rule from the shared guidelines: `id` first (when present), then required fields (alphabetical), arrays (alphabetical), and optional fields (alphabetical). If a record has no `id`, skip that step and still follow the ordering. Refer to the shared README for full details.

#### Declaration order within template files
- Inside each DAML file, place declarations in this order:
  1) `template ... where` block first
  2) The main object `data` record used by the template (e.g., `OcfDocument`)
  3) Subtype/helper `data` definitions specific to the template (e.g., `OcfObjectReference`)
- Keep the main object and its helper types adjacent. Do not import another template module just to reuse a type; move the type to `Types.daml` only if it is shared across multiple templates.

#### “id first” with example
When a record has an `id`, list it before other fields, then follow the required → arrays → optional grouping. Example layout:

```daml
data Example = Example
  with
    -- Identifier for the object
    id: Text

    -- Required fields (alphabetical)
    ---------------------------------
    required_a: Text
    required_b: Int

    -- Arrays (alphabetical)
    ---------------------------------
    items: [Text]

    -- Optional fields (alphabetical)
    ---------------------------------
    optional_a: Optional Text
    optional_b: Optional Int
  deriving (Eq, Show)
```

#### Field-level comments are required
- For every field, add high-signal comments derived from the schema: field `title`, then `description`, then `$comment` if present. Include constraints like `-- minItems: 1` for arrays when relevant. Avoid annotating with “required/optional”; DAML types convey that.

Additionally, for each type/enum/object definition, include the schema-level metadata above the DAML definition in this order:
1) schema `title`
2) schema `description`
3) schema `$comment` (if present)
4) canonical OCF `$id` URL

Example for `ObjectReference`:

```daml
-- Type - Object Reference
-- A type representing a reference to any kind of OCF object
-- OCF: https://raw.githubusercontent.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF/main/schema/types/ObjectReference.schema.json
data OcfObjectReference = OcfObjectReference
  with
    -- Identifier of the referenced object
    object_id: Text
    -- Type of the referenced object
    object_type: OcfObjectType
  deriving (Eq, Show)
```

#### Optional Text fields must validate non-empty when present
- For every `Optional Text` field, validate with `validateOptionalText` in the record validator. This ensures that when a value is provided it is non-empty.
- When the schema requires that at least one of two optional fields be present, enforce both rules: (a) each optional text is non-empty when present, and (b) at least one is provided.
- Example from `Document`:

```daml
validateOcfDocument d =
  d.id /= "" &&
  validateOcfMd5 d.md5 &&
  validateOptionalText d.path &&
  validateOptionalText d.uri &&
  (case (d.path, d.uri) of
     (Some _, _) -> True
     (_, Some _) -> True
     _ -> False) &&
  validateTextArray d.comments &&
  all validateOcfObjectReference d.related_objects
```

#### Local vs shared helper types
- Define helper types that are only used by a single template (e.g., `OcfObjectReference` for `Document`) within that template file.
- Move a helper type to `Types.daml` only when it is used across multiple templates.

#### Notes for nested/template-specific types
- For nested/template-specific types defined inside a template file (e.g., conversion triggers within `ConvertibleIssuance`), apply the same commenting rules as for top-level types: include the schema title, description, `$comment` (if present), and the canonical OCF `$id` URL above the type; add field-level comments above each field using the most specific schema.

### Usage Guidance

- **Issuer Management**: The Issuer object is the primary object for managing the cap table. Most other objects are created via the Issuer contract's choices.
- **Edits**: When an object needs to be edited, the original contract(s) should be archived with `ArchiveByIssuer` choice and then a new contract should be created with the new data. Ideally both commands are bundled into a single transaction so that the edit is atomic.