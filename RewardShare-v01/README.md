# RewardShare-v01

This package provides a simple system for distributing rewards among multiple recipients based on percentage shares.

## Overview

The RewardShare package enables:
- Anyone can create a reward share defining distribution percentages
- Immutable reward shares (no editing after creation)
- Round-based tracking to prevent duplicate distributions
- Integration with Amulet transfers and FeaturedAppRights
- Creator can archive when no longer needed
- Metadata support for extensibility

## Key Components

### Templates

- **RewardShare**: Defines recipient share percentages for reward distribution

### Data Types

- **RewardShareConfig**: Configuration for a single recipient
  - `recipient`: Party receiving the share
  - `sharePercentage`: Percentage (0-100) of total rewards
  - `provider`: Party acting as validator/provider for Amulet transfers
- **DistributionContext**: Amulet payment context for executing distributions
  - Contains amulet inputs, AmuletRules, and OpenMiningRound contracts

## Usage Flow

### Creating a RewardShare

Anyone can create a `RewardShare` by specifying:
- Array of `RewardShareConfig` (at least one entry required)
- Each config defines: recipient party, share percentage (0-100), and provider party
- Total percentages must not exceed 100% (can be less)
- Recipients and providers are automatically set as observers
- Optional description and metadata (key-value pairs)

Example:
```daml
create RewardShare with
  creator = myParty
  configs = 
    [ RewardShareConfig with
        recipient = partner1
        sharePercentage = 10.0
        provider = validator1
    , RewardShareConfig with
        recipient = partner2
        sharePercentage = 2.0
        provider = validator2
    ]
  lastRoundProcessed = 0
  description = Some "Q1 2025 Revenue Share"
  metadata = TM.fromList [("period", "Q1-2025")]
```

### Distributing Rewards

Any party with sufficient amulet inputs can execute distributions using a RewardShare:

1. Call `RewardShare_Distribute` (nonconsuming) with:
   - `distributor`: Party executing the distribution (must provide the amulet inputs)
   - `distributionRound`: Round number for this distribution (must be > `lastRoundProcessed`)
   - `totalRewardAmount`: Total amount in Amulet to distribute among recipients
   - `couponAmount`: AppRewardCoupon amount for audit trail (different unit)
   - `archivedCouponCids`: Text representation of archived coupon contract IDs
   - `distributionCtx`: Contains amulet inputs, rules, and current round contracts
   - `recipientFeaturedAppRights`: Optional FeaturedAppRight per recipient
   - `expectedDso`: Expected DSO party for validation

2. The choice:
   - Validates round progression (must not exceed current OpenMiningRound)
   - Calculates each recipient's share based on their percentage
   - Executes Amulet transfers to all recipients (sorted by party for determinism)
   - Creates a new RewardShare contract with updated `lastRoundProcessed`
   - Returns transfer results and the new contract ID

3. **Important**: Because this choice is **nonconsuming**, both the original contract and the newly created contract exist on the ledger. **You must use the returned contract ID** for subsequent distributions, as it has the updated `lastRoundProcessed`. The old contract remains but will fail round validation if reused.

### Archiving a RewardShare

The creator can archive a RewardShare when it's no longer needed:

```daml
exercise rewardShareCid RewardShare_Archive with
  reason = Some "End of revenue share agreement"
```

## Round Tracking

Each distribution creates a new contract with updated `lastRoundProcessed` and validates:
- Round number must be greater than `lastRoundProcessed` (can skip rounds)
- Distribution round cannot exceed the current OpenMiningRound number
- Prevents duplicate distributions for the same round by requiring the new contract ID

## Share Percentage Flexibility

Share percentages can total any amount from 0% to 100%:
- **Less than 100%**: Useful when the creator wants to retain the remainder (e.g., 10% to partner, 2% to affiliate, 88% kept by creator)
- **Exactly 100%**: Full distribution among recipients
- Zero or negative share amounts are automatically skipped during distribution

## Architecture

This design is intentionally simple:

- **Anyone can create**: No approvals needed to define a reward share
- **Immutable configuration**: Once created, the share percentages cannot be edited (create new ones instead)
- **Nonconsuming distribution**: Creates new contract versions for round tracking while allowing parallel reads
- **Creator control**: Only creator can archive
- **Deterministic ordering**: Recipients are sorted by party ID for consistent execution
- **Partial shares**: Total percentages can be less than 100% (remainder retained by distributor)
- **Metadata support**: Extensible key-value storage for custom use cases
- **Observer pattern**: Recipients and providers automatically observe the reward share

Perfect for:
- Revenue sharing arrangements (e.g., 10% to partner, 2% to affiliate, 88% retained)
- Subscription reward distribution
- Any scenario where multiple parties receive percentage-based rewards

