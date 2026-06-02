---
title: "Railgun — On-Chain ZK Privacy Ecosystem"
type: research
status: draft
date: 2026-06-02
relevance: high — most mature ZK privacy SDK for wallet integration
sources:
  - https://www.railgun.org/
  - https://docs.railgun.org/wiki
  - https://github.com/Railgun-Community/wallet
  - https://www.railgun.org/integrations
  - https://thedefiant.io/news/blockchains/ethereum-foundation-kohaku-sdk-privacy-wallet-integration-bb4t52
---

# Railgun

## Overview

Railgun is an on-chain ZK privacy system for EVM chains. Users deposit
tokens into a shielded balance, transact privately (including DeFi
interactions), and withdraw to any address — all using zero-knowledge proofs.

## Architecture

### Shielded Balances

- Users deposit ETH/ERC-20 into Railgun's smart contract
- Funds enter a **shielded UTXO set** (encrypted note commitments)
- Internal transfers use ZK proofs to update the UTXO set
- Withdrawals destroy UTXOs and release funds publicly

### 0zk Addresses

Railgun uses its own address format (`0zk:...`) for receiving private
transfers. These are derived from viewing keys and spending keys.

### Relayer Network

- Transactions are submitted by **relayers** (not the user's address)
- Relayers pay gas and are compensated from the shielded balance
- Breaks the link between the user's public address and the private tx
- ERC-4337 mempool relaying now operational via Kohaku integration

### Private DeFi

Railgun supports **private DeFi interactions**:
- Swap on Uniswap/0x/1inch without revealing your address
- LP provision, borrowing/lending — all from shielded balance
- "Unshield -> interact -> reshield" in a single transaction

## SDK Integration

### Wallet SDK (TypeScript)

```
npm install @railgun-community/wallet
```

- TypeScript, compatible with Node.js and modern browsers
- **100-200 lines of code** for basic integration
- Features: 0zk addresses, shielding, unshielding, private transfers,
  private DeFi interactions

### Quickstart SDK

Simplified integration path for dApp developers.

### Kohaku Integration (2026)

The Ethereum Foundation's **Kohaku Initiative** SDK wraps Railgun:
- `kohaku-eth/railgun` v0.0.1-alpha.21
- Operational ERC-4337 mempool relaying for private transactions
- Wallet-level distribution — embed privacy directly in wallet UI
- Unified interface across privacy protocols

## Supported Chains

- Ethereum
- Polygon
- BNB Chain
- (More via Kohaku abstraction layer)

## Trust Assumptions

- **ZK soundness**: Proof system must be cryptographically sound
- **Smart contract correctness**: Audited, battle-tested
- **Relayer liveness**: Need at least one honest relayer
  (mitigated by 4337 mempool integration)
- **No trusted setup per-transaction**: Uses plonk-style proofs
  (universal trusted setup)

## Relevance to NozKash

### As a Privacy Backend

Railgun is the most SDK-ready privacy solution for wallet integration:

1. **Mature SDK**: 100-200 lines for basic integration
2. **Private DeFi**: Users can interact with DeFi privately —
   something eCash alone cannot do
3. **Multi-token**: Supports any ERC-20, not just fixed-denomination ETH
4. **Kohaku convergence**: Standard wallet-level integration path

### Complementary with eCash

| Aspect | Railgun | NozKash eCash |
|--------|---------|---------------|
| Privacy | ZK proofs | BLS blind signatures |
| Gas cost | High | Low (BLS precompiles) |
| Speed | Slower (proof gen) | Fast (no heavy computation) |
| Tokens | Any ERC-20 | Fixed 0.001 ETH |
| DeFi | Full private DeFi | Transfer only |
| Anonymity set | Large (all Railgun users) | Per-mint |
| SDK maturity | Production | In development |

### Integration Strategy

- **Quick transfers**: Use eCash (low gas, fast, fixed denomination)
- **Private DeFi**: Use Railgun (full DeFi composability)
- **Compliance**: Use Privacy Pools (association set proofs)
- **Protocol-native**: Use EIP-8182 (when available post-Hegota)
