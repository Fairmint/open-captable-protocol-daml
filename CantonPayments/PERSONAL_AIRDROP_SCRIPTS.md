# PersonalAirdrop Scripts Documentation

This document describes the three TypeScript scripts created for managing the PersonalAirdrop system.

## Overview

The PersonalAirdrop system uses a factory pattern where:
1. **Sender** creates an `AirdropFactory` contract with shared configuration
2. **Recipients** join the factory to create their own `PersonalAirdrop` contracts
3. **Sender** executes transfers using the `PersonalAirdrop` contracts

Each `PersonalAirdrop` contract is dual-signatory (sender + recipient), enabling featured app rewards.

## Scripts

### 1. Create Airdrop Factory (`createAirdropFactory.ts`)

**Purpose**: Create an `AirdropFactory` contract that recipients can join.

**Location**: `canton/scripts/src/scripts/app/airdrop/createAirdropFactory.ts`

**Usage**:
```bash
# Create with sender getting 100% of app rewards
npm run airdrop:create-factory -- \
  --network devnet \
  --provider intellect

# Create with custom beneficiaries (weights must sum to 1.0)
npm run airdrop:create-factory -- \
  --network mainnet \
  --provider intellect \
  --beneficiaries "party1::1220...:0.7,party2::1220...:0.3"
```

**Options**:
- `--network` (required): `mainnet` or `devnet`
- `--provider` (required): `intellect` or `5n`
- `--beneficiaries` (optional): Comma-separated list of `partyId:weight` pairs
  - Weights must sum to exactly 1.0
  - Default: sender gets 100% (weight 1.0)

**Output**: Factory contract ID for use in next step

**Features**:
- Automatically fetches DSO party, amulet rules, and featured app right
- Validates beneficiary weights sum to 1.0
- Uses sender's party ID from environment
- Creates explorer link for contract

---

### 2. Join Airdrop Factory (`joinAirdropFactory.ts`)

**Purpose**: Allow recipients to join a factory and create their own `PersonalAirdrop` contract.

**Location**: `canton/scripts/src/scripts/app/airdrop/joinAirdropFactory.ts`

**Usage**:
```bash
# Join with specific factory contract ID
npm run airdrop:join-factory -- \
  --network devnet \
  --provider 5n \
  --recipient-party "recipient::1220..." \
  --factory-cid "00123abc..."

# Auto-discover factory (searches intellect for sender's factory)
npm run airdrop:join-factory -- \
  --network mainnet \
  --provider 5n \
  --recipient-party "recipient::1220..."
```

**Options**:
- `--network` (required): `mainnet` or `devnet`
- `--provider` (required): `intellect` or `5n` - Provider where the recipient party exists
- `--recipient-party` (required): Recipient party ID that will join the factory
- `--factory-cid` (optional): Specific factory contract ID to join

**Output**: `PersonalAirdrop` contract ID

**Features**:
- Automatically gets sender party from **intellect** client environment
- Searches for factory on **intellect** (where sender created it)
- Executes join on **recipient's provider** (usually 5n)
- Automatically discloses factory contract for cross-provider operation
- Exercises `Factory_JoinAirdrop` choice
- Creates dual-signatory contract (sender + recipient)
- Validates recipient is not the sender

---

### 3. Execute Personal Airdrop (`executePersonalAirdrop.ts`)

**Purpose**: Execute transfers for multiple recipients using their `PersonalAirdrop` contracts.

**Location**: `canton/scripts/src/scripts/app/airdrop/executePersonalAirdrop.ts`

**Usage**:
```bash
# Execute transfers for multiple recipients once
npm run airdrop:execute-personal -- \
  --recipients "party1::1220...:5,party2::1220...:3" \
  --amount-per-transfer 0.5 \
  --network mainnet \
  --provider intellect

# Execute indefinitely every 10 minutes
npm run airdrop:execute-personal -- \
  --recipients "party1::1220...:1,party2::1220...:2" \
  --amount-per-transfer 0.5 \
  --network devnet \
  --provider intellect \
  --execution-interval 600
```

**Options**:
- `--network` (required): `mainnet` or `devnet`
- `--provider` (required): `intellect` or `5n`
- `--recipients` (required): Comma-separated `partyId:transferCount` pairs
  - Each recipient will receive the specified number of transfers
- `--amount-per-transfer` (required): Amount in CC per transfer
- `--executions` (optional): Number of execution runs (default: unlimited)
- `--execution-interval` (optional): Seconds between execution runs (default: 600)

**Output**: Transaction results with update IDs and success counts

**Features**:
- Automatically queries for `PersonalAirdrop` contracts by recipient
- Fetches current mining round before each execution
- Queries and uses top 100 largest amulets
- Supports multiple transfers per recipient in a single transaction
- Sends Slack notifications on success/failure
- Can run indefinitely with interval
- Graceful error handling per recipient

---

## Complete Workflow Example

### Step 1: Sender Creates Factory

```bash
cd canton/scripts

# Create factory (sender gets 100% of rewards)
npm run airdrop:create-factory -- \
  --network devnet \
  --provider intellect

# Output: Factory Contract ID: 0012abc...
```

### Step 2: Recipients Join Factory

**Recipient 1:**
```bash
npm run airdrop:join-factory -- \
  --network devnet \
  --provider 5n \
  --recipient-party "recipient1::1220..." \
  --factory-cid "0012abc..."

# Output: PersonalAirdrop Contract ID: 0034def...
```

**Recipient 2:**
```bash
npm run airdrop:join-factory -- \
  --network devnet \
  --provider 5n \
  --recipient-party "recipient2::1220..." \
  --factory-cid "0012abc..."

# Output: PersonalAirdrop Contract ID: 0056ghi...
```

### Step 3: Sender Executes Transfers

```bash
npm run airdrop:execute-personal -- \
  --recipients "recipient1::1220...:5,recipient2::1220...:3" \
  --amount-per-transfer 1.0 \
  --network devnet \
  --provider intellect \
  --executions 1

# Output:
# ✅ Successful: 2/2 recipients
# 📊 Total transfers: 8 (5 + 3)
# 💰 Total amount: 8.00 CC
```

---

## Helper Functions (airdropUtils.ts)

### `findAirdropFactoryContract()`

Finds the oldest active `AirdropFactory` contract for a sender.

```typescript
const factoryId = await findAirdropFactoryContract(ocpClient, senderPartyId);
```

### `findPersonalAirdropContract()`

Finds a `PersonalAirdrop` contract for a specific sender-recipient pair.

```typescript
const personalAirdropId = await findPersonalAirdropContract(
  ocpClient,
  senderPartyId,
  recipientPartyId
);
```

---

## Key Differences from SimpleAirdrop

| Feature | SimpleAirdrop | PersonalAirdrop |
|---------|---------------|-----------------|
| **Pre-approval** | Required `TransferPreapproval` contracts | No pre-approval needed |
| **Signatories** | Single signatory (sender) | Dual signatory (sender + recipient) |
| **Recipient onboarding** | Automatic | Recipients must join factory |
| **Featured app rewards** | Via provider field | Native via dual signatories |
| **Contract per recipient** | No | Yes |
| **Multiple transfers** | Multiple choice calls | Single choice with `numberOfTransfers` |

---

## Environment Setup

Ensure you have the following environment variables set:

**For Sender (creating factory and executing transfers):**
```env
# Intellect provider
DEVNET_INTELLECT_ADMIN_API_URL=...
DEVNET_INTELLECT_VALIDATOR_URL=...
DEVNET_INTELLECT_PARTICIPANT_ADMIN_URL=...
DEVNET_INTELLECT_JWT_TOKEN=...
```

**For Recipients (joining factory):**
```env
# 5n provider
DEVNET_5N_ADMIN_API_URL=...
DEVNET_5N_VALIDATOR_URL=...
DEVNET_5N_PARTICIPANT_ADMIN_URL=...
DEVNET_5N_JWT_TOKEN=...
```

---

## Troubleshooting

### "No AirdropFactory contracts found"
- Ensure you've created a factory using `airdrop:create-factory`
- Check you're using the correct network and provider
- Verify the sender has shared the factory with recipients

### "No PersonalAirdrop contract found"
- Ensure recipients have joined using `airdrop:join-factory`
- Verify you're querying with the correct party IDs
- Check network and provider match where contracts were created

### "Beneficiary weights must sum to 1.0"
- When creating factory, ensure all beneficiary weights sum to exactly 1.0
- Use decimals like `0.7,0.3` not `70,30`

### "No amulets available"
- Sender needs sufficient CC balance
- Check amulets aren't locked in other transactions
- Verify you're querying the correct party ID

---

## NPM Scripts Added

```json
{
  "airdrop:create-factory": "ts-node src/scripts/app/airdrop/createAirdropFactory.ts",
  "airdrop:join-factory": "ts-node src/scripts/app/airdrop/joinAirdropFactory.ts",
  "airdrop:execute-personal": "ts-node src/scripts/app/airdrop/executePersonalAirdrop.ts"
}
```

---

## Next Steps

1. **Generate DAML Bindings**: Update the OCP Canton SDK to include bindings for `AirdropFactory` and `PersonalAirdrop`
2. **Testing**: Test the complete workflow on devnet
3. **Monitoring**: Set up Slack notifications for production usage
4. **Documentation**: Update main README with PersonalAirdrop workflow

---

## Related Files

- **DAML Contracts**:
  - `CantonPayments/daml/CantonPayments/Airdrop/AirdropFactory.daml`
  - `CantonPayments/daml/CantonPayments/Airdrop/PersonalAirdrop.daml`

- **TypeScript Scripts**:
  - `canton/scripts/src/scripts/app/airdrop/createAirdropFactory.ts`
  - `canton/scripts/src/scripts/app/airdrop/joinAirdropFactory.ts`
  - `canton/scripts/src/scripts/app/airdrop/executePersonalAirdrop.ts`

- **Utilities**:
  - `canton/scripts/src/scripts/app/airdrop/airdropUtils.ts`

- **Design Documentation**:
  - `CantonPayments/PERSONAL_AIRDROP_DESIGN.md`
