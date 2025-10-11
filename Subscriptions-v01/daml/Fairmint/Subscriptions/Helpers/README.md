# Active Subscription Data Fields

This document details all data fields that are part of an active subscription contract (`FreeTrialSubscription` or `PaidSubscription`), how each is assigned, format conversions, and who can approve changes.

---

## Core Subscription Data

Both `FreeTrialSubscription` and `PaidSubscription` share the same base structure with some template-specific additions.

### Common Fields (Both Templates)

#### 1. **paidUntil** : `Time`
**Description:** Subscription is paid/advanced through this timestamp. Extends by one period with each payment processing.

**Assignment:**
- **Initial value:** Set during proposal acceptance to the current ledger time
- **During processing:** Advanced by `processingPeriod` (a `RelTime` duration), but capped to:
  - `min(now + prepayWindow, expiresAt)`
  - For trials: also capped to `trialEndsAt`
- **Format conversion:** Processor provides `RelTime` duration → converted to absolute `Time` by adding to current `paidUntil`

**Who can change:**
- **Processor only** (via `Process` or `ProcessPayment` choices)
- Changes are automatic during processing, not directly controllable by other parties

---

#### 2. **recipientProvider** : `Party`
**Description:** Provider party for recipient's Amulet transfers and activity markers.

**Assignment:**
- **Initial value:** Set during proposal acceptance by the recipient
- Passed in `RecipientAccept` choice parameter

**Who can change:**
- **Recipient only** (via `RecipientUpdateProvider` choice)

---

#### 3. **config** : `SubscriptionConfig`
This is a nested record containing the subscription terms. See [SubscriptionConfig Fields](#subscriptionconfig-fields) below.

---

#### 4. **context** : `ProcessorContext`
**Description:** Processor and DSO context for payment processing.

**Assignment:**
- **Initial value:** Set during processor approval
- Contains:
  - `processor : Party` - Party who processes subscription payments
  - `dso : Party` - Expected DSO party (must match all amulets)

**Who can change:**
- **Immutable** - Cannot be changed after subscription is created

---

### Template-Specific Fields

#### FreeTrialSubscription Only

##### **trialEndsAt** : `Time`
**Description:** Free trial ends at this timestamp. When reached, trial converts to `PaidSubscription`.

**Assignment:**
- **Initial value:** Resolved during proposal acceptance from `SubscriptionExpiration` (which can be either):
  - `AbsoluteExpiration Time` → Used directly as `trialEndsAt`
  - `RelativeExpiration RelTime` → Converted to absolute time by adding to current ledger time at acceptance
- **Format conversion:** If provided as `RelativeExpiration (days 30)`, converted to absolute `Time` = `now + 30 days` at acceptance time
- **Key benefit of RelativeExpiration:** Proposals can remain outstanding without eating into trial duration

**Who can change:**
- **Subscriber** can **reduce** trial end time (via `SubscriberReduceTrial`)
- **Recipient** can **extend** trial end time (via `RecipientExtendTrial`)

---

## SubscriptionConfig Fields

The `config` field contains these subscription terms:

### 1. **subscriber** : `Party`
**Description:** Party paying the subscription bill (customer).

**Assignment:**
- **Initial value:** Set during proposal creation by the proposing party

**Who can change:**
- **Immutable** - Cannot be changed after subscription is created

---

### 2. **recipient** : `Party`
**Description:** Party receiving subscription payments (company/treasury address).

**Assignment:**
- **Initial value:** Set during proposal creation by the proposing party

**Who can change:**
- **Immutable** - Cannot be changed after subscription is created

---

### 3. **recipientPaymentPerDay** : `SubscriptionAmount`
**Description:** Daily rate the subscriber pays to the recipient.

**Type:** Either `AmuletAmount Decimal` or `USDAmount Decimal`

**Assignment:**
- **Initial value:** Set during proposal creation
- **Pro-rated billing:** `amountForPeriod = (recipientPaymentPerDay × actualPeriod) / 1 day`
- **USD conversion:** If `USDAmount`, converted to Amulet using current `amuletPrice` from `OpenMiningRound`

**Format conversion:**
- Stored as either Amulet or USD denomination
- USD amounts converted to Amulet during payment processing using real-time exchange rate
- Must be > 0 (validated)

**Who can change:**
- **Subscriber** can **increase** (via `SubscriberIncreasePayments`)
- **Recipient** can **decrease** their own payment (via `RecipientDecreasePayment`)
- **Recipient** can propose increases (requires subscriber acceptance via `PaymentChangeProposal`)

---

### 4. **processorPaymentPerDay** : `SubscriptionAmount`
**Description:** Daily rate the subscriber pays to the processor as a fee.

**Type:** Either `AmuletAmount Decimal` or `USDAmount Decimal`

**Assignment:**
- **Initial value:** Set during proposal creation
- **Zero-fee mode:** Can be set to `AmuletAmount 0.0` or `USDAmount 0.0`
- **Pro-rated billing:** Same calculation as recipient payment
- **USD conversion:** Same as recipient payment

**Format conversion:**
- Same as `recipientPaymentPerDay`
- Must be >= 0 (zero allowed for zero-fee mode)

**Who can change:**
- **Subscriber** can **increase** (via `SubscriberIncreasePayments`)
- **Processor** can **decrease** their own payment (via `ProcessorDecreasePayment`)
- **Recipient** can propose increases (requires subscriber acceptance via `PaymentChangeProposal`)

---

### 5. **prepayWindow** : `RelTime`
**Description:** How far ahead `paidUntil` can extend beyond current time (e.g., 7 days, 0 for pay-as-you-go).

**Assignment:**
- **Initial value:** Set during proposal creation
- **Effect on paidUntil:** `paidUntil` capped at `min(now + prepayWindow, expiresAt)`

**Format conversion:**
- Stored as `RelTime` (duration type)
- Applied as offset from current time during payment processing

**Who can change:**
- **Subscriber** can **increase** (via `SubscriberIncreasePrepayWindow`)
- **Recipient** can **decrease** (via `RecipientDecreasePrepayWindow`)

---

### 6. **expiresAt** : `Time`
**Description:** Subscription end-of-life date. No payment processing allowed after this time.

**Assignment:**
- **Initial value:** Set during proposal creation (often far in the future for ongoing subscriptions)
- **Effect on paidUntil:** `paidUntil` cannot exceed `expiresAt`

**Format conversion:**
- Always stored as absolute `Time`
- No relative conversion - must be provided as absolute timestamp

**Who can change:**
- **Subscriber only** can update to any time (via `SubscriberUpdateExpiration`)
- **Recipient** can propose extension (requires subscriber acceptance via `ExpirationExtensionProposal`)

---

### 7. **description** : `Optional Text`
**Description:** Optional human-readable description of subscription purpose (e.g., "Premium membership", "Premium tier - app_id:123").

**Assignment:**
- **Initial value:** Set during proposal creation
- Can be `None` or `Some "text"`
- **Validation:** If present, must be non-empty text

**Format conversion:**
- No conversion - stored as provided
- Validated to ensure non-empty if present

**Who can change:**
- **Requires both subscriber and recipient approval**
- Not yet implemented in current contracts
- Would require description update proposal contract (similar to `MetadataChangeProposal`)

---

### 8. **metadata** : `TextMap Text`
**Description:** Structured key-value pairs for additional subscription information (e.g., RewardShare contract IDs, external IDs, service tiers).

**Assignment:**
- **Initial value:** Set during proposal creation (often empty: `TM.empty`)
- **Validation:** 
  - Max 100 key-value pairs
  - Keys: Non-empty, max 256 characters
  - Values: Max 4096 characters
- **Common use:** Reference RewardShare contract IDs for off-chain reward distribution

**Format conversion:**
- Stored as `TextMap Text` (type-safe key-value map)
- No conversion - keys and values are text strings

**Who can change:**
- **Requires processor approval first, then other party acceptance**
- Either subscriber or recipient can propose changes via `MetadataChangeProposal`
- **Two-stage approval:**
  1. Proposer (subscriber or recipient) creates `MetadataChangeProposal`
  2. Processor approves → creates `ProcessorApprovedMetadataChangeProposal`
  3. Other party accepts → metadata updated on subscription

---

## Change Approval Summary

| Field | Subscriber | Recipient | Processor | Requires Proposal |
|-------|-----------|-----------|-----------|-------------------|
| **paidUntil** | ❌ | ❌ | ✅ Automatic | No (automatic during processing) |
| **trialEndsAt** (FreeTrialSubscription) | ✅ Reduce | ✅ Extend | ❌ | No |
| **recipientProvider** | ❌ | ✅ Direct | ❌ | No |
| **subscriber** | ❌ Immutable | ❌ Immutable | ❌ Immutable | N/A |
| **recipient** | ❌ Immutable | ❌ Immutable | ❌ Immutable | N/A |
| **recipientPaymentPerDay** | ✅ Increase | ✅ Decrease | ❌ | Yes (for recipient to increase) |
| **processorPaymentPerDay** | ✅ Increase | ❌ | ✅ Decrease | Yes (for recipient to increase) |
| **prepayWindow** | ✅ Increase | ✅ Decrease | ❌ | No |
| **expiresAt** | ✅ Direct | ❌ | ❌ | Yes (for recipient to extend) |
| **description** | ⚠️ Not implemented | ⚠️ Not implemented | ❌ | Yes (would require both) |
| **metadata** | ✅ Propose | ✅ Propose | ✅ Must approve | Yes (processor + other party) |
| **context** | ❌ Immutable | ❌ Immutable | ❌ Immutable | N/A |

### Legend:
- ✅ = Can change directly or must approve change
- ❌ = Cannot change
- ⚠️ = Not yet implemented

---

## Key Principles

1. **Immutable Identities:** `subscriber`, `recipient`, `processor`, and `dso` cannot change after subscription creation
2. **Automatic Advancement:** `paidUntil` is only changed by processor during payment processing
3. **Party-Negative Changes:** Parties can make changes that are negative to themselves without approval:
   - Subscriber: increase payments, increase prepay window, extend expiration
   - Recipient: decrease their payment, decrease prepay window
   - Processor: decrease their payment
4. **Mutual Agreement Required:** Changes requiring both parties use proposal contracts:
   - Payment increases (proposed by recipient)
   - Expiration extensions (proposed by recipient)
   - Metadata changes (proposed by either, requires processor + other party)
5. **Time Format Conversions:**
   - **expiresAt:** Always absolute `Time` (no conversion)
   - **trialEndsAt:** Can be created from relative duration but stored as absolute `Time`
   - **paidUntil:** Calculated from current value + `RelTime` duration, but stored as absolute `Time`
   - **prepayWindow:** Stored as `RelTime`, applied as offset during processing
6. **Amount Format Conversions:**
   - Payments stored as either `AmuletAmount` or `USDAmount`
   - USD amounts converted to Amulet using current exchange rate during processing
   - Pro-rated calculation: `(amountPerDay × actualPeriod) / 1 day`

