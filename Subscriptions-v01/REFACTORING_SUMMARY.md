# Subscription Creation Refactoring Summary

## Date
October 11, 2025

## Overview
Refactored the subscription creation flow from a verbose 5-template pattern to a single unified `ProposedSubscription` template with intelligent approval tracking and edit support.

## Key Changes

### 1. Unified Template Architecture

**Before:** 5 separate templates tracking approval state through template types
- `SubscriberProposedSubscription` (Initial)
- `RecipientProposedSubscription` (Initial)
- `ProcessorProposedSubscription` (Initial)
- `ProposedSubscriptionForRecipient` (Accepted)
- `ProposedSubscriptionForSubscriber` (Accepted)

**After:** 1 template with dynamic approval state
- `ProposedSubscription` with `ApprovalState` data type tracking which parties have approved

### 2. Intelligent Edit Support

Added `ProposedSubscription_Edit` choice that:
- Allows any party to propose changes to subscription terms
- Intelligently determines which parties are impacted by specific changes
- Automatically revokes approvals only from impacted parties
- Editor retains their approval (they're approving their own changes)

**Impact Rules:**
- `recipientPaymentPerDay` changes → revokes subscriber & recipient approvals
- `processorPaymentPerDay` changes → revokes subscriber & processor approvals  
- `expiresAt` changes → revokes all approvals
- `prepayWindow` changes → revokes subscriber approval
- `freeTrialExpiration` changes → revokes subscriber & recipient approvals
- `description` / `metadata` changes → no approvals revoked (informational only)

### 3. Module Consolidation

**Fixed module structure issues:**
- Consolidated fragmented `SubscriptionConfig` module from 3 files into 1
- Moved `Types.daml` to correct path matching its module declaration
- All modules now follow DAML's requirement: module name must match file path

**Files Consolidated:**
- `Helpers/ProcessorContext.daml` → `SubscriptionConfig.daml`
- `Helpers/SubscriptionConfig.daml` → `SubscriptionConfig.daml`
- `Helpers/SubscriptionProposal.daml` → `SubscriptionConfig.daml`
- `Helpers/Payment.daml` → `Types.daml`

### 4. Simplified Factory

Consolidated three factory choices into one:

**Before:** 3 separate choices
- `SubscriptionFactory_SubscriberProposedSubscription`
- `SubscriptionFactory_CreateRecipientProposedSubscription`
- `SubscriptionFactory_CreateProcessorProposedSubscription`

**After:** 1 unified choice
- `SubscriptionFactory_CreateProposal` - takes `proposal` and `proposer` as parameters
- Proposer's approval is granted immediately based on who they are
- Validates proposer is one of: subscriber, recipient, or processor

### 5. RecipientProvider in Configuration

Moved `recipientProvider` into the subscription configuration:

**Before:**
- `recipientProvider` passed as parameter to `CreateSubscription` choice
- Stored as separate field in active subscription templates

**After:**
- `recipientProvider` included in `SubscriptionProposal` from the start
- Part of `SubscriptionConfig` data type
- Active subscription templates use `config.recipientProvider`
- Provider update choices now update `config.recipientProvider`

## Benefits

1. **Reduced Complexity:** 1 proposal template instead of 5 (80% reduction), 1 factory choice instead of 3 (67% reduction)
2. **Clearer State Management:** Boolean flags more intuitive than template types
3. **Flexible Negotiation:** Parties can propose edits at any stage
4. **Intelligent Approval Logic:** System automatically manages approval revocation
5. **Simpler Configuration:** Provider information part of proposal from the start
6. **Unified Creation:** Single factory choice handles all three initiation paths
7. **Easier Maintenance:** Adding new editable fields or approval logic is straightforward
8. **Type Safety:** Strict typing maintained throughout, no `any` or `unknown` types used

## Files Changed

### Created
- `daml/Fairmint/Subscriptions/Creation/ProposedSubscription.daml` - Unified proposal template
- `daml/Fairmint/Subscriptions/SubscriptionConfig.daml` - Consolidated config module
- `daml/Fairmint/Subscriptions/Types.daml` - Payment types (moved from Helpers/)
- `daml/Fairmint/Subscriptions/Creation/README.md` - Updated documentation

### Modified
- `daml/Fairmint/Subscriptions/Creation/SubscriptionFactory.daml` - Single unified creation choice
- `daml/Fairmint/Subscriptions/Active/Subscriptions.daml` - Updated to use `config.recipientProvider`
- `daml/Fairmint/Subscriptions/SubscriptionConfig.daml` - Added `recipientProvider` to config

### Deleted
- `daml/Fairmint/Subscriptions/Creation/Initial/SubscriberProposedSubscription.daml`
- `daml/Fairmint/Subscriptions/Creation/Initial/RecipientProposedSubscription.daml`
- `daml/Fairmint/Subscriptions/Creation/Initial/ProcessorProposedSubscription.daml`
- `daml/Fairmint/Subscriptions/Creation/Accepted/ProposedSubscriptionForRecipient.daml`
- `daml/Fairmint/Subscriptions/Creation/Accepted/ProposedSubscriptionForSubscriber.daml`
- `daml/Fairmint/Subscriptions/Helpers/ProcessorContext.daml`
- `daml/Fairmint/Subscriptions/Helpers/SubscriptionConfig.daml`
- `daml/Fairmint/Subscriptions/Helpers/SubscriptionProposal.daml`
- `daml/Fairmint/Subscriptions/Helpers/Payment.daml`
- `daml/Fairmint/Subscriptions/Creation/Initial/` directory (empty)
- `daml/Fairmint/Subscriptions/Creation/Accepted/` directory (empty)

## Build Status
✅ Successfully compiles with `daml build`
✅ No linter errors
✅ All type constraints satisfied

## Next Steps (Not Implemented)

1. Update any tests that reference the old template structure
2. Update any client code that interacts with the creation flow
3. Consider adding choice to view current approval state
4. Consider adding choice to see edit history (if needed for audit trail)

