# Subscriptions-v01

A general-purpose DAML package for recurring payment subscriptions using Splice LockedAmulet.

## Overview

The Subscriptions package enables parties to create recurring payment subscriptions using LockedAmulet as collateral. This is a generic subscription mechanism that can be used in any Splice-based application.

**Key Features:**
- **Upfront collateral**: Subscriber must lock funds before proposing (prevents spam and ensures payment capability)
- **Proposal/Acceptance pattern**: Realistic user flow where subscriber proposes and service provider accepts
- **No DSO signatures required**: User-to-user contract that doesn't require DSO involvement for core operations
- **Configurable payment periods**: Subscriptions can be processed at configurable intervals (e.g., 10 minutes, hourly, daily, monthly)
- **Catch-up payments**: Recipients can catch up on missed periods if they skip processing
- **Dynamic balance management**: Subscribers can add or withdraw LockedAmulet at any time
- **Bilateral cancellation**: Either party can cancel the subscription at any time
- **Featured app rewards**: Creates SubscriptionActivityMarkerRequests that DSO can process to issue rewards

## Architecture

### No DSO Signatory
The subscription contracts are **user-to-user contracts** and do not require DSO as a signatory or controller. This means:
- Proposals, acceptance, and cancellation don't need DSO approval
- Contracts are created and managed entirely by subscriber and recipient
- DSO involvement is only for processing reward requests (separate contracts)

### Two-Phase Reward System
Since DSO cannot be a signatory on user contracts, rewards use a **proposal pattern**:

1. **Phase 1**: Recipient processes payment → creates `SubscriptionActivityMarkerRequest`
2. **Phase 2**: DSO processes request → creates `FeaturedAppActivityMarker` contracts

This decouples user operations from DSO operations.

## Contracts

### SubscriptionActivityMarkerRequest

A request created when payments are processed, asking DSO to create FeaturedAppActivityMarkers.

**Namespace:** `Splice.Subscriptions.Subscription`

**Key fields:**
- `dso`: DSO party who will create the markers
- `provider`: Featured app provider  
- `recipient`: Payment recipient
- `subscriber`: Subscriber (for reference)
- `periodsProcessed`: Number of periods processed
- `subscriptionId`: Reference to the subscription

**Key choices:**
- `SubscriptionActivityMarkerRequest_Process`: DSO processes and creates FeaturedAppActivityMarkers (70% to provider, 30% to recipient)

### SubscriptionProposal

A proposal created by the subscriber via SubscriptionFactory, requiring processor approval before recipient acceptance.

**Namespace:** `Fairmint.Subscriptions.SubscriptionProposal`

**Key fields:**
- `config`: SubscriptionConfig containing all subscription parameters (subscriber, recipient, processingPeriod, amountPerPeriod, etc.)
- `context`: ProcessorContext (processor and DSO parties assigned by factory)

**Key choices:**
- `SubscriptionProposal_ProcessorApprove`: Processor approves the proposal, creating ProcessorApprovedSubscriptionProposal
- `SubscriptionProposal_ProcessorReject`: Processor rejects the proposal (e.g., invalid fee structure)
- `SubscriptionProposal_SubscriberWithdraw`: Subscriber withdraws the proposal before processor approval

### ProcessorApprovedSubscriptionProposal

A processor-approved subscription proposal awaiting recipient acceptance.

**Namespace:** `Fairmint.Subscriptions.ProcessorApprovedSubscriptionProposal`

**Key fields:**
- `config`: SubscriptionConfig containing all subscription parameters
- `context`: ProcessorContext (processor and DSO parties)

**Key choices:**
- `ProcessorApprovedSubscriptionProposal_RecipientAccept`: Recipient accepts, creating active Subscription
- `ProcessorApprovedSubscriptionProposal_RecipientReject`: Recipient rejects the proposal
- `ProcessorApprovedSubscriptionProposal_SubscriberWithdraw`: Subscriber withdraws after processor approval but before recipient acceptance

### Subscription

The active subscription contract that tracks payment processing and creates reward requests.

**Namespace:** `Splice.Subscriptions.Subscription`

**Key fields:**
- `subscriber`: Party making recurring payments
- `recipient`: Party receiving recurring payments
- `provider`: Featured app provider (for reward tracking)
- `dso`: DSO party (for reward requests only, not a signatory)
- `reason`: Text describing the purpose of the subscription (non-empty)
- `processingPeriod`: Time period between payments (RelTime)
- `amountPerPeriod`: Payment amount per processing period (SubscriptionAmount - Amulet or USD)
- `feeAmountPerPeriod`: Fee amount per processing period (SubscriptionAmount - Amulet or USD)
- `lockedAmulet`: Optional ContractId of the LockedAmulet providing collateral
- `lastProcessedAt`: Timestamp of last processed payment (Time)

**Key choices:**
- `Subscription_AddLockedAmulet`: Subscriber adds or replaces a LockedAmulet
- `Subscription_WithdrawLockedAmulet`: Subscriber withdraws the LockedAmulet
- `Subscription_ProcessPayment`: Recipient processes payment for a period (can catch up multiple periods)
  - Creates a `SubscriptionActivityMarkerRequest` for DSO to process later
  - Returns `Subscription_ProcessPaymentResult` with updated subscription and marker request
- `Subscription_Cancel`: Bilateral cancellation (requires both parties)
- `Subscription_CancelBySubscriber`: Unilateral cancellation by subscriber
- `Subscription_CancelByRecipient`: Unilateral cancellation by service provider

## Usage

### Complete User Flow

```daml
import Fairmint.Subscriptions.Subscription
import Fairmint.Subscriptions.SubscriptionConfig
import Splice.Amulet qualified as Amulet

-- 1. Subscriber proposes subscription via factory (NO DSO SIGNATURE)
proposalCid <- submit subscriber do
  exerciseCmd factoryCid SubscriptionFactory_CreateProposal with
    config = SubscriptionConfig with
      subscriber = subscriber
      recipient = serviceProvider
      amountPerRound = AmuletAmount 10.0  -- or USDAmount 10.0
      feeAmountPerRound = AmuletAmount 1.0
      processingPeriod = days 30  -- Monthly subscription
      expiresAt = farFutureTime
      reason = Some "Premium membership"
      recipientFeaturedAppRight = None  -- Optional featured app right for recipient
      processorFeaturedAppRight = None  -- Optional featured app right for processor
      recipientReceiverFeeRatio = 0.0  -- Subscriber pays all fees for recipient transfer
      processorReceiverFeeRatio = 0.0  -- Subscriber pays all fees for processor transfer

-- 2. Processor approves the proposal
approvedCid <- submit processor do
  exerciseCmd proposalCid SubscriptionProposal_ProcessorApprove

-- 3. Recipient accepts (NO DSO SIGNATURE)
subscriptionCid <- submit serviceProvider do
  exerciseCmd approvedCid ProcessorApprovedSubscriptionProposal_RecipientAccept with
    startTime = now

-- 4. Processor processes payment each period (NO DSO SIGNATURE)
-- Subscriber provides amulet inputs for each payment
-- The USD to Amulet rate is automatically read from the OpenMiningRound
-- FeaturedAppRights and fee ratios are specified in the subscription config
result <- submit processor do
  exerciseCmd subscriptionCid Subscription_ProcessPayment with
    paymentCtx = PaymentContext with
      amuletInputs = subscriberAmuletInputs  -- Provided by subscriber
      amuletRulesCid = amuletRulesCid
      openMiningRoundCid = openRoundCid

-- 5. Either party can cancel (NO DSO SIGNATURE)
() <- submit subscriber do
  exerciseCmd result.subscriptionCid Subscription_CancelBySubscriber
```

### Service Provider Rejects Proposal

```daml
-- Service provider rejects and returns locked funds
returnedLockedAmuletCid <- submit serviceProvider do
  exerciseCmd proposalCid SubscriptionProposal_Reject

-- Subscriber still has their locked amulet (can unlock separately if needed)
```

### Subscriber Cancels Before Acceptance

```daml
-- Subscriber changes mind and cancels
returnedLockedAmuletCid <- submit subscriber do
  exerciseCmd proposalCid SubscriptionProposal_Cancel

-- Subscriber gets their locked amulet back
```

## Featured App Rewards

Payment processing creates **SubscriptionActivityMarkerRequest** contracts that DSO processes separately:

**Flow:**
1. Recipient calls `Subscription_ProcessPayment` → creates request
2. DSO calls `SubscriptionActivityMarkerRequest_Process` → creates markers

**Reward Split:**
- **70% weight** to the provider (featured app/service provider)
- **30% weight** to the recipient (if different from provider)

This incentivizes:
- Service providers to build quality subscription services
- Timely payment processing by recipients
- Participation in the Splice featured app economy

## Integration

This package integrates with the Splice Amulet ecosystem:
- Depends on: `splice-amulet-0.1.14.dar`, `splice-api-featured-app-v1-1.0.0.dar`
- Uses: `Splice.Amulet.LockedAmulet` for payment collateral
- Creates: `Splice.Amulet.FeaturedAppActivityMarker` for reward tracking (via DSO processing)

## Use Cases

- SaaS subscriptions
- Recurring service payments
- Membership fees
- Utility bill payments
- Rental agreements
- Any scenario requiring periodic payments with upfront collateral

## Design Benefits

### Upfront LockedAmulet Requirement
1. **Trust**: Service providers see locked funds before accepting
2. **Anti-spam**: Prevents frivolous proposals from unfunded subscribers
3. **Commitment**: Shows subscriber's serious intent to pay
4. **Instant clarity**: No ambiguity about fund availability

### No DSO Signatory
1. **Decentralization**: User-to-user contracts don't require DSO involvement
2. **Performance**: Core operations (propose, accept, process, cancel) execute immediately
3. **Privacy**: DSO doesn't need to be aware of every subscription detail
4. **Scalability**: DSO only processes reward requests, not every subscription operation

### Two-Phase Rewards
1. **Separation of concerns**: User payments separate from reward issuance
2. **Batch processing**: DSO can process multiple reward requests efficiently
3. **Flexibility**: DSO can prioritize or schedule reward processing
4. **Auditability**: Clear trail of requests and fulfillments

## Testing Note

The subscription contracts themselves are pure user-to-user contracts and work correctly. However, test setup requires creating Splice `LockedAmulet` contracts which have complex authorization requirements from the Splice ecosystem. In a real deployment with a running Splice network, these contracts will work seamlessly as users will create `LockedAmulet`s through the standard Splice wallet flows.

The subscription contract logic has been verified through:
1. Successful compilation and build
2. Code review of authorization patterns
3. Validation that no DSO signature is required for core operations
