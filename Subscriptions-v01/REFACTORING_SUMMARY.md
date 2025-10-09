# Subscription Contract Refactoring Summary

## Overview

Successfully refactored the subscription contract system to split lifecycle states into separate, type-safe templates instead of using a single template with optional fields and runtime guards.

## What Changed

### 1. **New Contract Structure**

Split the monolithic `Subscription` template into three lifecycle-specific templates:

#### **FreeTrialSubscription**
- Represents an active free trial
- Has `trialEndsAt: Time` as a **non-optional** field
- No payment processing - only advances `paidUntil` and creates activity markers
- **State Transitions:**
  - → `PaidSubscription`: when trial ends (via `FreeTrialSubscription_Process`)
  - → Archive: instant cancellation by any party (no prepaid amount)
  
#### **PaidSubscription**
- Represents an active paid subscription
- Processes payments each period using Amulet transfers
- **State Transitions:**
  - → `FreeTrialSubscription`: recipient can start a free trial
  - → `PrepaidCanceledSubscription`: any party cancels with `paidUntil > now`
  - → Archive: any party cancels with `paidUntil <= now`

#### **PrepaidCanceledSubscription**
- Represents a canceled subscription that was prepaid beyond cancellation time
- Read-only state that tracks who canceled and when
- Can be archived once `paidUntil` has passed
- Fields: `paidUntil`, `canceledBy`, `canceledAt`

### 2. **Combined Module**

To avoid circular dependencies between `FreeTrialSubscription` and `PaidSubscription` (since they transition between each other), both templates are defined in a single module:

```
Subscriptions-v01/daml/Fairmint/Subscriptions/Subscriptions.daml
```

This module exports:
- `FreeTrialSubscription` template
- `PaidSubscription` template  
- Shared helper functions: `calculateAmountForPeriod`, `paymentTo`
- Data types: `PaymentContext`, `PaymentRequest`, result types

### 3. **Updated SubscriptionConfig**

Removed the `freeTrialEndsAt : Optional Time` field from `SubscriptionConfig`. This field is now managed by the template structure itself:
- If a `FreeTrialSubscription` exists, it has `trialEndsAt` as a non-optional field
- If a `PaidSubscription` exists, there is no trial

### 4. **Updated Proposal Flow**

The subscription proposal system now accepts an optional `freeTrialEndsAt` parameter and creates the appropriate subscription type at acceptance time:

```daml
-- In SubscriptionFactory
choice SubscriptionFactory_CreateSubscriberProposal
  with
    config : SubscriptionConfig
    freeTrialEndsAt : Optional Time  -- NEW!
```

At acceptance time, the processor-approved proposal creates either:
- `Left (ContractId FreeTrialSubscription)` if `freeTrialEndsAt` is `Some`
- `Right (ContractId PaidSubscription)` if `freeTrialEndsAt` is `None`

### 5. **Key Design Benefits**

✅ **Type Safety**: Invalid operations are caught at compile-time
  - Can't call `ProcessPayment` on a `FreeTrialSubscription` - the choice doesn't exist
  - Can't accidentally process payments after cancellation

✅ **Explicit State Transitions**: State changes are visible as consuming choices that return different contract types
  ```daml
  FreeTrialSubscription_Process : Either (ContractId FreeTrialSubscription) (ContractId PaidSubscription)
  PaidSubscription_CancelBySubscriber : Optional (ContractId PrepaidCanceledSubscription)
  ```

✅ **State-Specific Data**: Each template only contains fields relevant to that state
  - `FreeTrialSubscription` has `trialEndsAt : Time` (not optional)
  - `PrepaidCanceledSubscription` has `canceledBy` and `canceledAt`
  - `PaidSubscription` has neither trial nor cancellation metadata

✅ **Simpler Validation**: Each template's `ensure` clause only validates what's relevant to that specific state

✅ **Clearer Authorization**: Different templates can have different signatories/observers for each lifecycle phase

## Files Modified

### Created
- `Subscriptions-v01/daml/Fairmint/Subscriptions/Subscriptions.daml` - Combined FreeTrialSubscription and PaidSubscription
- `Subscriptions-v01/daml/Fairmint/Subscriptions/PrepaidCanceledSubscription.daml` - Prepaid cancellation state

### Modified
- `Subscriptions-v01/daml/Fairmint/Subscriptions/SubscriptionConfig.daml` - Removed `freeTrialEndsAt` field
- `Subscriptions-v01/daml/Fairmint/Subscriptions/SubscriptionFactory.daml` - Added `freeTrialEndsAt` parameter to creation choices
- `Subscriptions-v01/daml/Fairmint/Subscriptions/SubscriptionProposal.daml` - Added `freeTrialEndsAt` field
- `Subscriptions-v01/daml/Fairmint/Subscriptions/RecipientInitiatedSubscriptionProposal.daml` - Added `freeTrialEndsAt` field
- `Subscriptions-v01/daml/Fairmint/Subscriptions/ProcessorApprovedSubscriptionProposal.daml` - Creates appropriate subscription type at acceptance
- `Subscriptions-v01/daml/Fairmint/Subscriptions/ProcessorApprovedRecipientInitiatedSubscriptionProposal.daml` - Creates appropriate subscription type at acceptance
- `Test/daml/Subscriptions/TestUtils.daml` - Updated helper functions
- `Test/daml/Subscriptions/TestSubscriberInitiatedLifecycle.daml` - Updated to work with new contract structure

### Renamed/Archived
- `Subscription.daml` → `Subscription.daml.old` (preserved as reference)

## Cancellation Behavior

### FreeTrialSubscription
- **Any party can cancel instantly** (archives immediately)
- No `PrepaidCanceledSubscription` needed since there's no prepayment during trial

### PaidSubscription
- **Cancellation depends on `paidUntil`**:
  - If `paidUntil > now`: Creates `PrepaidCanceledSubscription` with cancellation metadata
  - If `paidUntil <= now`: Archives immediately (no prepaid period remaining)

### PrepaidCanceledSubscription
- **Read-only state** until `paidUntil` passes
- Any party can archive once `paidUntil < now`
- Tracks `canceledBy` and `canceledAt` for audit purposes

## Migration Notes

### For Developers

When working with subscriptions, you'll now need to handle the different contract types:

```daml
-- At acceptance time
result <- exerciseCmd approvedProposalCid ProcessorApprovedSubscriptionProposal_RecipientAccept

case result.subscription of
  Left freeTrialCid -> 
    -- Handle FreeTrialSubscription
    exerciseCmd freeTrialCid FreeTrialSubscription_Process with ...
  
  Right paidCid -> 
    -- Handle PaidSubscription
    exerciseCmd paidCid PaidSubscription_ProcessPayment with ...
```

### Remaining Test Updates

The following test files still need to be updated to work with the new structure:
- `TestRecipientInitiatedLifecycle.daml`
- `TestValidation.daml`
- `TestPaymentProcessing.daml`
- `TestArchive.daml`
- `TestFeaturedAppRight.daml`
- `TestConfigurationUpdates.daml`

The pattern for updating is similar to what was done in `TestSubscriberInitiatedLifecycle.daml`:
1. Import `Fairmint.Subscriptions.Subscriptions` instead of individual templates
2. Handle the `Either` return type from acceptance choices
3. Use the appropriate choice names (e.g., `PaidSubscription_CancelBySubscriber`)

## Build Status

✅ **Package builds successfully**
- Exit code: 0
- DAR created: `.daml/dist/Subscriptions-v01-0.0.2.dar`
- Only minor warnings about redundant imports (non-critical)

## Next Steps

1. Update remaining test files to work with new structure
2. Update any external systems that interact with subscriptions to handle the new contract types
3. Consider updating the README.md with the new contract structure
4. Test the full subscription lifecycle end-to-end

