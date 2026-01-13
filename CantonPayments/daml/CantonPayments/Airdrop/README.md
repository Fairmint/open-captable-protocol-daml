# Airdrop Contract

Ultra-simple bulk transfer contract with rewards for distributing tokens to multiple recipients.

## Design Philosophy

**Maximize Simplicity, Minimize Network Impact**

- Single template design
- No return values from choices (all return `()`)
- No processor approval required
- Invitees are observers who can join to become signatories
- Sender controls everything

## Contract Structure

### Airdrop Template

**Fields:**

- `sender` - Party creating and executing the airdrop
- `provider` - Validator provider for transfers
- `dso` - DSO party
- `invitees` - List of parties invited to receive tokens (observers)
- `joinedParties` - List of invitees who have joined (signatories)
- `appRewardBeneficiaries` - Featured app reward beneficiaries
- `amuletRulesCid` - Amulet rules contract for transfers
- `featuredAppRight` - Optional featured app right
- `description` - Optional description
- `observers` - Additional observer parties

**Signatories:** `sender :: joinedParties`  
**Observers:** `provider`, `dso`, `invitees`, `appRewardBeneficiaries`, custom observers

### Choices

#### Airdrop_Join

Allows an invitee to join the airdrop (becomes a signatory).

**Controller:** Invitee  
**Returns:** `()`  
**Validations:**

- Party must be in invitees list
- Party cannot join twice (de-duplication check)

**Example:**

```daml
exercise airdropCid Airdrop_Join with
  joiningParty = bob
```

#### Airdrop_Execute

Sender executes the bulk transfer to all invitees.

**Controller:** Sender  
**Returns:** `()`  
**Parameters:**

- `amuletInputs` - List of amulet contracts to spend
- `amounts` - List of amounts (must match invitees length)
- `openMiningRoundCid` - Current open mining round
- `activityMarkerFeaturedAppRightCid` - Optional FAR for activity marker

**Validations:**

- At least one amulet input
- Amounts length matches invitees length
- All amounts are positive
- App reward beneficiaries are valid

**Example:**

```daml
exercise airdropCid Airdrop_Execute with
  amuletInputs = [amulet1, amulet2]
  amounts = [100.0, 50.0, 75.0]
  openMiningRoundCid = roundCid
  activityMarkerFeaturedAppRightCid = Some farCid
```

#### Airdrop_Cancel

Sender cancels the airdrop.

**Controller:** Sender  
**Returns:** `()`

## Usage Flow

```daml
-- 1. Anyone creates an airdrop (typically sender)
airdropCid <- submit alice do
  createCmd Airdrop with
    sender = alice
    provider = validator
    dso = dsoParty
    invitees = [bob, charlie, david]
    joinedParties = []
    appRewardBeneficiaries = [AppRewardBeneficiary alice 1.0]
    amuletRulesCid = rulesCid
    featuredAppRight = Some farCid
    description = Some "Q4 Rewards"
    observers = []

-- 2. Invitees can join (optional, but makes them signatories)
submit bob do
  exerciseCmd airdropCid Airdrop_Join with joiningParty = bob

submit charlie do
  exerciseCmd airdropCid Airdrop_Join with joiningParty = charlie

-- 3. Sender executes with their amulets
submitMulti [alice] [dso] do
  exerciseCmd airdropCid Airdrop_Execute with
    amuletInputs = [amulet1Cid, amulet2Cid]
    amounts = [100.0, 50.0, 75.0]  -- One per invitee
    openMiningRoundCid = currentRoundCid
    activityMarkerFeaturedAppRightCid = Some farCid
```

## Key Features

### 1. Minimal Network Impact

- **No return values**: All choices return `()` to minimize data transfer
- **Archive-and-recreate**: Join choice archives self and recreates with updated state
- **Single execution**: All transfers happen in one bulk transaction

### 2. Observer-to-Signatory Pattern

- Invitees start as observers (can see the airdrop)
- Can join to become signatories (more commitment)
- Sender can execute regardless of who has joined

### 3. Bulk Efficiency

For N recipients:

- **1 transaction** vs N individual transactions
- **~95% gas savings** compared to individual transfers
- **Atomic execution** - all or nothing

### 4. App Rewards Integration

- Full support for featured app rewards
- Activity markers created on execution
- Standard Splice reward mechanism

## Validation Rules

**At Creation:**

- Must have at least one invitee
- Sender cannot be an invitee

**At Join:**

- Party must be in invitees list
- Cannot join twice (fails if no change to joinedParties)

**At Execution:**

- At least one amulet input required
- Amounts array must match invitees length
- All amounts must be positive
- App reward beneficiaries must be valid

## Comparison to PaymentStream

| Aspect         | PaymentStream         | Airdrop                    |
| -------------- | --------------------- | -------------------------- |
| Purpose        | Recurring payments    | One-time bulk distribution |
| Complexity     | High                  | Minimal                    |
| Templates      | 6+                    | 1                          |
| Locked Funds   | Required              | Not required               |
| Processor      | Required approval     | Not needed                 |
| Recipients     | Single                | Multiple                   |
| Network Impact | Moderate              | Minimal                    |
| Return Values  | Contract IDs, Results | None (`()`)                |

## Design Decisions

### Why No Processor?

Simplicity. Sender controls their own funds and can manage `amuletRulesCid` and `featuredAppRight`
at creation.

### Why Return `()`?

Minimizes network overhead. Clients can query the ledger if they need to see results.

### Why Archive-and-Recreate for Join?

Consuming choices that return `()` provide clean state transitions without additional network
overhead.

### Why Separate Amounts Parameter?

Flexibility. Invitees list is just parties. Amounts can be decided at execution time based on
current logic/prices.

## Example Use Cases

1. **Token Airdrops**: Distribute tokens to community members
2. **Reward Distribution**: Quarterly rewards to contributors
3. **Refunds**: Bulk refunds to multiple users
4. **Incentive Payments**: Pay multiple recipients for campaign participation
5. **Revenue Sharing**: Distribute profits to stakeholders

## Future Enhancements

Possible (if needed):

- Scheduled execution time
- Batch size limits for very large distributions
- Vesting schedules
- Conditional claims
- Multi-asset support

**Current design deliberately avoids these to maintain simplicity.**
