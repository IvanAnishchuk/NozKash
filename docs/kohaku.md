# Kohaku

Ethereum Foundation's privacy-first tooling for the Ethereum wallet ecosystem.

---

## Overview

- **GitHub:** <https://github.com/ethereum/kohaku>
- **Documentation:** <https://ethereum.github.io/kohaku/>
- **Announced:** Devcon Buenos Aires, November 2025 (Vitalik Buterin)
- **Developed by:** Ethereum Foundation Privacy Cluster (PSE) — 47-member team coordinated by Igor Barinov

Kohaku is a wallet SDK that packages privacy primitives and infrastructure tools into a unified interface. It is not a single protocol but a collection of integrations.

---

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `@kohaku-eth/railgun` | RAILGUN privacy protocol integration | Production |
| `@kohaku-eth/privacy-pools` | Privacy Pools protocol integration | Production |
| `@kohaku-eth/provider` | Provider abstraction (ethers, viem, helios, colibri) | Production |
| `@kohaku-eth/pq-account` | Post-quantum resistant accounts (ERC-4337) | Production |

**Tech stack:** Rust (55.8%), TypeScript (31.5%), Solidity (8%), Python (2%), Sage (1.8%).

---

## Integrated Privacy Protocols

### 1. Tornado (Pool Protocol)
Fixed-denomination privacy pool. Deposit/withdraw fixed amounts (1 ETH, 10 ETH, etc.) using zk-SNARK proofs.

### 2. RAILGUN (Shielded DeFi)
Shield tokens into a private balance, transact privately (transfers, swaps, DeFi interactions), then unshield.

### 3. Privacy Pools (Compliant Privacy)
Privacy pool with association sets and private proof of innocence — users prove their funds don't come from flagged sources without revealing which specific deposit is theirs.

---

## Infrastructure Components

- **Helios light client** — local blockchain verification (no trusted RPC)
- **Private query layer** — Oblivious RAM + Trusted Execution Environments (TEE) for metadata-private RPC
- **Identity/recovery modules** — ZK-based identity with post-quantum-safe signatures
- **Account abstraction** — ERC-4337 smart accounts for gas abstraction and recovery

---

## Privacy Stewards of Ethereum (PSE) Roadmap

Kohaku is part of PSE's broader 2025 privacy roadmap organized around three pillars:

| Pillar | Goal | Initiatives |
|--------|------|-------------|
| **Private writes** | Make private on-chain actions as easy as public ones | Private voting, confidential DeFi, institutional privacy task force |
| **Private reads** | Prevent metadata leaks in authentication/queries | Private RPC working group, ORAM in wallets, mixnet routing |
| **Private proving** | Cheap ZK proofs on mobile | Client-side proving, modular zk-snark wallets, unlinkable credentials |

- **PSE website:** <https://pse.dev/>
- **PSE roadmap:** <https://pse.dev/blog/pse-roadmap-2025>
- **GitHub:** <https://github.com/privacy-scaling-explorations>

---

## Relevance to NozKash

NozKash uses blind signatures rather than zk-SNARKs, making it fundamentally lighter on gas (~120k redeem vs 500k-1.5M for zk-SNARK privacy pools). Kohaku's architecture shows the ecosystem direction: wallet-level privacy with pluggable protocol backends. NozKash could serve as another backend integration (alongside RAILGUN and Privacy Pools) for wallets seeking low-gas privacy options.
