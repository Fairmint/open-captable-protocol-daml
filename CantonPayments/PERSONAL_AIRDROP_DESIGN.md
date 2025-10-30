# Personal Airdrop System

## Overview

This is a new airdrop contract design that uses a factory pattern with individual contracts per recipient. This approach avoids the complexity of TransferPreapproval contracts while maintaining dual-signatory benefits for featured app rewards.

## Architecture

### 1. AirdropFactory (Factory Contract)
- **File**: `daml/CantonPayments/Airdrop/AirdropFactory.daml`
- **Purpose**: Factory contract that allows recipients to join and create their own PersonalAirdrop contracts
- **Signatory**: `sender` (featured app party)
- **Observer**: `dso`

**Key Features**:
- One factory contract per sender/campaign
- Recipients call `Factory_JoinAirdrop` to create their individual PersonalAirdrop contract
- Validates expiration before allowing joins
- Sender can archive the factory with `Factory_Archive`

**Fields**:
```daml
dso         : Party    -- DSO party
sender      : Party    -- Featured app party (airdrop creator)
provider    : Party    -- Featured app provider party
description : Text     -- Campaign description
expiresAt   : Time     -- Factory expiration time
```

### 2. PersonalAirdrop (Individual Recipient Contract)
- **File**: `daml/CantonPayments/Airdrop/PersonalAirdrop.daml`
- **Purpose**: Personal airdrop contract for a single recipient with dual-signatory design
- **Signatories**: `sender` (featured app) AND `recipient`
- **Observer**: `dso`

**Key Features**:
- One contract per recipient
- Both parties are signatories - enables featured app rewards on transfers
- Sender executes transfers via `PersonalAirdrop_ExecuteTransfer`
- Either party can archive with `PersonalAirdrop_Archive`

**Fields**:
```daml
dso         : Party    -- DSO party
sender      : Party    -- Featured app party (executes transfers)
recipient   : Party    -- Recipient party
provider    : Party    -- Featured app provider party
description : Text     -- Campaign description
expiresAt   : Time     -- Contract expiration time
```

## Workflow

### Phase 1: Factory Creation
```typescript
// Sender creates factory (one per campaign)
const factory = await createAirdropFactory({
  dso,
  sender: featuredAppParty,
  provider: featuredAppParty,
  description: "Q4 2025 Airdrop Campaign",
  expiresAt: oneYearFromNow
});
```

### Phase 2: Recipients Join
```typescript
// Each recipient joins to create their PersonalAirdrop contract
const personalAirdrop = await exerciseChoice(
  factoryContractId,
  'Factory_JoinAirdrop',
  { recipient: recipientParty }
);
```

### Phase 3: Execute Transfers
```typescript
// Sender executes transfers using individual PersonalAirdrop contracts
const result = await exerciseChoice(
  personalAirdropContractId,
  'PersonalAirdrop_ExecuteTransfer',
  {
    amuletRulesCid,
    openMiningRoundCid,
    amuletInputs,
    amount: 10.0,  // Amount per transfer
    featuredAppRight,  // Optional: for featured app rewards
    appRewardBeneficiaries: []  // Additional beneficiaries
  }
);
```

## Benefits

### ✅ Compared to SimpleAirdrop (with PreApproval)
- **No PreApproval complexity**: No need to manage TransferPreapproval contracts
- **No provider matching**: No risk of provider mismatches
- **Simpler setup**: Recipients just need to join, no pre-approval creation needed

### ✅ Compared to Original Airdrop
- **One contract per recipient**: More granular control and visibility
- **Explicit opt-in**: Recipients must join (good for compliance)
- **Independent expiration**: Each recipient's contract has its own lifecycle
- **Better tracking**: Easy to see which recipients have joined vs. not joined

### ✅ Featured App Rewards
- **Dual-signatory design**: Both sender and recipient are signatories
- **Provider control**: Sender sets the provider party explicitly
- **Reward distribution**: Can split rewards among multiple beneficiaries

## Comparison Matrix

| Feature | Original Airdrop | SimpleAirdrop | PersonalAirdrop (New) |
|---------|------------------|---------------|----------------------|
| Contracts per campaign | 1 | 1 | 1 factory + N personal |
| Recipient opt-in | No | Via PreApproval | Via Factory join |
| Dual-signatory | Yes | No | Yes |
| Featured app rewards | Yes | Yes | Yes |
| PreApproval complexity | No | Yes (high) | No |
| Per-recipient control | No | No | Yes |
| Compliance friendly | Medium | Medium | High (explicit opt-in) |

## Implementation Status

✅ **DAML Contracts**: Compiled successfully
- `AirdropFactory.daml`
- `PersonalAirdrop.daml`

⏳ **TypeScript SDK**: Not yet generated
⏳ **Execution Scripts**: Not yet created

## Next Steps

1. **Generate TypeScript bindings** for the new contracts
2. **Create factory creation script** (`createAirdropFactory.ts`)
3. **Create join script** for recipients (`joinAirdrop.ts`)
4. **Create execution script** (`executePersonalAirdrop.ts`)
5. **Add to ocp-canton-sdk** for easy access
6. **Test on devnet** with a small group
7. **Deploy to mainnet** after validation

## Usage Example (Planned)

```bash
# Step 1: Sender creates factory
npm run airdrop:create-factory -- \
  --network mainnet \
  --description "Q4 2025 Airdrop" \
  --expiration "2026-12-31"

# Step 2: Recipients join (each recipient runs this)
npm run airdrop:join -- \
  --network mainnet \
  --factory-contract-id "00abc..."

# Step 3: Sender executes transfers
npm run airdrop:execute-personal -- \
  --network mainnet \
  --recipients "recipient1:10,recipient2:5" \
  --amount-per-transfer 1.0
```

## Notes

- The factory pattern allows for campaign-level management
- Recipients have explicit control (must join to participate)
- Featured app rewards work seamlessly with dual-signatory design
- No PreApproval contract complexity
- Better for compliance and auditability (explicit opt-in)

