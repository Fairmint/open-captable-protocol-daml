# OCF validation model

The contracts implement the
[official Open Cap Format schema](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF).
OCF schema definitions and explicit protocol rules determine data validity; the DAML layer should
not introduce product-specific requirements merely because existing Fairmint data happens to follow
them.

## Validation layers

Validation is split across three code-level layers:

1. Each OCF record has a validator for its own shape and schema constraints. The template calls that
   validator from its `ensure` clause. See the object modules under
   [`OCF/`](../OpenCapTable-v34/daml/Fairmint/OpenCapTable/OCF/) and shared helpers under
   [`Types/`](../OpenCapTable-v34/daml/Fairmint/OpenCapTable/Types/).
2. The generated `CapTable` validates references against the aggregate's current maps. Most rules
   are declared in [`captable-config.yaml`](../scripts/codegen/captable-config.yaml), including
   type-specific security-ID indexes. Additional aggregate-wide checks, currently Financing
   issuance references, live in
   [`CapTable.daml.template`](../scripts/codegen/templates/CapTable.daml.template).
3. DAML Script tests exercise object validation, lifecycle behavior, batch ordering, and reference
   failures under [`Test/daml/OpenCapTable/`](../Test/daml/OpenCapTable/).

Unknown or missing referenced IDs fail before the batch is committed. Reference checks are scoped
to fields for which the repository has an authoritative target map; a field being named like an ID
is not enough evidence to invent a relationship.

## Schema-alignment rules

- Match required, optional, array, enum, and scalar constraints from the schema.
- A required numeric value may be zero unless the schema says otherwise.
- Optional text, when present, must satisfy the shared non-empty-text rule used by the contracts.
- `object_type` is not stored when the DAML template already determines it.
- Cross-object checks must point at the semantically correct map. For example, a stock transaction
  cannot satisfy a security reference with a warrant issuance.
- When schema and current contracts disagree, fix the contract and add a regression test for the
  exact accepted or rejected value. A compatibility-impacting change must then follow the package
  upgrade policy enforced by repository scripts.

## Contributor checklist

For a schema or validator change:

1. Link the relevant OCF schema definition in the code or pull request.
2. Update the DAML record validator and, when necessary, the generator configuration.
3. Add focused positive and negative DAML Script coverage.
4. Run `npm run build`, `npm test`, and `npm run lint:daml`.
5. Run `npm run check-upgrade-compat` if the serialized package surface may change.
6. Run `npm run codegen` and `npm run verify-package` when generated JavaScript bindings are
   affected.

[`scripts/schema-gap-checker/`](../scripts/schema-gap-checker/) can help identify structural gaps,
but it does not replace semantic review of validators and lifecycle behavior.
