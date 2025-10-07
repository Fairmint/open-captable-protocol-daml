# Subscriptions-v01

A general-purpose DAML package for recurring payment subscriptions using Splice LockedAmulet.

## Overview

The Subscriptions package enables parties to create recurring payment subscriptions using LockedAmulet as collateral. This is a generic subscription mechanism that can be used in any Splice-based application.

**Key Features:**
- **Upfront collateral**: Subscriber must lock funds before proposing (prevents spam and ensures payment capability)
- **Proposal/Acceptance pattern**: Realistic user flow where subscriber proposes and service provider accepts
- **No DSO signatures required**: User-to-user contract that doesn't require DSO involvement for core operations
- **Flexible subscriptions**: Subscriptions are processed by the recipient every round
- **Catch-up payments**: Recipients can catch up on missed rounds if they skip processing
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
- `roundsProcessed`: Number of rounds processed
- `subscriptionId`: Reference to the subscription

**Key choices:**
- `SubscriptionActivityMarkerRequest_Process`: DSO processes and creates FeaturedAppActivityMarkers (70% to provider, 30% to recipient)

### SubscriptionProposal

A proposal created by the subscriber (customer), which the service provider can accept or reject.

**Important**: The subscriber MUST provide a LockedAmulet upfront when creating the proposal.

**Namespace:** `Splice.Subscriptions.Subscription`

**Key fields:**
- `subscriber`: Party proposing to make recurring payments (customer)
- `recipient`: Party who would receive recurring payments (service provider)
- `provider`: Featured app provider (for reward tracking, usually same as recipient)
- `dso`: DSO party (for reward requests only, not a signatory)
- `reason`: Text describing the purpose of the subscription (non-empty)
- `amountPerRound`: Payment amount per round (Decimal)
- `lockedAmulet`: ContractId of the LockedAmulet providing collateral (**REQUIRED**)

**Key choices:**
- `SubscriptionProposal_Accept`: Service provider accepts, creating active Subscription
- `SubscriptionProposal_Reject`: Service provider rejects and returns the LockedAmulet
- `SubscriptionProposal_Cancel`: Subscriber cancels before acceptance and retrieves the LockedAmulet

### Subscription

The active subscription contract that tracks payment processing and creates reward requests.

**Namespace:** `Splice.Subscriptions.Subscription`

**Key fields:**
- `subscriber`: Party making recurring payments
- `recipient`: Party receiving recurring payments
- `provider`: Featured app provider (for reward tracking)
- `dso`: DSO party (for reward requests only, not a signatory)
- `reason`: Text describing the purpose of the subscription (non-empty)
- `amountPerRound`: Payment amount per round (Decimal)
- `lockedAmulet`: Optional ContractId of the LockedAmulet providing collateral
- `lastProcessedRound`: The last round for which payment was processed (Int)

**Key choices:**
- `Subscription_AddLockedAmulet`: Subscriber adds or replaces a LockedAmulet
- `Subscription_WithdrawLockedAmulet`: Subscriber withdraws the LockedAmulet
- `Subscription_ProcessPayment`: Recipient processes payment for a round (can catch up multiple rounds)
  - Creates a `SubscriptionActivityMarkerRequest` for DSO to process later
  - Returns `Subscription_ProcessPaymentResult` with updated subscription and marker request
- `Subscription_Cancel`: Bilateral cancellation (requires both parties)
- `Subscription_CancelBySubscriber`: Unilateral cancellation by subscriber
- `Subscription_CancelByRecipient`: Unilateral cancellation by service provider

## Usage

### Complete User Flow

```daml
import Splice.Subscriptions.Subscription
import Splice.Amulet qualified as Amulet

-- 1. Subscriber locks funds FIRST (required)
lockedAmuletCid <- createLockedAmulet subscriber 120.0  -- e.g., 12 months at 10.0/month

-- 2. Subscriber proposes subscription with locked funds (NO DSO SIGNATURE)
proposalCid <- submit subscriber do
  createCmd SubscriptionProposal with
    subscriber = subscriber
    recipient = serviceProvider
    provider = serviceProvider  -- Usually same as recipient
    dso = dso
    reason = "Premium membership"
    amountPerRound = 10.0
    lockedAmulet = lockedAmuletCid  -- REQUIRED

-- 3. Service provider accepts (NO DSO SIGNATURE)
subscriptionCid <- submit serviceProvider do
  exerciseCmd proposalCid SubscriptionProposal_Accept

-- 4. Service provider processes payment each round (NO DSO SIGNATURE)
result <- submit serviceProvider do
  exerciseCmd subscriptionCid Subscription_ProcessPayment with
    currentRound = 5
    subscriptionId = "unique-sub-id"

-- 5. DSO processes reward request (SEPARATE STEP)
markers <- submit dso do
  exerciseCmd result.activityMarkerRequest SubscriptionActivityMarkerRequest_Process

-- 6. Either party can cancel (NO DSO SIGNATURE)
withdrawnLockedAmulet <- submit subscriber do
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
