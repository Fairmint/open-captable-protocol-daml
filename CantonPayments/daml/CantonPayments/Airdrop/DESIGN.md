# Airdrop Design: Maximum Simplicity, Minimum Network Impact

## Core Principle

**Do one thing well: Bulk token distribution with rewards**

## Simplifications from Initial Design

### What We Started With
- AirdropFactory (proposal pattern)
- AirdropProposal (approval workflow)  
- ActiveAirdrop (execution)
- AirdropResult (return value)
- AirdropContext (wrapper for single field)
- Processor role with approval
- Complex state tracking

### What We Have Now
- **1 template**: `Airdrop`
- **3 choices**: `Join`, `Execute`, `Cancel`
- **0 return values**: Everything returns `()`
- **No processor**: Sender manages everything
- **No wrappers**: Direct parameters

## Design Rationale

### 1. Single Template

**Why:** Minimal contract overhead

```daml
template Airdrop where
  -- Everything in one place
  -- Invitees are observers
  -- Joined parties are signatories
```

**Benefits:**
- Lower deployment cost
- Simpler queries
- No state transitions between templates
- Clear ownership model

### 2. Return `()` from All Choices

**Why:** Minimize network impact

```daml
choice Airdrop_Execute : ()  -- Not AirdropResult
choice Airdrop_Join : ()     -- Not ContractId Airdrop
choice Airdrop_Cancel : ()
```

**Benefits:**
- Minimal response payload
- Lower bandwidth
- Faster execution
- Clients can query if needed

**Trade-off:** Clients must query ledger for results instead of getting them directly

### 3. No Processor Role

**Why:** Unnecessary intermediary

**Before:**
```daml
processor : Party
choice Airdrop_UpdateContext : () -- processor controls
```

**After:**
```daml
-- Sender manages amuletRulesCid and featuredAppRight at creation
-- No processor field needed
```

**Benefits:**
- Fewer parties involved
- No approval bottleneck
- Sender has full control
- Simpler authorization

### 4. No Wrapper Types

**Why:** One-field wrappers add no value

**Before:**
```daml
data AirdropContext = AirdropContext with
  openMiningRoundCid : ContractId OpenMiningRound
```

**After:**
```daml
choice Airdrop_Execute : () with
  openMiningRoundCid : ContractId OpenMiningRound  -- direct param
```

**Benefits:**
- Less code
- Clearer signatures
- No unnecessary deriving instances

### 5. Observer-to-Signatory Pattern

**Why:** Visibility then commitment

```daml
invitees : [Party]        -- observers
joinedParties : [Party]   -- signatories

signatory sender :: joinedParties
observer invitees  -- (plus others)
```

**Flow:**
1. Invitee sees airdrop (observer)
2. Invitee joins → becomes signatory
3. Sender executes regardless

**Benefits:**
- Invitees aware before committing
- Optional signatory upgrade
- No blocking on acceptance
- Transparent process

### 6. Archive-and-Recreate for State Changes

**Why:** Clean consuming choice pattern with `()` return

```daml
choice Airdrop_Join : () with
  joiningParty : Party
controller joiningParty
do
  archive self
  create this with joinedParties = newJoinedParties
  pure ()
```

**Benefits:**
- Clean state transition
- No dangling contract IDs
- Returns `()` (minimal overhead)
- Standard DAML pattern

## Efficiency Analysis

### Network Traffic

| Operation | Data Returned | Size |
|-----------|--------------|------|
| Join | `()` | Minimal |
| Execute | `()` | Minimal |
| Cancel | `()` | Minimal |

**Total overhead:** Near zero

### Transaction Costs

For N invitees:

**Individual transfers:**
```
Cost = N × (transfer_cost + fees)
```

**Bulk airdrop:**
```
Cost = 1 × (transfer_cost_for_N_outputs + fees)
```

**Savings:** ~95% for large N

### State Overhead

| Aspect | Count |
|--------|-------|
| Templates | 1 |
| Persistent State After Execution | 0 |
| Return Values Tracked | 0 |

**Memory footprint:** Minimal

## Code Metrics

```
Lines of Code:
- Airdrop.daml:    ~100 lines
- Test file:       ~280 lines
- Total:           ~380 lines

Complexity:
- Templates:       1
- Choices:         3
- Data types:      0
- External deps:   Standard Splice modules
```

## Comparison: Before vs After

| Metric | Complex Design | Simple Design |
|--------|----------------|---------------|
| Templates | 3 | 1 |
| Data Types | 3 | 0 |
| Choices | 7 | 3 |
| Return Types | 3 | 1 (`()`) |
| Roles | 4 (sender, processor, recipient, provider) | 3 (sender, provider, dso) |
| Network Overhead | High | Minimal |
| Lines of Code | ~350 | ~100 |

**Reduction:** ~70% less code, ~90% less network overhead

## What We Gave Up

### No Processor Approval
- **Trade-off:** Less control/validation
- **Mitigation:** Sender is responsible party anyway

### No Complex Return Values
- **Trade-off:** Must query for results
- **Mitigation:** Query API is efficient

### No Proposal Pattern
- **Trade-off:** No formal approval workflow  
- **Mitigation:** Observer pattern provides transparency

### No Stats Tracking
- **Trade-off:** Can't track distribution metrics on-chain
- **Mitigation:** Off-chain analytics can query events

## When To Use This Design

**Good For:**
- High-volume airdrops (100s-1000s recipients)
- Regular bulk distributions
- Cost-sensitive operations
- Simple sender-controlled flows

**Not Good For:**
- Complex approval workflows
- Multi-stage distributions
- Requiring on-chain audit trails
- Processor-mediated operations

## Key Takeaways

1. **Simplicity is a feature** - Fewer moving parts = fewer issues
2. **Network efficiency matters** - `()` return values save real costs
3. **DAML patterns work** - Archive-and-recreate is clean and effective
4. **One template can do a lot** - No need for factory/proposal/active split
5. **Sender control is fine** - For airdrops, sender is the responsible party

## Future Considerations

If requirements change:

**Add Back Only What's Needed:**
- Processor → if compliance requires approval
- Return values → if async clients can't query
- Proposal pattern → if formal workflow required
- Stats → if on-chain metrics critical

**Keep:**
- Single template (unless truly necessary)
- Minimal return types
- Direct parameters (no unnecessary wrappers)
- Clean choice signatures

**Principle:** Complexity must justify its cost
