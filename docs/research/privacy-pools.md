---
title: "Privacy Pools — Compliance-Friendly ZK Privacy"
type: research
status: draft
date: 2026-06-02
relevance: high — compliance model applicable to NozKash, potential integration target
sources:
  - https://docs.privacypools.com/
  - https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4563364
  - https://github.com/0xbow-io/privacy-pools-website
  - https://www.coolwallet.io/blogs/blog/privacy-pools
  - https://cointelegraph.com/news/crypto-privacy-pools-regulation
---

# Privacy Pools

## Overview

Privacy Pools is a smart contract protocol combining zero-knowledge proofs
with compliance-friendly filtering. Proposed by Vitalik Buterin, Jacob Illum,
Matthias Nadler, Fabian Schar, and Ameen Soleimani (2023). Developed and
launched on Ethereum mainnet by **0xbow** in April 2025.

## Three-Layer Architecture

### 1. Smart Contracts

- **Upgradeable Entrypoint** — coordinates ASP-operated pools
- **Asset-specific privacy pools** — hold and manage deposited funds
- Multi-asset: native ETH and ERC-20 tokens

### 2. Zero-Knowledge Circuits

- **Commitment circuits** — secure deposit registration
- **Withdrawal circuits** — private asset transfers with association proofs
- **On-chain verifiers** — validate ZK proofs

### 3. Association Set Provider (ASP)

The key compliance innovation:

- Maintains the **current set of approved deposit labels**
- Updates state through authorized accounts
- Users prove their withdrawal belongs to the "approved" set
  WITHOUT revealing their specific deposit

## Compliance Mechanism

```
  User deposits ETH ──> Pool adds commitment to Merkle tree
                         │
  ASP evaluates deposit ─┤─ Approved? ──> Added to association set
                         │
                         └─ Flagged?  ──> Excluded from association set

  User withdraws:
    1. Generates ZK proof: "my deposit is IN the approved set"
    2. Proof reveals nothing about WHICH specific deposit
    3. Verifier confirms membership without learning identity
```

**Key insight**: Users prove they are NOT in a sanctioned/flagged set,
without revealing their identity. This inverts the typical privacy vs.
compliance trade-off.

### Ragequit Mechanism

If a deposit is excluded from the association set (not approved by ASP),
the depositor can **publicly recover** their funds. This prevents
censorship — the ASP can exclude you from the privacy set but cannot
freeze your funds.

## Trust Assumptions

- **ASP honesty**: Must correctly maintain the approved set
  (but ragequit limits damage from a malicious ASP)
- **ZK soundness**: Proof system must be sound
- **Smart contract correctness**: Audited upgradeable contracts
- **Multiple ASPs possible**: Different ASPs with different policies
  can operate on the same pool

## Partial Withdrawals

Users can withdraw a portion of their deposit while keeping the
remainder private — important for real-world usability.

## Current Status (June 2026)

- **Live on Ethereum mainnet** since April 2025
- Developed by 0xbow team
- Kohaku SDK integration in development
- Part of the broader Ethereum privacy roadmap
- ~35 teams working on ~13 privacy approaches for Devcon 2026

## Relevance to NozKash

### ASP Model for eCash Compliance

Privacy Pools' ASP model directly applicable to NozKash:

1. **Mint as ASP**: Our mint authority already evaluates deposits —
   extend this to maintain an association set
2. **Compliance proofs**: Users can prove their eCash tokens came from
   a compliant deposit set without revealing which deposit
3. **Multiple mints**: Different mints with different compliance policies
   (like multiple ASPs)

### Integration as Privacy Backend

Our agentic wallet service can wrap Privacy Pools as one of several
privacy backends:
- Deposit user funds into Privacy Pools for ZK privacy
- Use association set proofs for compliance when interacting with
  regulated services
- Combine with eCash for lower-cost fixed-denomination privacy

### Comparison

| Aspect | Privacy Pools | NozKash eCash |
|--------|--------------|---------------|
| Privacy | ZK proofs | BLS blind signatures |
| Compliance | ASP association sets | Mint authority (extendable) |
| Gas cost | High (ZK verification) | Low (BLS precompiles) |
| Denominations | Arbitrary | Fixed (0.001 ETH) |
| Anonymity set | All approved deposits | Per-mint deposits |
| Maturity | Mainnet (April 2025) | Testnet (Sepolia) |
