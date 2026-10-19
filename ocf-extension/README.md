# Fairmint OCF extension: the hold pair

OpenCapTable-v35 extends the Open Cap Format (OCF) with one pair of transactions, `TX_STOCK_HOLD`
and `TX_STOCK_HOLD_CANCELLATION`, following OCF's primitive pattern (as `Cancellation` is shared by
`StockCancellation` and its siblings). These schemas are pinned to OCF
[`6d8c932`](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF/tree/6d8c93227de64fc014fe0a215af208f4a5432542/schema).

| File | What it is |
| --- | --- |
| `schema/primitives/objects/transactions/hold/Hold.schema.json` | `hold_type`, `reference` and `reason_text`, all required |
| `schema/primitives/objects/transactions/hold/HoldCancellation.schema.json` | `hold_id` and `reason_text`, both required; no quantity, because a hold ends whole |
| `schema/enums/HoldType.schema.json` | `REGISTER_SETTLEMENT`, `STOP_TRANSFER` |
| `schema/objects/transactions/hold/StockHold.schema.json` | `TX_STOCK_HOLD`: `quantity` required for `REGISTER_SETTLEMENT` and absent for `STOP_TRANSFER` |
| `schema/objects/transactions/hold/StockHoldCancellation.schema.json` | `TX_STOCK_HOLD_CANCELLATION` |
| `schema/enums/ObjectType.schema.json` | OCF's `ObjectType`, amended with the two values |
| `schema/files/TransactionsFile.schema.json` | OCF's `TransactionsFile`, whose items also take the two objects |

Reading rules: a hold is open until a `TX_STOCK_HOLD_CANCELLATION` names it or its security is
consumed, and a `REGISTER_SETTLEMENT` hold is void from the date of a later split of its class. The
pair says "on hold", never "held shares", because OCF uses "holds" for ownership.

A strict OCF export leaves the pair out and stays exact, because a hold never changes who owns what;
an extended export includes it. Only the register's hold choices (`CapTable_PlaceHolds`,
`CapTable_CancelHolds`, `CapTable_Settle`) write these records, always under derived IDs.
