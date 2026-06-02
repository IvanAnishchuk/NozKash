---
title: "EIP-8182 — Native Private ETH and ERC-20 Transfers"
type: research
status: draft
date: 2026-06-02
relevance: high — protocol-level privacy that NozKash service should integrate
sources:
  - https://crypto.news/ethereum-draft-eip-8182-aims-to-make-private-transfers-a-native-feature/
  - https://blockonomi.com/eip-8182-proposes-native-private-transfers-for-ethereum-protocol/
  - https://www.ccn.com/education/crypto/ethereum-privacy-upgrade-eip-8182-private-eth-erc20-payments/
  - https://crypto.news/tom-lehman-pushes-for-eip-8182-inclusion-in-ethereum-hegota-upgrade/
  - https://eip8182.com
---

# EIP-8182 — Native Private Transfers

## Overview

EIP-8182, authored by Tom Lehman, proposes embedding a shared shielded pool
and ZK proof-verification precompile directly into the Ethereum protocol. It
targets the **Hegota hard fork** (H2 2026), pending core developer approval.

## Core Architecture

### System Contract (Fixed Address)

A protocol-managed system contract holding:
- **Note commitment tree** — Merkle tree of encrypted UTXOs
- **Nullifier set** — prevents double-spending
- **User key registry** — delivery keys for receiving private transfers
- **Authorization policy registry** — compliance/policy rules

Properties:
- No proxy, no admin function, no governance token
- No on-chain upgrade mechanism
- Evolves only through Ethereum hard forks
- Fixed address (deployed as system contract)

### UTXO Model

Uses a UTXO-style architecture rather than account-based shielded balances:
- Deposits create encrypted notes (commitments)
- Transfers consume notes (publish nullifiers) and create new notes
- Withdrawals consume notes and release funds to public addresses

### ZK Proof System

- **Groth16 proofs over BN254** (same curve as EIP-196/197 precompiles)
- New ZK proof-verification **precompile** for efficient on-chain verification
- Separates **transaction authorization** from **proof generation**:
  - User signs transaction details in their existing wallet
  - Proof generation can be delegated to a remote prover
  - "Prover has the power to compute but not the power to decide"

### Supported Operations

- Private ETH transfers
- Private ERC-20 transfers
- **Atomic shield-interact-reshield**: private funds leave the pool,
  interact with any public smart contract, and return — all in one tx
- Send to any Ethereum address or ENS name from existing wallets

## Trust Model

- No admin keys, no governance tokens, no on-chain upgrade hooks
- Security rests on Ethereum's own trust model (validator consensus)
- ZK soundness rests on BN254/Groth16 cryptographic assumptions
- Trusted setup required for Groth16 (ceremony)

## What EIP-8182 Does NOT Cover

- Mempool encryption (transactions visible in mempool before inclusion)
- Network-layer anonymity (IP address privacy)
- Wallet-side UX changes
- Cross-chain privacy

## Current Status (June 2026)

- **Draft EIP** — not yet accepted
- Targeting Hegota hard fork (H2 2026)
- Needs approval through core developer review process
- Full spec + reference implementation at eip8182.com
- Competitive with ~13 distinct privacy approaches from ~35 teams

## Relevance to NozKash

### Complementary, Not Competing

EIP-8182 and NozKash eCash solve different problems:

| Aspect | EIP-8182 | NozKash eCash |
|--------|----------|---------------|
| Privacy mechanism | ZK proofs (Groth16) | BLS blind signatures |
| Trust model | Ethereum consensus + ZK soundness | Mint authority + BLS |
| Gas cost | High (ZK verification) | Low (BLS precompiles) |
| Token types | ETH + any ERC-20 | Fixed denomination ETH |
| Anonymity set | Global (all users of the pool) | Per-mint |
| Availability | Requires Hegota fork | Available now (EIP-2537) |
| Compliance | Authorization policy registry | None (yet) |

### Integration Path

1. **If Hegota ships**: Our wallet service wraps EIP-8182's system contract
   as a privacy backend, alongside eCash and Railgun
2. **Before Hegota**: eCash remains the lightest on-chain privacy option
   using only BLS precompiles (no ZK ceremony, no heavy proofs)
3. **Hybrid**: Use eCash for fast fixed-denomination transfers,
   EIP-8182 for arbitrary-amount private transfers
