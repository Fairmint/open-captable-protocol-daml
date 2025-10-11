# Subscription Creation Architecture

## Overview

The Creation folder contains all contracts and logic for **proposing and approving subscriptions** before they become active. This is a three-step approval process requiring the subscriber, recipient and processor to approve.

## Lifecycle

```mermaid
%%{init: {'theme':'base', 'themeVariables': { 'fontSize':'18px', 'fontFamily':'arial', 'edgeLabelBackground':'#ffffff'}}}%%
flowchart TD
    Factory["<b>SubscriptionFactory</b><br/><small>Signatory: Processor</small>"]
    
    SubProposal["<b>SubscriberProposedSubscription</b><br/><small>Signatory: Subscriber<br/>Observer: Recipient, Processor</small>"]
    
    RecProposal["<b>RecipientProposedSubscription</b><br/><small>Signatory: Recipient<br/>Observer: Subscriber, Processor</small>"]
    
    ProcProposal["<b>ProcessorProposedSubscription</b><br/><small>Signatory: Processor<br/>Observer: Subscriber, Recipient</small>"]
    
    SubApproved["<b>ProposedSubscriptionForRecipient</b><br/><small>Signatory: Subscriber, Processor<br/>Observer: Recipient</small>"]
    
    RecApproved["<b>ProposedSubscriptionForSubscriber</b><br/><small>Signatory: Recipient, Processor<br/>Observer: Subscriber</small>"]
    
    Decision{"<small>Includes Free Trial?</small>"}
    
    FreeTrial["<b>FreeTrialSubscription</b>"]
    
    Paid["<b>PaidSubscription</b>"]
    
    Factory -- "<small>subscriber initiates</small>" --> SubProposal
    Factory -- "<small>recipient initiates</small>" --> RecProposal
    Factory -- "<small>processor initiates</small>" --> ProcProposal
    
    SubProposal -- "<small>processor approves ➡️</small>" --> SubApproved
    ProcProposal -- "<small>subscriber accepts</small>" --> SubApproved
    
    RecProposal -- "<small>processor approves</small>" --> RecApproved
    ProcProposal -- "<small>⬅️ recipient accepts</small>" --> RecApproved
    
    RecApproved -- "<small>subscriber accepts</small>" --> Decision
    SubApproved -- "<small>recipient accepts</small>" --> Decision
    
    Decision -- "<small>yes</small>" --> FreeTrial
    Decision -- "<small>no</small>" --> Paid
    
    classDef factory fill:#d1c4e9,stroke:#5e35b1,stroke-width:4px,color:#000
    classDef proposal fill:#bbdefb,stroke:#1976d2,stroke-width:3px,color:#000
    classDef approved fill:#c8e6c9,stroke:#388e3c,stroke-width:4px,color:#000
    classDef decision fill:#f5f5f5,stroke:#9e9e9e,stroke-width:2px,color:#333
    classDef outOfScope fill:#e8eaed,stroke:#5f6368,stroke-width:3px,color:#333,stroke-dasharray: 5 5
    
    class Factory factory
    class SubProposal,RecProposal,ProcProposal proposal
    class SubApproved,RecApproved approved
    class Decision decision
    class FreeTrial,Paid outOfScope
```

### Processor Approval

The processor is never the last party to approve a subscription. This is because the processor will be an automated service that can respond quickly, and it offers a better user experience by having the subscription activate as soon as the someone accepts.

### Reject or Withdraw

Any party (the subscriber, recipient or processor) can reject or withdraw a proposal at any stage in the lifecycle. When this occurs, they may optionally provide a `reason` (Text).