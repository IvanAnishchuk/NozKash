---
title: "Agentic Wallet Standards — EIP-7702, ERC-4337, Session Keys, MCP"
type: research
status: draft
date: 2026-06-02
relevance: core — standards our wallet service must implement
sources:
  - https://eip7702.io/
  - https://www.alchemy.com/docs/wallets/transactions/using-eip-7702
  - https://docs.openzeppelin.com/contracts/5.x/eoa-delegation
  - https://www.openfort.io/blog/eip-7702
  - https://consensys.io/ethereum-pectra-upgrade/eip-7702-and-account-abstraction
  - https://www.curvegrid.com/blog/2026-02-13-a-practical-look-at-eip-7702-and-wallet-delegation
  - https://google.github.io/A2A/ (A2A protocol spec)
  - https://github.com/zerodevapp/kernel (ZeroDev session keys)
  - https://github.com/thirdweb-dev/engine (self-hosted wallet backend)
  - https://github.com/safe-global/safe-transaction-service
  - https://docs.railgun.org/wiki/assurance/proof-of-innocence (Railgun PPOI)
---

# Agentic Wallet Standards

## EIP-7702: Account Delegation (Live since Pectra, May 2025)

### What It Does

Allows an EOA to set smart contract code for the duration of a transaction
(or persistently), enabling:
- **Batch operations**: Multiple actions in one transaction
- **Gas sponsorship**: Third party pays gas
- **Session keys**: Scoped authorizations for agents
- **Granular permissions**: Contract allowlists, spending caps, time windows

### How It Works

```
  EOA (0xUser)
    │
    │── EIP-7702 delegation ──> Smart Wallet Contract Code
    │                            │
    │                            ├── Session key A (agent)
    │                            │   - spend cap: 0.01 ETH/day
    │                            │   - contracts: [game, dex]
    │                            │   - expires: 24h
    │                            │
    │                            └── Session key B (service)
    │                                - spend cap: 1 USDC/tx
    │                                - contracts: [x402 facilitator]
    │                                - expires: 7d
```

**Key insight**: The user's main private key is never exposed to the agent.
The delegated contract code defines permission rules, and session keys
sign individual operations within those rules.

### Adoption (June 2026)

- Live on mainnet since Pectra (May 2025)
- Adopted: Ambire, Trust Wallet, MetaMask (opt-in)
- OpenZeppelin Contracts 5.x supports EOA delegation
- Framework support in Alchemy, Openfort, etc.

## ERC-4337: Account Abstraction

### Relevance for Agent Wallets

- **UserOperation mempool**: Agents submit UserOps instead of raw txs
- **Paymaster**: Gas sponsorship without EOA gas balance
- **Signature aggregation**: Batch verify multiple agent operations
- **Modular validation**: Plug in different signing schemes

### With Kohaku / Railgun

Kohaku routes privacy protocol transactions through the ERC-4337 mempool:
- `kohaku-eth/railgun` v0.0.1-alpha.21 has operational 4337 relaying
- Reduces dependence on protocol-specific relayer infrastructure
- Standard relayer set instead of privacy-specific relayers

## Session Keys for Agents

### Design Pattern

```typescript
// Agent receives a scoped session key
const sessionKey = await wallet.createSessionKey({
  permissions: {
    spendLimit: parseEther("0.01"),    // per-day cap
    allowedContracts: [NOZK_VAULT],    // only NozKash operations
    allowedFunctions: ["deposit", "reveal", "redeem"],
    expiry: Math.floor(Date.now() / 1000) + 86400, // 24h
  },
});

// Agent signs operations with session key
// Main private key never exposed to agent
const tx = await sessionKey.signTransaction({
  to: NOZK_VAULT,
  data: encodeFunctionData("deposit", [...]),
});
```

### Validation Flow

1. Agent constructs transaction
2. Signs with session key
3. Smart wallet validates: is this key authorized? within limits? not expired?
4. If valid, executes on behalf of the EOA

## MCP Tools for Wallet Operations

Model Context Protocol enables LLMs to interact with wallets:

```json
{
  "tools": [
    {
      "name": "send_token",
      "description": "Send tokens to an address",
      "parameters": {
        "to": "address",
        "amount": "string",
        "token": "address"
      }
    },
    {
      "name": "get_balance",
      "description": "Get token balance",
      "parameters": { "token": "address" }
    },
    {
      "name": "nozk_deposit",
      "description": "Deposit ETH into NozKash for privacy",
      "parameters": { "index": "number" }
    },
    {
      "name": "nozk_redeem",
      "description": "Redeem NozKash token",
      "parameters": {
        "index": "number",
        "to": "address"
      }
    }
  ]
}
```

## Data Validation for Agentic Transactions

### Threat Model

- LLM hallucination: Agent generates invalid addresses or amounts
- Prompt injection: Malicious content manipulates agent's payment behavior
- Replay attacks: Re-submitting old signed transactions

### Validation Layers

1. **Schema validation**: Type-check all parameters before signing
2. **Policy engine** (in TEE): Spending caps, allowlists, rate limits
3. **Human-in-the-loop**: High-value transactions require user approval
4. **Replay protection**: Nonce management, deadline enforcement
5. **Address validation**: Checksum verification, ENS resolution verification

## Kohaku Privacy Framework

### Architecture (Ethereum Foundation, 2026)

Multi-layer privacy SDK for wallets:

1. **Light Client**: Helios integration for local blockchain verification
   (no centralized RPCs)
2. **Private Query Layer**: ORAM + TEE for data fetching without
   exposing queries to RPC providers
3. **Identity & Recovery**: ZK proofs (ZK Email, privacy wallet secrets)
   + post-quantum signatures (Falcon/Dilithium)
4. **Multi-Protocol Privacy**: Unified interface to privacy protocols
   (Railgun first, then Privacy Pools, EIP-8182)
5. **Network Privacy**: IP protection and traffic obfuscation
6. **ERC-7811**: Privacy-preserving asset discovery

### Per-Dapp Address Isolation

Kohaku generates unique addresses per dApp:
- No cross-dApp tracking via address reuse
- Backed by Vitalik Buterin
- Implemented in reference wallet (forked from Ambire)

## Relevance to NozKash

### Standards We Should Implement

| Standard | Priority | Reason |
|----------|----------|--------|
| x402 | **P0** | Payment rail for agent interactions |
| EIP-7702 session keys | **P0** | Agent signing without exposing main key |
| ERC-4337 | **P1** | Gas abstraction, standard mempool |
| MCP tools | **P1** | LLM agent integration |
| Kohaku SDK | **P2** | Standard privacy wallet integration |
| EIP-8182 | **P2** | When available post-Hegota |

### Our Differentiator

Existing agentic wallets (Coinbase, Privy, Turnkey) are SaaS-only.
Our service is **self-hostable**, **privacy-native**, and **open-source** —
the first agentic wallet that treats privacy as a first-class feature
rather than an afterthought.
