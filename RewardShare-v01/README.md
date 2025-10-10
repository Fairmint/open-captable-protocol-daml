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

- **RewardShareConfig**: Configuration for a single recipient (percentage, recipient, provider, description, metadata)
- **DistributionContext**: Amulet payment context for executing distributions

## Usage Flow

### Creating a RewardShare

Anyone can create a `RewardShare` by specifying:
- Array of `RewardShareConfig` (e.g., 10% to party1, 2% to party2)
- List of observers (parties who can view the reward share)
- Optional description
- Metadata (key-value pairs for extensibility)

Example:
```daml
create RewardShare with
  creator = myParty
  configs = 
    [ RewardShareConfig with
        recipient = partner1
        sharePercentage = 10.0
        provider = validator1
        description = Some "Partner revenue share"
        metadata = TM.empty
    , RewardShareConfig with
        recipient = partner2
        sharePercentage = 2.0
        provider = validator2
        description = Some "Affiliate commission"
        metadata = TM.empty
    ]
  observers = [auditor]
  currentRound = 0
  description = Some "Q1 2025 Revenue Share"
  metadata = TM.fromList [("period", "Q1-2025")]
```

### Distributing Rewards

Any party can execute distributions using a RewardShare:

1. Call `RewardShare_Distribute` (nonconsuming) with:
   - Distributor party identity
   - Total reward amount to distribute
   - Distribution round number (must be `currentRound + 1`)
   - Expected DSO party
   - AppRewardCoupon metadata (for audit trail)
   - Amulet inputs for funding the distribution
   - Optional FeaturedAppRights per recipient

2. The choice:
   - Validates round progression
   - Calculates each recipient's share based on their percentage
   - Executes Amulet transfers to all recipients
   - Creates a new RewardShare contract with updated round
   - Returns transfer results and the new contract ID

3. Because the choice is **nonconsuming**, the original reward share remains active, but a new version is created with the incremented round number for future distributions.

### Archiving a RewardShare

The creator can archive a RewardShare when it's no longer needed:

```daml
exercise rewardShareCid RewardShare_Archive with
  reason = Some "End of revenue share agreement"
```

## Round Tracking

Each distribution increments the reward share's round counter and validates:
- Round number increases monotonically (must be `currentRound + 1`)
- Distribution doesn't exceed the current OpenMiningRound number
- Prevents duplicate distributions for the same round

## Architecture

This design is intentionally simple:

- **Anyone can create**: No approvals needed to define a reward share
- **Immutable**: Once created, shares cannot be edited (create new ones instead)
- **Nonconsuming distribution**: The reward share stays active, new versions track rounds
- **Creator control**: Only creator can archive
- **Metadata support**: Extensible key-value storage for custom use cases
- **Observer pattern**: External parties can view reward shares as needed

Perfect for:
- Revenue sharing arrangements (e.g., 10% to partner, 2% to affiliate)
- Subscription reward distribution
- Any scenario where multiple parties receive percentage-based rewards

