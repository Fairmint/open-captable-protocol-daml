## Shared Coding Guidelines for OCP DAML Packages

This repository contains multiple DAML packages (e.g., `OpenCapTable-v23`, `OpenCapTableReports-v01`, `OpenCapTableProofOfOwnership-v01`, `OpenCapTableShared-v01`). This document defines coding guidelines that apply to all packages.

For package-specific details about each implementation, see the README.md file in the respective package directory (e.g., `open-captable-protocol-daml/OpenCapTable-v23/README.md`).

### Global exceptions

- We use DAML `Time` instead of schema `Date` (schema excludes time) as a workaround for a JavaScript parsing issue.

### Implementation guidance
 
- **Non-empty Text values**:
  - Never allow empty `Text` strings. For `Optional Text`, if provided (`Some t`), ensure `t /= ""`.
  - For arrays of `Text`, validate each element is non-empty.
- **Arrays are non-optional**: Do not omit array fields. When there are no items, emit an empty array (`[]`) instead of leaving the field out.
- **Shared types and organization**:
  - Define any type used by more than one template in `Types.daml` (with its validator) and import where needed.
  - Keep template files focused; if a type is only used by a single template, define it in that template file.
  - Do not import a template module solely to access a type; move that type to `Types.daml` instead.
  - Within each record, maintain field ordering for readability:
    1) `id` first
    2) Required scalar fields (alphabetical)
    3) Arrays (alphabetical)
    4) Optional fields (alphabetical)
  - This ordering applies to all types/records (not only top-level transaction objects). If a record does not have an `id`, skip step 1 and still follow required → arrays → optional with alphabetical ordering within each group.
  - Required refers to types which are not `Optional` or an array. Keep the groups strict and correct.
  - Use short section headers and separators to denote these groups exactly as:
    - `-- Required fields (alphabetical)`
    - `-- ---------------------------------`
    - `-- Arrays (alphabetical)`
    - `-- ---------------------------------`
    - `-- Optional fields (alphabetical)`
    - `-- ---------------------------------`
 - **Declaration order in template files**: Place declarations in this order within each template file: 1) `template` block first, 2) top-level `data` (the main object record), 3) subtype `data` (helper or nested records specific to the template). Keep the two data definitions adjacent.
- **Validator placement**: Define the validator immediately after the corresponding `data` type it validates, in the same file. Example:

```daml
data OcfThing = OcfThing with field: Text deriving (Eq, Show)

validateOcfThing : OcfThing -> Bool
validateOcfThing t = t.field /= ""
```
- **Test helpers**: Place test helpers only in the `Test` package, never in main packages.

### Package-specific guidance

Each package may include additional constraints and domain guidance. Refer to:

- `open-captable-protocol-daml/OpenCapTable-v23/README.md` for Open Cap Table specifics (e.g., Issuer management patterns).
- Other package READMEs as applicable.


