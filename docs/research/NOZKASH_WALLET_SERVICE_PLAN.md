---
title: "NozKash Wallet Service — R&D Plan"
type: plan
status: draft
date: 2026-06-02
version: "0.2"
authors: ["Ivan Anishchuk"]
---

# NozKash Wallet Service: R&D Plan

**Non-custodial TEE-backed agentic wallet service with pluggable privacy
and integrated mint — self-hostable, open-source, privacy-first.**

## Table of Contents

1. [Vision](#1-vision)
2. [Architecture Overview](#2-architecture-overview)
3. [Core Components](#3-core-components)
4. [Privacy Plugin System](#4-privacy-plugin-system)
5. [Agentic Interface](#5-agentic-interface)
6. [Security Model](#6-security-model)
7. [Deployment Modes](#7-deployment-modes)
8. [Implementation Roadmap](#8-implementation-roadmap)
9. [Open Questions](#9-open-questions)
10. [Research References](#10-research-references)

---

## 1. Vision

Build an **open-source, self-hostable wallet service** that:

- Gives AI agents autonomous wallet capabilities with policy-enforced
  guardrails (following Coinbase AgentKit's model)
- Runs all sensitive operations (key management, BLS mint signing,
  policy enforcement) inside a **TEE** (AWS Nitro / Intel TDX)
- Provides **pluggable privacy backends**: NozKash eCash (BLS blind
  signatures), Railgun (ZK shielded balances), Privacy Pools
  (compliance-friendly ZK), and EIP-8182 (when available post-Hegota)
- Exposes an **x402-compatible payment interface** so agents can pay for
  and sell privacy services via standard HTTP
- Can operate as a **mint service** (existing NozKash mint), a
  **custodial self-deployed service** (for teams running their own infra),
  or a **non-custodial wallet** (user controls keys via TEE attestation)

### Why Not Just Use Coinbase CDP?

| Aspect | Coinbase CDP | NozKash Service |
|--------|-------------|-----------------|
| Hosting | SaaS only | **Self-hostable** |
| Source | AgentKit OSS, infra closed | **Fully open-source** |
| Privacy | None built-in | **First-class multi-backend** |
| Mint capability | N/A | **Integrated BLS mint** |
| Compliance model | Coinbase KYC | **Pluggable (ASP, policy registry)** |
| Key management | MPC + Nitro | **TEE + optional MPC** |
| x402 | Client support | **Client + facilitator + resource server** |

---

## 2. Architecture Overview

```
                 Same audited codebase, different configs, separate TEE instances
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                                                                         │
  │  ┌─────────────────────────┐         ┌─────────────────────────┐       │
  │  │  TEE: Mint Instance     │         │  TEE: Wallet Instance   │       │
  │  │  config: mint           │         │  config: wallet         │       │
  │  │                         │         │                         │       │
  │  │  ┌───────────────────┐  │         │  ┌───────────────────┐  │       │
  │  │  │ Validator:        │  │         │  │ Validator:        │  │       │
  │  │  │  on-chain deposit │  │         │  │  x402 payment +   │  │       │
  │  │  │  tx verification  │  │         │  │  session key auth │  │       │
  │  │  └───────────────────┘  │         │  └───────────────────┘  │       │
  │  │  ┌───────────────────┐  │         │  ┌───────────────────┐  │       │
  │  │  │ BLS Key Registry  │  │         │  │ Key Manager       │  │       │
  │  │  │ (mint keys, multi-│  │         │  │ (user masterSeed  │  │       │
  │  │  │  denom, multi-tok)│  │         │  │  derived keys)    │  │       │
  │  │  └───────────────────┘  │         │  └───────────────────┘  │       │
  │  │  ┌───────────────────┐  │         │  ┌───────────────────┐  │       │
  │  │  │ Policy Engine     │  │         │  │ Policy Engine     │  │       │
  │  │  │ (compliance,      │  │         │  │ (session caps,    │  │       │
  │  │  │  sanctions)       │  │         │  │  tx limits, HITL) │  │       │
  │  │  └───────────────────┘  │         │  └───────────────────┘  │       │
  │  │  attestation: A         │         │  attestation: B         │       │
  │  └────────────┬────────────┘         └────────────┬────────────┘       │
  │               │                                   │                    │
  └───────────────┼───────────────────────────────────┼────────────────────┘
                  │                                   │
  ┌───────────────┼───────────────────────────────────┼────────────────────┐
  │               ▼           API Gateway             ▼                    │
  │  ┌─────────────────┐    ┌──────────────┐    ┌──────────────────┐      │
  │  │ Event watcher   │    │ x402 facil.  │    │ MCP server       │      │
  │  │ (DepositLocked) │    │ REST API     │    │ Webhooks         │      │
  │  └─────────────────┘    └──────────────┘    └──────────────────┘      │
  └────────────────────────────────┬───────────────────────────────────────┘
                                   │
                  ┌────────────────┼────────────────┐
                  ▼                ▼                 ▼
        ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
        │ EVM Chains   │  │ Solana       │  │ Privacy      │
        │ NozkVaultV3  │  │ Nozk Program │  │ Backends     │
        │ (BLS12-381)  │  │ (BN254)      │  │ Railgun,     │
        │              │  │              │  │ Privacy Pools │
        └──────────────┘  └──────────────┘  └──────────────┘
```

---

## 3. Core Components

### 3.1 TEE Key Manager

**Purpose**: Generate, store, and use cryptographic keys inside a TEE.

**Key types managed**:
- **ECDSA (secp256k1)**: Ethereum transaction signing
- **BLS12-381 (mint keys)**: Multiple mint authority keys — one per
  (denomination, token) pair
- **BLS12-381 (user keys)**: User spend keys derived from masterSeed
- **Ed25519**: Internal service authentication (optional)

**Key derivation model**:
```
masterSeed (user-provided or TEE-generated)
  ├── ECDSA wallet key: keccak256(personal_sign(seed_msg))
  ├── Token keys: keccak256(seed || index_be32) → spend_priv, blind_priv
  └── (user keys are denomination-agnostic; denomination is a contract parameter)

Mint key registry (sealed in enclave):
  ├── MINT_KEY_ETH_0001:  BLS privkey for 0.001 ETH tokens
  ├── MINT_KEY_ETH_001:   BLS privkey for 0.01  ETH tokens
  ├── MINT_KEY_ETH_01:    BLS privkey for 0.1   ETH tokens
  ├── MINT_KEY_ETH_1:     BLS privkey for 1     ETH tokens
  ├── MINT_KEY_USDC_1:    BLS privkey for 1     USDC tokens
  ├── MINT_KEY_USDC_10:   BLS privkey for 10    USDC tokens
  └── ...                 (extensible per token + denomination)
```

**Multi-mint-key architecture**: Each (token, denomination) pair has a
dedicated BLS keypair. The contract registers multiple mint pubkeys,
each bound to a specific denomination and token address. This:
- Keeps anonymity sets per-denomination (unavoidable with fixed denoms)
- Enables ERC-20 token privacy (not just ETH)
- Allows independent mint authorities per denomination (future federation)
- Mint keys are all sealed in the same TEE enclave

**Curve abstraction layer** (BLS12-381 / BN254):

The crypto library must abstract over the pairing-friendly curve so the
same eCash protocol works on both EVM and Solana:

```typescript
interface PairingCurve {
  readonly name: "bls12-381" | "bn254";
  readonly G1Size: number;     // 128 bytes (BLS12-381) or 64 bytes (BN254)
  readonly G2Size: number;     // 256 bytes (BLS12-381) or 128 bytes (BN254)
  readonly ScalarSize: number; // 32 bytes for both

  hashToG2(message: Uint8Array, dst: string): G2Point;
  g1Add(a: G1Point, b: G1Point): G1Point;
  g1ScalarMul(point: G1Point, scalar: Scalar): G1Point;
  g2Add(a: G2Point, b: G2Point): G2Point;
  g2ScalarMul(point: G2Point, scalar: Scalar): G2Point;
  pairing(g1: G1Point[], g2: G2Point[]): boolean;
}
```

**Chain → curve mapping**:

| Chain | Curve | On-chain verification | Status |
|-------|-------|----------------------|--------|
| EVM (Ethereum, Base, etc.) | BLS12-381 | EIP-2537 precompiles | Live (Pectra, May 2025) |
| EVM (any) | BN254 | EIP-196/197 precompiles | Live (Byzantium, 2017) |
| Solana | BN254 | alt_bn128 syscalls + SIMD-0302 (G2) | G1 live, G2 coming |
| Solana | BLS12-381 | SIMD-0388 syscalls | Landing with Alpenglow Q3 2026 |

**Strategy**: BLS12-381 is preferred (128-bit security, larger field).
BN254 is the fallback for chains without BLS12-381 support. The blind
signature protocol is algebraically identical on both curves — only the
encoding, DST strings, and precompile addresses differ.

**Implementation**:
- `nozk_ts/` gets a `CurveBackend` interface with `bls12381` and `bn254` impls
- Contract: deploy BLS12-381 version on EVM, BN254 version on Solana
  (same logic, different precompile addresses and point sizes)
- Mint TEE: holds keys for both curves (separate key registries)
- Test vectors: generate for both curves, cross-validate

**NozKash advantage**: Our existing derivation from `(masterSeed, index)`
means the TEE only needs to protect one user secret. All token keys are
re-derivable. No complex key backup needed. Mint keys are sealed separately.

**Implementation options**:

| Option | Pros | Cons |
|--------|------|------|
| AWS Nitro Enclaves | Proven (Coinbase uses it), best attestation | AWS lock-in |
| Intel TDX | On-prem possible, multi-cloud | Newer, less battle-tested |
| AMD SEV-SNP | Multi-cloud, good Azure support | Less wallet ecosystem |
| Software TEE (dev) | Easy local dev, no hardware | No real security |

**Recommendation**: Primary target **AWS Nitro**, with **Intel TDX** as
secondary for self-hosted/on-prem. Software TEE for development only.

### 3.2 Policy Engine

**Purpose**: Enforce spending limits, compliance rules, and access controls
before any signature is produced.

**Policy types**:

```yaml
policies:
  session:
    max_spend_per_session: "0.1 ETH"
    max_transactions: 100
    session_ttl: "24h"

  transaction:
    max_value: "0.01 ETH"
    allowed_contracts:
      - "0x...NozkVault"
      - "0x...RailgunPool"
    allowed_functions:
      - "deposit"
      - "reveal"
      - "redeem"
    blocked_recipients:
      - "0x...OFAC_sanctioned"

  compliance:
    mode: "asp"  # or "none", "allowlist", "blocklist"
    asp_provider: "https://asp.example.com"
    require_association_proof: true

  rate_limit:
    max_per_minute: 10
    max_per_hour: 100
```

**Enforcement**: All policy checks happen inside the TEE, before the
signing key is accessed. The API gateway cannot bypass policies.

### 3.3 Unified Service Model (Mint = Wallet with Different Validation)

**Key insight**: The mint and wallet service share the same interface.
Both accept a request, validate it, and produce a BLS blind signature.
The only difference is the **validation strategy**:

```
  ┌──────────────────────────────────────────────────────┐
  │                  Unified Signing Service               │
  │                                                        │
  │   Request ──> Validator ──> Policy Engine ──> Signer   │
  │                  │                              │      │
  │                  ▼                              ▼      │
  │         ┌──────────────┐              ┌─────────────┐ │
  │         │ Validation   │              │ BLS Key     │ │
  │         │ Strategy     │              │ Registry    │ │
  │         │              │              │             │ │
  │         │ • mint mode: │              │ (token,     │ │
  │         │   verify     │              │  denom,     │ │
  │         │   on-chain   │              │  chain)     │ │
  │         │   deposit tx │              │  → sk, pk   │ │
  │         │              │              │             │ │
  │         │ • wallet     │              └─────────────┘ │
  │         │   mode:      │                              │
  │         │   verify     │                              │
  │         │   x402 pay,  │                              │
  │         │   session    │                              │
  │         │   key auth,  │                              │
  │         │   policy     │                              │
  │         │   checks     │                              │
  │         └──────────────┘                              │
  └──────────────────────────────────────────────────────┘
```

**Validation strategies** (pluggable):

| Mode | Trigger | Validation | Who Pays |
|------|---------|-----------|----------|
| **Mint** | `DepositLocked` event on-chain | Verify deposit tx: correct amount, token, depositId unique | User deposited on-chain |
| **Agentic wallet** | x402 payment + API request | Verify x402 payment settled, session key valid, within policy | Agent pays via x402 (USDC) |
| **Self-hosted** | Internal API call | API key auth + policy engine | Operator (self-funded) |
| **Custodial** | Admin API | Admin auth + spending limits | Service operator |

The signing pipeline is identical:
1. Receive blind signing request `(depositId, B, token, denom)`
2. Run validation strategy (pluggable)
3. Policy engine check (session caps, compliance, rate limits)
4. Look up BLS key: `sk = registry[token][denom][chain]`
5. Compute blind signature: `S' = sk * B`
6. Announce on-chain (mint mode) or return to caller (wallet mode)

**Multi-key registry** (in TEE):

```
  Key Registry (sealed in enclave)
  ┌─────────────────────────────────────────────────┐
  │  chain: evm/ethereum                             │
  │    ETH / 0.001  →  sk, pk  (BLS12-381)          │
  │    ETH / 0.01   →  sk, pk  (BLS12-381)          │
  │    ETH / 0.1    →  sk, pk  (BLS12-381)          │
  │    ETH / 1      →  sk, pk  (BLS12-381)          │
  │    USDC / 1     →  sk, pk  (BLS12-381)          │
  │    USDC / 10    →  sk, pk  (BLS12-381)          │
  │                                                  │
  │  chain: solana                                   │
  │    SOL / 0.01   →  sk, pk  (BN254)              │
  │    USDC / 1     →  sk, pk  (BN254)              │
  │    ...                                           │
  └─────────────────────────────────────────────────┘
```

**Contract changes required** (V2 → V3):
- Replace single `pkMint` with a registry: `mapping(bytes32 => uint256[4])`
  keyed by `keccak256(abi.encode(token, denomination))`
- Replace `DENOMINATION` constant with per-deposit denomination parameter
- `deposit(address depositId, uint256[8] B, address token, uint256 denom)`
- `reveal()` pairing check uses the correct `pkMint` for the token's denom
- ERC-20 support: `transferFrom` for ERC-20 deposits, native `msg.value`
  for ETH deposits
- Admin function to register new (token, denomination, pkMint) tuples
  (or immutable at deploy with a factory pattern)

**TEE benefit**: Users can verify via attestation that the service
runs the published code — regardless of mode. The mint cannot selectively
deny service, extract blinding factors, or correlate deposits to redemptions.
The wallet cannot sign outside policy.

### 3.4 API Gateway

**Purpose**: Expose wallet operations via multiple interfaces.

**Interfaces**:

| Interface | Use Case |
|-----------|----------|
| REST API | Direct programmatic access |
| x402 facilitator | HTTP 402 payment verification + settlement |
| x402 resource server | Sell privacy operations as paid APIs |
| MCP server | LLM agent integration (Claude, GPT, etc.) |
| Webhooks | Event notifications (deposit confirmed, token ready) |
| gRPC (future) | High-performance inter-service communication |

**x402 facilitator role**: Our service can verify and settle x402 payments,
enabling other services to accept payment through us.

**x402 resource server role**: Expose NozKash operations as paid endpoints:
- `POST /privacy/deposit` — deposit into shielded pool (paid via x402)
- `POST /privacy/transfer` — private transfer (paid via x402)
- `POST /privacy/withdraw` — withdraw from shielded pool

---

## 4. Privacy Plugin System

### 4.1 Plugin Interface

```typescript
interface PrivacyBackend {
  readonly name: string;
  readonly supportedTokens: TokenSpec[];
  readonly complianceModel: "none" | "asp" | "policy_registry";

  // Core operations
  deposit(params: DepositParams): Promise<DepositResult>;
  transfer(params: TransferParams): Promise<TransferResult>;
  withdraw(params: WithdrawParams): Promise<WithdrawResult>;

  // State queries
  getShieldedBalance(token: TokenSpec): Promise<bigint>;
  getTransactionHistory(): Promise<PrivateTransaction[]>;

  // Compliance
  generateComplianceProof?(params: ComplianceParams): Promise<ComplianceProof>;
}
```

### 4.2 Backend Implementations

#### NozKash eCash (BLS Blind Signatures)

```
Status: Existing (single-denom) — extend to multi-denom/multi-token
Gas cost: Low (BLS precompiles only, ~50-100k gas)
Tokens: Multiple denominations per token (ETH, USDC, DAI, WETH, etc.)
Curves: BLS12-381 (EVM) and BN254 (Solana, EVM fallback)
Compliance: Mint authority (extensible to ASP)
Best for: Fast, cheap, fixed-denomination private transfers
```

**Multi-denomination model**:
- Each (token, denomination) pair has a dedicated mint keypair
- Deposits specify token + denomination; contract routes to correct pool
- Anonymity set is per (token, denomination) — inherent tradeoff
- Recommended denominations: powers-of-10 (0.001, 0.01, 0.1, 1, 10, 100)
- Users compose amounts from multiple tokens (e.g., 0.123 ETH =
  1x0.1 + 2x0.01 + 3x0.001)

**Multi-curve model**:
- BLS12-381 for EVM chains (EIP-2537 precompiles)
- BN254 for Solana (alt_bn128 syscalls) and EVM fallback (EIP-196/197)
- Same protocol, different curve backend; keyed separately in mint registry

**Implementation**: Extend `nozk_ts/nozk-library.ts` with `CurveBackend`
interface. New `NozkVaultV3` contract with multi-denomination + ERC-20
support. Solana program port using BN254 (then BLS12-381 post-Alpenglow).

#### Railgun (ZK Shielded Balances)

```
Status: Integration via Railgun Wallet SDK + Kohaku
Gas cost: High (ZK proof verification)
Tokens: Any ERC-20
Compliance: None built-in (Kohaku adding ASP support)
Best for: Private DeFi interactions, arbitrary-amount transfers
```

**Implementation**: Wrap `@railgun-community/wallet` SDK.
100-200 lines for basic shield/transfer/unshield.

#### Privacy Pools (Compliance-Friendly ZK)

```
Status: Live on mainnet (0xbow, April 2025)
Gas cost: High (ZK proof verification)
Tokens: ETH + ERC-20
Compliance: ASP association sets (built-in)
Best for: Regulatory-compliant private transfers
```

**Implementation**: Integrate via Privacy Pools SDK/contracts.
ASP integration for compliance proofs.

#### EIP-8182 Native Privacy (Future)

```
Status: Draft EIP — targeting Hegota fork (H2 2026)
Gas cost: Medium (ZK precompile — cheaper than app-level ZK)
Tokens: ETH + any ERC-20
Compliance: Authorization policy registry (protocol-level)
Best for: Protocol-native privacy after Hegota ships
```

**Implementation**: Wrap the system contract when available.
Groth16 BN254 proofs verified by protocol precompile.

### 4.3 Privacy Router

The privacy router selects the optimal backend based on:

```typescript
interface PrivacyRequest {
  operation: "deposit" | "transfer" | "withdraw";
  token: TokenSpec;
  amount: bigint;
  requireCompliance: boolean;
  preferSpeed: boolean;
  preferCost: boolean;
}

function selectBackend(request: PrivacyRequest): PrivacyBackend {
  // Fixed 0.001 ETH + prefer cost/speed → eCash
  // Arbitrary ERC-20 + no compliance → Railgun
  // Need compliance proof → Privacy Pools
  // Protocol-native available → EIP-8182
  // Fallback: let user choose
}
```

---

## 5. Agentic Interface

### 5.1 x402 Payment Flow

```
  AI Agent                NozKash Service              On-Chain
     |                          |                         |
     |-- GET /privacy/deposit ->|                         |
     |<- 402 + payment req -----|                         |
     |                          |                         |
     | sign USDC transferAuth   |                         |
     |                          |                         |
     |-- GET + PAYMENT-SIG ---->|                         |
     |                  verify & settle USDC payment      |
     |                  execute privacy deposit           |
     |                          |--- deposit() tx ------->|
     |<- 200 + deposit receipt -|                         |
```

### 5.2 MCP Tools

```json
{
  "tools": [
    {
      "name": "nozk_deposit",
      "description": "Deposit ETH into NozKash shielded pool",
      "parameters": {
        "amount": "string (ETH amount, must be multiple of 0.001)",
        "backend": "string (ecash|railgun|privacy_pools|auto)",
        "compliance": "boolean (require compliance proof)"
      }
    },
    {
      "name": "nozk_transfer",
      "description": "Private transfer within shielded pool",
      "parameters": {
        "to": "string (address or 0zk address or ENS)",
        "amount": "string",
        "backend": "string"
      }
    },
    {
      "name": "nozk_withdraw",
      "description": "Withdraw from shielded pool to public address",
      "parameters": {
        "to": "string (destination address)",
        "amount": "string",
        "backend": "string",
        "generate_compliance_proof": "boolean"
      }
    },
    {
      "name": "nozk_balance",
      "description": "Check shielded balance across all backends",
      "parameters": {}
    },
    {
      "name": "nozk_compliance_proof",
      "description": "Generate compliance proof for a previous withdrawal",
      "parameters": {
        "withdrawal_id": "string",
        "asp_provider": "string"
      }
    }
  ]
}
```

### 5.3 EIP-7702 Session Keys

For agents that need direct on-chain interaction:

```
  User EOA ──── EIP-7702 delegation ────> NozKash Session Contract
                                           │
                                           ├── Agent session key
                                           │   allowed: [NozkVault.deposit,
                                           │             NozkVault.reveal,
                                           │             NozkVault.redeem]
                                           │   cap: 0.01 ETH/day
                                           │   expires: 24h
                                           │
                                           └── Service session key
                                               allowed: [NozkVault.announce]
                                               cap: unlimited (mint ops)
                                               expires: 7d
```

### 5.4 Data Validation Layer

All agent requests pass through validation before reaching the TEE:

1. **Schema validation**: Type-check parameters, verify address checksums
2. **Semantic validation**: Amount within denomination rules, valid backend
3. **Policy check** (in TEE): Session caps, rate limits, allowlists
4. **Replay protection**: Nonce tracking, deadline enforcement
5. **Sanity checks**: Detect hallucinated addresses (e.g., all-zeros),
   unreasonable amounts, known-bad contracts

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];  // e.g., "large amount, confirm?"
  requiresHumanApproval: boolean; // above policy threshold
}
```

---

## 6. Security Model

### 6.1 Trust Boundaries

```
  ┌─ Untrusted ───────────────────────────────────────────┐
  │                                                        │
  │  AI Agent (LLM) ──> may hallucinate, be manipulated    │
  │  API Gateway ──────> may be compromised                │
  │  Network ──────────> may be intercepted                │
  │                                                        │
  ├─ Trusted (TEE — separate instances per mode) ─────────┤
  │                                                        │
  │  Mint TEE:                                             │
  │    Key Registry ───> mint BLS keys (multi-denom/token) │
  │    Validator ──────> on-chain deposit verification     │
  │    Policy Engine ──> compliance, sanctions screening   │
  │                                                        │
  │  Wallet TEE:                                           │
  │    Key Manager ────> user masterSeed → derived keys    │
  │    Validator ──────> x402, session keys, policy checks │
  │    Policy Engine ──> session caps, tx limits, HITL     │
  │    Privacy Router ─> selects + invokes backends        │
  │                                                        │
  │  (Same code, different config; independent attestation)│
  │                                                        │
  ├─ Verified (Blockchain — multi-chain, multi-curve) ────┤
  │                                                        │
  │  NozkVaultV3 (EVM) ─> BLS12-381 pairing verification  │
  │  Nozk Program (Sol) > BN254 pairing verification      │
  │  Railgun contracts ─> ZK proof verification            │
  │  Privacy Pools ────> ASP + ZK verification             │
  │  EIP-8182 pool ────> protocol-level ZK verification    │
  │                                                        │
  └────────────────────────────────────────────────────────┘
```

### 6.2 Attestation Flow

```
  User/Agent                    NozKash Service            TEE Vendor
      │                              │                        │
      │── "prove you're honest" ────>│                        │
      │                              │── request attestation ->│
      │                              │<── attestation doc ─────│
      │<── attestation + code hash ──│                        │
      │                              │                        │
      │ verify:                      │                        │
      │  1. attestation signature    │                        │
      │  2. PCR values match         │                        │
      │     published code hash      │                        │
      │  3. enclave is genuine       │                        │
```

### 6.3 Threat Model

| Threat | Mitigation |
|--------|------------|
| Compromised API gateway | TEE policy engine rejects out-of-policy requests |
| LLM prompt injection | Data validation + policy caps limit blast radius |
| Malicious mint operator | TEE attestation proves published code runs unmodified |
| Key extraction | TEE isolation — no memory access from host |
| Replay attacks | Nonce tracking + deadline enforcement |
| MEV / frontrunning | BLS spend signature binds recipient (existing NozKash design) |
| Side-channel on TEE | Hardware vendor responsibility; use latest mitigations |
| Compliance subpoena | ASP association proofs (Privacy Pools model) |

---

## 7. Deployment Modes

### 7.1 One Codebase, Separate TEE Instances

All modes run the **same audited code** — a single binary with different
config. Each mode runs in its **own TEE instance** with its own sealed
keys and independent attestation. This gives:

- **Isolation**: Compromising the mint TEE doesn't expose wallet keys
- **Independent attestation**: Users verify each service independently
- **Same audit surface**: One codebase to audit, multiple deployments
- **Config-driven behavior**: Validation strategy selected at startup

```
  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
  │  TEE Instance A   │    │  TEE Instance B   │    │  TEE Instance C   │
  │  config: mint     │    │  config: wallet   │    │  config: custodial│
  │  keys: mint BLS   │    │  keys: user seeds │    │  keys: team keys  │
  │  validation:      │    │  validation:      │    │  validation:      │
  │   on-chain deposit│    │   x402 + session  │    │   API key + policy│
  │  attestation: A   │    │  attestation: B   │    │  attestation: C   │
  └──────────────────┘    └──────────────────┘    └──────────────────┘
         │                        │                        │
         └────── same code hash (verified via attestation) ┘
```

Config determines:
- **Validation strategy**: what triggers signing (on-chain event vs x402 vs API key)
- **Key type**: mint BLS keys vs user-derived wallet keys vs team keys
- **Policy rules**: compliance screening, spending caps, rate limits
- **Chain bindings**: which chains/curves this instance serves

### 7.2 Self-Hosted Non-Custodial Wallet

- Own TEE instance with wallet validation config
- Validation: x402 payments, session key auth, policy engine
- Users verify TEE attestation to confirm code integrity
- Users can export keys (non-custodial)
- Docker Compose / Kubernetes deployment

### 7.3 Mint Service

- Own TEE instance with mint validation config
- Validation: on-chain deposit tx verification
- Watches `DepositLocked` events, verifies deposit, blind-signs, announces
- Users verify via attestation that mint runs published code
- On-chain BLS pairing check is the ultimate verification

### 7.4 Custodial Self-Deployed (Teams)

- Own TEE instance with custodial validation config
- Validation: API key auth + team-configured policies
- Team runs the service for their own agents
- Simplified setup — no external user attestation needed
- Useful for: trading bots, automated treasury, service agents

### 7.5 SaaS (Future)

- Hosted service for developers who don't want to run infrastructure
- Multi-tenant, isolated per-user TEE instances
- x402-based pricing (pay-per-operation)
- Optional: federated model with multiple independent operators

---

## 8. Implementation Roadmap

### Phase 0: Foundation (Weeks 1-6)

**Goal**: Extract existing NozKash components into service architecture,
with multi-denomination + multi-token + multi-curve support.

- [ ] Define `PairingCurve` interface (BLS12-381 + BN254 backends)
- [ ] Define `PrivacyBackend` interface (TypeScript)
- [ ] Extend `nozk-library.ts` with `CurveBackend` abstraction
- [ ] Implement BN254 curve backend (for Solana compatibility)
- [ ] Design NozkVaultV3 contract:
  - Multi-denomination support (configurable per deposit)
  - Multi-mint-key registry: `(token, denomination) → pkMint`
  - ERC-20 token deposits (not just native ETH)
  - Preserve aggregation support (revealAggregated, redeemAggregated)
- [ ] Design Solana program (BN254-based, same protocol logic)
- [ ] Wrap eCash as first `PrivacyBackend` plugin
- [ ] Extract mint server logic into standalone service module
  - Multi-key mint: key registry, per-deposit key selection
- [ ] Define REST API schema (OpenAPI 3.1)
- [ ] Define MCP tool schemas
- [ ] Set up monorepo structure: `service/` directory
- [ ] Generate test vectors for both curves

**Deliverable**: Service skeleton with multi-denom eCash backend,
BLS12-381 + BN254 support, REST API, no TEE yet.

### Phase 1: TEE Integration (Weeks 7-14)

**Goal**: Move key management and signing into AWS Nitro Enclaves.
Separate TEE instances for mint and wallet modes, same codebase.

#### 1.1 TeeBackend Interface + Nitro Implementation

- [ ] Define `TeeBackend` interface (abstract over Nitro/GCP/dev-shim):
  ```typescript
  interface TeeBackend {
    // Key lifecycle
    generateKey(type: "ecdsa" | "bls12-381" | "bn254"): Promise<KeyHandle>;
    sealKey(handle: KeyHandle): Promise<SealedKey>;
    unsealKey(sealed: SealedKey): Promise<KeyHandle>;
    sign(handle: KeyHandle, message: Uint8Array): Promise<Signature>;
    exportPublicKey(handle: KeyHandle): Promise<Uint8Array>;

    // Attestation
    getAttestation(userData: Uint8Array): Promise<AttestationDoc>;
    verifyAttestation(doc: AttestationDoc): Promise<AttestationResult>;

    // Policy
    evaluatePolicy(request: SignRequest, policy: PolicySet): Promise<PolicyDecision>;
  }
  ```
- [ ] Implement `NitroTeeBackend`:
  - Enclave image build pipeline (Docker → EIF via `nitro-cli`)
  - vsock communication between parent EC2 instance and enclave
  - AWS KMS integration with attestation-condition key policies
    (KMS only releases data encryption key to matching PCR values)
  - Key sealing: encrypt key material to KMS data key, store sealed
    blob on parent instance's EBS volume
  - Reproducible builds: deterministic Docker → EIF conversion,
    publish expected PCR0/PCR1/PCR2 values with each release
- [ ] Implement `DevTeeBackend` (software shim for local dev):
  - Same interface, keys in memory (no real isolation)
  - Mock attestation that always returns "valid"
  - Allows full development cycle without AWS hardware

#### 1.2 Key Manager (Inside Enclave)

- [ ] Multi-key registry data structure:
  ```typescript
  interface KeyRegistry {
    // Mint keys: one per (chain, token, denomination)
    mintKeys: Map<string, KeyHandle>;  // key = `${chainId}:${token}:${denom}`

    // Wallet keys: derived from user masterSeed
    deriveWalletKey(masterSeed: Uint8Array, index: number): KeyHandle;
    deriveEcdsaKey(masterSeed: Uint8Array): KeyHandle;
  }
  ```
- [ ] ECDSA (secp256k1) key generation and transaction signing
- [ ] BLS12-381 key generation, sealing, and blind-signature computation
- [ ] BN254 key generation, sealing, and blind-signature computation
- [ ] Master seed import: accept user's `masterSeed` via authenticated
  vsock channel, derive all wallet keys in-enclave
- [ ] Key rotation: generate new mint keys, register on-chain,
  old keys remain valid for existing tokens until redeemed

#### 1.3 Policy Engine (Inside Enclave)

- [ ] Policy configuration schema (YAML/JSON loaded at enclave boot):
  ```yaml
  policies:
    session:
      max_spend_per_session: "0.1 ETH"
      session_ttl: "24h"
    transaction:
      max_value: "0.01 ETH"
      allowed_contracts: ["0x...NozkVaultV3"]
      allowed_functions: ["deposit", "reveal", "redeem"]
    compliance:
      sanctions_list: "https://sanctions.example.com/ofac.json"
      screen_deposit_addresses: true
      screen_recipient_addresses: true
    rate_limit:
      max_per_minute: 10
      max_per_hour: 100
  ```
- [ ] Policy evaluation pipeline:
  1. Parse request (who, what, how much, to whom)
  2. Check session state (cumulative spend, tx count, expiry)
  3. Check transaction rules (amount, contract, function selector)
  4. Check compliance (sanctions screening via cached list)
  5. Check rate limits
  6. Return `ALLOW`, `DENY(reason)`, or `ESCALATE(human approval)`
- [ ] Session state management: in-memory within enclave,
  reset on enclave restart (conservative — sessions don't survive restarts)
- [ ] Compliance list caching: fetch sanctions list on boot,
  periodic refresh via parent instance proxy (enclave has no network)

#### 1.4 Validation Strategies (Inside Enclave)

- [ ] `MintValidator`: receives `DepositLocked` event data via vsock,
  verifies on-chain deposit (correct amount, token, denomination,
  depositId not already announced), runs compliance screening on
  depositor address, then authorizes blind signing
- [ ] `WalletValidator`: receives signing request via vsock,
  verifies authentication (API key, session token, or x402 payment
  proof), runs policy engine, then authorizes signing
- [ ] `CustodialValidator`: simplified — API key auth + policy engine,
  no x402 or session key complexity

#### 1.5 Attestation Endpoint

- [ ] REST endpoint `GET /attestation` on parent instance:
  1. Forwards request to enclave via vsock
  2. Enclave generates Nitro attestation document with user-supplied
     nonce (prevents replay) and public key binding
  3. Returns signed attestation document
- [ ] Verification library (TypeScript + Python):
  - Verify Nitro attestation signature chain (AWS root → enclave)
  - Check PCR values against published release values
  - Extract enclave public key from attestation
- [ ] CI pipeline: on each release, build EIF, compute PCR values,
  publish in release notes and a machine-readable manifest

#### 1.6 Enclave ↔ Parent Communication

- [ ] vsock protocol:
  - Request/response over length-prefixed JSON messages
  - Parent handles: network I/O, RPC calls, event watching, API serving
  - Enclave handles: key management, signing, policy, validation
  - Enclave NEVER receives raw private keys from parent — only
    sealed key blobs (unsealed inside enclave via KMS)
- [ ] Event relay: parent watches on-chain events (`DepositLocked`),
  forwards to enclave via vsock for mint validation
- [ ] Transaction relay: enclave produces signed transactions,
  parent broadcasts to RPC

**Deliverable**: Mint and wallet both running in separate Nitro enclave
instances. Attestation verifiable. Policy engine enforcing rules.
Software dev shim for local development without AWS.

---

### Phase 2: Agentic Interface (Weeks 15-22)

**Goal**: Full agent integration — agents can discover, pay for, and
consume privacy services via x402, MCP, and session keys.

#### 2.1 x402 Facilitator

- [ ] Implement facilitator server (TypeScript, runs on parent instance):
  ```
  POST /facilitator/verify
    Input: PaymentPayload (signed EIP-3009 transferWithAuthorization)
    Checks: signature valid, sender balance sufficient, nonce fresh,
            amount matches requirement
    Output: { valid: true } or { valid: false, reason: "..." }

  POST /facilitator/settle
    Input: verified PaymentPayload
    Action: submit transferWithAuthorization tx on-chain
    Output: { txHash, blockNumber, settled: true }
  ```
- [ ] Supported payment schemes:
  - `exact` (EIP-3009): USDC, EURC on Base/Ethereum/Polygon
  - `permit2`: any ERC-20 via Uniswap Permit2
- [ ] Facilitator fee: configurable, default ~$0.001/tx (0.1 cent)
- [ ] Settlement batching: accumulate multiple payments, settle in
  one tx for gas efficiency (configurable batch window: 1-10 seconds)

#### 2.2 x402 Resource Server (Paid Privacy APIs)

- [ ] Express/Hono middleware wrapping privacy operations:
  ```typescript
  app.post("/v1/ecash/deposit", x402Middleware({
    price: "0.001",  // USDC
    token: USDC_ADDRESS,
    network: "eip155:8453",  // Base
    facilitatorUrl: "/facilitator",
  }), async (req, res) => {
    // Request already paid — execute deposit
    const result = await privacyRouter.deposit(req.body);
    res.json(result);
  });
  ```
- [ ] Paid endpoints:
  - `POST /v1/ecash/blind-sign` — request blind signature (mint mode)
  - `POST /v1/ecash/deposit` — deposit into eCash pool
  - `POST /v1/ecash/reveal` — reveal token
  - `POST /v1/ecash/redeem` — redeem token
  - `POST /v1/privacy/shield` — shield via Railgun (Phase 3)
  - `POST /v1/privacy/transfer` — private transfer (Phase 3)
  - `POST /v1/privacy/unshield` — unshield (Phase 3)
  - `GET /v1/balance` — shielded balance across backends
  - `GET /v1/attestation` — TEE attestation document
- [ ] Free endpoints (no x402):
  - `GET /v1/health` — service health
  - `GET /v1/supported` — supported tokens, denominations, chains, curves
  - `GET /v1/fees` — current fee schedule

#### 2.3 x402 Client Library

- [ ] Fetch wrapper that auto-handles 402 responses:
  ```typescript
  import { nozkFetch } from "@nozk/client";

  // Automatically detects 402 → signs payment → retries
  const result = await nozkFetch("https://service.example/v1/ecash/deposit", {
    wallet,  // TEE-backed or local wallet for payment signing
    body: { depositId, blindedToken, token: "ETH", denomination: "0.001" },
  });
  ```
- [ ] AgentKit-compatible tool wrapper:
  ```typescript
  const tools = nozkAgentTools(wallet, serviceUrl);
  // Returns LangChain/OpenAI/MCP compatible tool definitions
  ```

#### 2.4 MCP Server

- [ ] MCP server exposing NozKash operations as tools:
  ```json
  {
    "name": "nozk_deposit",
    "description": "Deposit tokens into NozKash privacy pool",
    "inputSchema": {
      "type": "object",
      "properties": {
        "token": { "type": "string", "enum": ["ETH", "USDC", "DAI"] },
        "denomination": { "type": "string", "enum": ["0.001", "0.01", "0.1", "1"] },
        "chain": { "type": "string", "default": "ethereum" },
        "backend": { "type": "string", "enum": ["ecash", "railgun", "privacy_pools", "auto"] },
        "count": { "type": "integer", "default": 1, "description": "Number of tokens to deposit" }
      },
      "required": ["token", "denomination"]
    }
  }
  ```
- [ ] Full tool set:
  - `nozk_deposit` — deposit into privacy pool
  - `nozk_scan` — scan chain for owned tokens (stateless recovery)
  - `nozk_reveal` — reveal token (prepare for redemption)
  - `nozk_redeem` — redeem token to recipient address
  - `nozk_balance` — shielded balance across all backends
  - `nozk_transfer` — private transfer (Railgun/EIP-8182, Phase 3+)
  - `nozk_compliance_proof` — generate compliance proof (opt-in)
  - `nozk_status` — service health, supported tokens, fees
- [ ] MCP resource: expose wallet state as a readable resource
  (balance, token list, pending operations)
- [ ] MCP confirmation flow: high-value operations trigger
  user confirmation via MCP's built-in confirmation mechanism

#### 2.5 EIP-7702 Session Key Contract

- [ ] `NozkSessionManager.sol`:
  ```solidity
  struct SessionKey {
      address key;              // session key address
      uint256 spendLimit;       // max cumulative spend
      uint256 perTxLimit;       // max per-transaction
      address[] allowedContracts;
      bytes4[] allowedSelectors; // function selectors
      uint256 expiry;           // unix timestamp
      uint256 spent;            // cumulative spend tracker
  }

  function createSession(SessionKey calldata params) external;
  function revokeSession(address key) external;
  function validateCall(address key, address to, uint256 value, bytes calldata data) external view returns (bool);
  ```
- [ ] EIP-7702 integration: user's EOA delegates to `NozkSessionManager`,
  then the session key can sign NozKash operations within limits
- [ ] Pre-built session templates:
  - `AGENT_BASIC`: deposit + redeem, 0.01 ETH/day, 24h expiry
  - `AGENT_POWER`: all NozKash ops, 0.1 ETH/day, 7d expiry
  - `MINT_OPERATOR`: announce only, unlimited, 30d expiry
- [ ] Compatible with ERC-4337 UserOperations (session key as signer)

#### 2.6 Data Validation Layer

- [ ] Request validation pipeline (runs on parent, before forwarding to TEE):
  1. **Schema validation**: JSON schema check on all parameters
  2. **Address validation**: EIP-55 checksum, not zero address,
     not known-bad (burn addresses, precompiles)
  3. **Amount validation**: within denomination set, not zero,
     not exceeding reasonable bounds
  4. **Chain validation**: supported chain, correct curve
  5. **Replay protection**: request nonce + deadline, dedup cache
- [ ] TEE-side validation (inside enclave, after parent validation):
  1. Policy engine evaluation (see Phase 1.3)
  2. Sanctions screening (compliance layer)
- [ ] Hallucination detection heuristics:
  - Flag all-zero addresses
  - Flag amounts that are exact round numbers (possible hallucination)
  - Flag unknown contract addresses (not in allowlist)
  - Flag requests to self (circular transfers)
- [ ] Human-in-the-loop escalation:
  - Configurable threshold (default: operations > 1 ETH equivalent)
  - Webhook notification to operator (Slack, email, Telegram)
  - Request paused until operator approves/rejects via API
  - Timeout: auto-reject after configurable window (default: 1 hour)

**Deliverable**: Complete agentic interface. Agents can discover the
service, pay via x402, invoke operations via MCP/REST, authenticate
via session keys, with full validation and human escalation.

---

### Phase 3: Privacy Backends (Weeks 23-32)

**Goal**: Integrate Railgun and Privacy Pools as additional privacy
backends behind the `PrivacyBackend` interface. Build the privacy
router for automatic backend selection.

#### 3.1 Railgun Integration

- [ ] Install `@railgun-community/wallet` SDK (or Kohaku wrapper
  `kohaku-eth/railgun` if stable)
- [ ] Implement `RailgunBackend implements PrivacyBackend`:
  ```typescript
  class RailgunBackend implements PrivacyBackend {
    name = "railgun";
    supportedTokens = [/* any ERC-20 */];
    complianceModel = "ppoi";  // Private Proof of Innocence

    async deposit(params) {
      // 1. Approve token spend to RailgunSmartWallet
      // 2. Call shield() with recipient's 0zk address
      // 3. Wait for commitment to appear in Merkle tree
      // 4. Return deposit receipt
    }

    async transfer(params) {
      // 1. Build UTXO transaction (select input notes, create outputs)
      // 2. Generate Groth16 ZK proof (client-side, 10-60s)
      // 3. Submit via ERC-4337 relayer (Kohaku) or direct
      // 4. Return transfer receipt
    }

    async withdraw(params) {
      // 1. Build unshield transaction
      // 2. Generate ZK proof
      // 3. Submit — tokens sent to public recipient address
      // 4. Return withdrawal receipt
    }
  }
  ```
- [ ] Proving key management:
  - Download and cache Railgun proving keys (~50-100 MB)
  - Store on parent instance filesystem (not in TEE — too large)
  - Proof generation runs on parent instance (CPU-intensive)
  - Only the signing step touches the TEE
- [ ] 0zk address support:
  - Derive Railgun viewing/spending keys from user's `masterSeed`
  - Generate 0zk receiving addresses for private transfers
  - Scan Merkle tree for owned notes (balance computation)
- [ ] Private DeFi hooks (stretch):
  - Use `@railgun-community/cookbook` for swap-and-shield recipes
  - Expose as additional MCP tools: `nozk_private_swap`, etc.
- [ ] PPOI (Private Proof of Innocence) integration:
  - Generate exclusion proofs showing funds aren't from flagged sources
  - Automatic if Railgun SDK provides it; manual integration otherwise

#### 3.2 Privacy Pools Integration

- [ ] Implement `PrivacyPoolsBackend implements PrivacyBackend`:
  ```typescript
  class PrivacyPoolsBackend implements PrivacyBackend {
    name = "privacy_pools";
    supportedTokens = [/* ETH + major ERC-20 */];
    complianceModel = "asp";

    async deposit(params) {
      // 1. Generate commitment: hash(secret, nullifier)
      // 2. Call deposit() on Privacy Pools contract with msg.value
      // 3. Store secret + nullifier locally (derived from masterSeed)
      // 4. Return deposit receipt with commitment index
    }

    async withdraw(params) {
      // 1. Select association set from ASP provider
      // 2. Generate standard ZK proof (Tornado-style: valid deposit, unused nullifier)
      // 3. Generate ASP membership proof (deposit in approved set)
      // 4. Submit both proofs to contract
      // 5. Return withdrawal receipt
    }

    async generateComplianceProof(params) {
      // 1. Fetch latest association set from configured ASP
      // 2. Generate ZK proof of membership
      // 3. Return proof bundle (can be shared with counterparties)
    }
  }
  ```
- [ ] ASP provider integration:
  - Configurable ASP endpoint (default: 0xbow's public ASP)
  - Fetch association set Merkle trees
  - Cache association sets locally (refresh on configurable interval)
  - Support multiple ASPs (user selects which to use)
- [ ] Ragequit support: if deposit is excluded from ASP's approved set,
  provide a UI/API path for public fund recovery
- [ ] Commitment derivation from `masterSeed`:
  - Derive Privacy Pools secrets deterministically from user's seed
  - Same stateless recovery model as eCash: scan chain, re-derive

#### 3.3 Privacy Router

- [ ] Backend selection logic:
  ```typescript
  function selectBackend(request: PrivacyRequest): PrivacyBackend {
    // 1. Filter backends that support the requested token
    const eligible = backends.filter(b =>
      b.supportedTokens.includes(request.token));

    // 2. If compliance proof needed → prefer Privacy Pools
    if (request.requireCompliance) {
      return eligible.find(b => b.complianceModel === "asp")
        ?? eligible[0];
    }

    // 3. If fixed denomination + ETH + prefer cost → eCash
    if (request.token === "ETH"
        && ECASH_DENOMS.includes(request.amount)
        && request.preferCost) {
      return eligible.find(b => b.name === "ecash") ?? eligible[0];
    }

    // 4. If arbitrary amount or DeFi interaction → Railgun
    if (request.amount > 0 || request.operation === "swap") {
      return eligible.find(b => b.name === "railgun") ?? eligible[0];
    }

    // 5. Default: let user choose (return options)
    throw new BackendSelectionRequired(eligible);
  }
  ```
- [ ] Cost estimation per backend:
  - Pre-compute gas estimates for each backend per operation
  - Include proof generation time estimates
  - Return comparison to caller: "eCash: ~50k gas, 0.1s | Railgun: ~350k gas, 30s"
- [ ] User preference storage:
  - Remember user's preferred backend per token/operation
  - Configurable default via service config
- [ ] Fallback logic: if preferred backend fails (e.g., Railgun relayer
  down), suggest alternative with reason

#### 3.4 Kohaku SDK Integration (When Stable)

- [ ] Monitor `ethereum/kohaku` repo for stable releases
- [ ] When ready, wrap Kohaku's unified interface as a meta-backend:
  - Kohaku already abstracts over Railgun, Privacy Pools, etc.
  - Our `PrivacyBackend` implementations may simplify to thin wrappers
- [ ] ERC-4337 relaying via Kohaku's operational mempool integration
- [ ] Per-dapp address isolation if Kohaku provides it
- [ ] ERC-7811 privacy-preserving asset discovery

#### 3.5 Cross-Backend Operations

- [ ] `compose` endpoint for multi-step privacy operations:
  ```
  POST /v1/privacy/compose
  {
    "steps": [
      { "backend": "ecash", "op": "redeem", "index": 5, "to": "$SELF" },
      { "backend": "railgun", "op": "shield", "token": "ETH", "amount": "0.001" },
      { "backend": "railgun", "op": "swap", "from": "ETH", "to": "USDC", "private": true },
      { "backend": "privacy_pools", "op": "deposit", "token": "USDC", "amount": "1" }
    ]
  }
  ```
  Note: cross-backend steps are public between backends (withdraw from
  one, deposit to another). The compose endpoint orchestrates the
  sequence but doesn't provide cross-backend privacy.

**Deliverable**: Three privacy backends (eCash, Railgun, Privacy Pools)
behind unified interface. Privacy router for automatic selection.
Compliance proofs via Privacy Pools ASP. Private DeFi via Railgun.

---

### Phase 4: Production Hardening (Weeks 33-42)

**Goal**: Production-ready self-hosted deployment with monitoring,
documentation, security audit, and operational tooling.

#### 4.1 Deployment Infrastructure

- [ ] Docker Compose template for single-machine deployment:
  ```yaml
  services:
    nozk-mint-enclave:
      build: ./enclave
      environment:
        - NOZK_MODE=mint
        - NOZK_CHAINS=eip155:1,eip155:8453
      # Nitro enclave launched via nitro-cli from parent
    nozk-wallet-enclave:
      build: ./enclave
      environment:
        - NOZK_MODE=wallet
        - NOZK_CHAINS=eip155:1,eip155:8453
    nozk-gateway:
      build: ./gateway
      ports:
        - "443:443"
      depends_on:
        - nozk-mint-enclave
        - nozk-wallet-enclave
    postgres:
      image: postgres:16
      # Session state, request logs, fee accounting
    redis:
      image: redis:7
      # Rate limiting, caching, request dedup
  ```
- [ ] Kubernetes Helm chart:
  - StatefulSet for enclave instances (persistent sealed key storage)
  - Deployment for gateway (stateless, horizontally scalable)
  - ConfigMap for policies and chain configs
  - Secret for API keys and KMS references
  - NetworkPolicy: enclave pods accept only vsock from gateway
  - HPA for gateway based on request rate
- [ ] Terraform modules for AWS infrastructure:
  - EC2 instances with Nitro Enclave support (e.g., c5.xlarge)
  - KMS keys with attestation-condition policies
  - VPC, security groups, ALB
  - S3 for sealed key backup (encrypted)

#### 4.2 Monitoring and Alerting

- [ ] Prometheus metrics (exported by gateway):
  - `nozk_requests_total{mode, backend, operation, status}`
  - `nozk_request_duration_seconds{mode, backend, operation}`
  - `nozk_signing_duration_seconds{curve, operation}`
  - `nozk_policy_decisions_total{decision}` (allow/deny/escalate)
  - `nozk_x402_payments_total{scheme, status}`
  - `nozk_x402_revenue_usd_total`
  - `nozk_enclave_uptime_seconds{mode}`
  - `nozk_key_registry_size{chain, curve}`
- [ ] Grafana dashboards:
  - Service overview (request rate, latency, error rate)
  - Revenue dashboard (x402 payments, fees collected)
  - Privacy backend comparison (usage, gas costs, latency)
  - Compliance dashboard (sanctions hits, escalations)
  - Enclave health (uptime, attestation freshness)
- [ ] Alerting rules:
  - Enclave down > 1 minute
  - Error rate > 5% over 5 minutes
  - Sanctions screening hit (immediate notification)
  - Policy escalation pending > 15 minutes (no human response)
  - Attestation PCR mismatch (critical — potential tampering)
  - x402 settlement failure

#### 4.3 Key Rotation and Lifecycle

- [ ] Mint key rotation procedure:
  1. Generate new BLS keypair inside enclave
  2. Register new `pkMint` on-chain for the (token, denomination)
  3. Old key remains valid for existing unrevealed tokens
  4. New deposits use new key
  5. After all old tokens are redeemed/expired, decommission old key
- [ ] Wallet key rotation: not applicable (deterministic from masterSeed)
- [ ] API key rotation: standard rotate-and-invalidate with grace period
- [ ] KMS key rotation: follow AWS KMS automatic rotation (yearly)
- [ ] Sealed key migration: procedure for moving sealed keys to new
  enclave instance (re-seal to new enclave identity)

#### 4.4 Disaster Recovery

- [ ] Enclave failure recovery:
  1. Launch new enclave instance with same EIF (same PCR values)
  2. Unseal keys from KMS-encrypted backup (requires matching PCR)
  3. Resume operation — sessions reset but keys preserved
- [ ] Region failover: replicate sealed key backups to secondary region
- [ ] Data backup: PostgreSQL WAL streaming to S3 for session/log data
- [ ] Recovery time objective (RTO): < 15 minutes for single enclave
- [ ] Recovery point objective (RPO): zero for key material (sealed backup),
  < 1 minute for session state (Redis AOF)

#### 4.5 Security Audit

- [ ] Scope:
  - TEE enclave code (key manager, policy engine, validators)
  - NozkVaultV3 smart contract (multi-denomination, multi-key)
  - Solana program (BN254 variant)
  - API gateway and x402 facilitator
  - Session key contract (NozkSessionManager)
  - vsock protocol and message handling
- [ ] Estimated cost: $50k-150k depending on scope and firm
  (Trail of Bits, OpenZeppelin, Zellic, Spearbit are relevant firms)
- [ ] Timing: engage auditor at start of Phase 4, audit runs concurrent
  with deployment infrastructure work
- [ ] Bug bounty: set up Immunefi program after audit completes

#### 4.6 Performance Benchmarks

- [ ] Baseline metrics to establish:
  - Blind signature latency (target: < 10ms in enclave)
  - Policy evaluation latency (target: < 5ms)
  - x402 verify + settle round-trip (target: < 2s on Base)
  - MCP tool invocation round-trip (target: < 500ms excl. on-chain)
  - Railgun proof generation (target: document, can't optimize — SDK)
  - Throughput: signatures/second per enclave instance
- [ ] Load testing: simulate agent traffic (100+ concurrent sessions)
- [ ] Gas benchmarks per operation per backend per chain

#### 4.7 Documentation

- [ ] **Operator guide**: deploy, configure, monitor, rotate keys, DR
- [ ] **Agent developer guide**: x402 integration, MCP tools, session
  keys, privacy backend selection, compliance proofs
- [ ] **Wallet developer guide**: client SDK, PairingCurve interface,
  integrating into existing wallets
- [ ] **Security model**: trust boundaries, attestation verification,
  threat model, what-to-trust guide for end users
- [ ] **API reference**: OpenAPI 3.1 spec, MCP tool schemas, x402 headers

#### 4.8 Google Cloud Confidential Space Support

- [ ] Implement `GcpTeeBackend`:
  - Google Confidential Space workload deployment
  - OIDC-based attestation via Google Cloud Attestation service
  - KMS integration with attestation-condition key policies
  - Docker workload identity
- [ ] Test parity: all tests pass on both Nitro and GCP backends
- [ ] Documentation: deployment guide for GCP (parallel to AWS guide)

**Deliverable**: Audited, documented, production-ready service deployable
on AWS (Nitro) and GCP (Confidential Space). Full monitoring, alerting,
key rotation, and disaster recovery procedures.

---

### Phase 5: EIP-8182, Federation, and Advanced Features (Post-Production)

**Goal**: Integrate protocol-native privacy, enable federated mints,
expand to SaaS model, and prepare for post-quantum transition.

#### 5.1 EIP-8182 Integration (When Hegota Ships)

- [ ] Implement `Eip8182Backend implements PrivacyBackend`:
  - Wrap the protocol-level system contract at fixed address
  - Deposit: send ETH/ERC-20 to shielded pool
  - Transfer: private note-to-note transfer (UTXO model)
  - Withdraw: unshield to public address
  - Atomic shield-interact-reshield: private DeFi in one tx
- [ ] ZK proof delegation: EIP-8182 separates authorization from proof
  generation. User signs in wallet, TEE delegates proof generation
  to remote prover (or computes locally if fast enough)
- [ ] Compliance: integrate with EIP-8182's authorization policy registry
  (protocol-level compliance, not app-level)
- [ ] Update privacy router: EIP-8182 becomes preferred backend for
  arbitrary-amount transfers on Ethereum mainnet (lowest gas via
  protocol precompile, largest anonymity set)

#### 5.2 Federated Mint via Multi-Blind-Signatures

- [ ] **Threshold BLS blind signatures** across independent TEE operators:
  ```
  Operator A (TEE)     Operator B (TEE)     Operator C (TEE)
       │                    │                    │
       │ partial blind sig  │ partial blind sig  │ partial blind sig
       │  S'_a = sk_a * B   │  S'_b = sk_b * B   │  S'_c = sk_c * B
       └────────┬───────────┴────────┬───────────┘
                │    aggregate (2-of-3 threshold)
                ▼
         S' = combine(S'_a, S'_b)   (any 2 of 3 suffice)
  ```
- [ ] Distributed key generation (DKG) for mint BLS keys:
  - Each operator generates a key share in their TEE
  - Shares combine to produce a joint public key
  - No operator holds the full private key
  - Joint `pkMint` registered on-chain
- [ ] Federation protocol:
  - Operator discovery: on-chain registry of operator TEE attestations
  - Deposit routing: user's deposit event broadcast to all operators
  - Threshold signing: client collects partial signatures from t-of-n
    operators, aggregates, and receives final blind signature
  - Liveness: only need threshold (e.g., 2 of 3) operators online
- [ ] Economic model:
  - Operators stake collateral (slashable for misbehavior)
  - Fee split among participating operators
  - Operator reputation based on uptime and response time
- [ ] Benefits over single-operator:
  - No single point of trust (even if one TEE is compromised)
  - Censorship resistance (threshold of operators must collude)
  - Geographic distribution for latency and jurisdiction diversity

#### 5.3 SaaS Multi-Tenant Mode

- [ ] Tenant isolation:
  - Separate KMS keys per tenant
  - Separate policy configurations
  - Shared enclave code (same PCR values for all tenants)
  - Tenant routing at API gateway layer
- [ ] Tenant onboarding:
  - Self-service API: create tenant, configure chains, set policies
  - Dashboard: usage, fees, compliance events
- [ ] Billing:
  - x402-based metering (pay-per-operation)
  - Monthly invoice option for enterprise tenants
  - Free tier: 1,000 operations/month on testnet

#### 5.4 Cross-Chain Privacy

- [ ] Bridge shielded balances between EVM chains:
  - Burn eCash token on chain A (reveal + mark as bridged)
  - Mint equivalent eCash token on chain B (with bridge attestation)
  - Bridge attestation: TEE signs a message proving the burn on chain A,
    chain B's contract verifies the TEE attestation
- [ ] Solana ↔ EVM bridge:
  - More complex due to different curves (BN254 vs BLS12-381)
  - Curve-agnostic bridge: burn on one curve, re-mint on other
  - Bridge TEE holds keys for both curves
- [ ] Trust model: bridge adds the bridge TEE as an additional trust
  assumption. Users must trust both the source-chain mint and the bridge.

#### 5.5 Advanced Compliance

- [ ] Multi-ASP support:
  - User can select from multiple Association Set Providers
  - Different ASPs for different jurisdictions (US, EU, APAC)
  - Composite proofs: "my funds are clean according to ASP_A AND ASP_B"
- [ ] EIP-8182 authorization policy registry integration:
  - When available, register NozKash compliance policies in the
    protocol-level registry
  - Interoperable compliance across all EIP-8182 users
- [ ] Travel Rule compliance layer:
  - Off-chain data exchange between CASPs (via TRISA/Notabene)
  - Privacy-preserving: on-chain transaction is private,
    compliance data shared off-chain only between sender/receiver CASPs
  - TEE generates Travel Rule data package inside enclave,
    encrypted to receiver CASP's key

#### 5.6 Post-Quantum Key Migration

- [ ] Monitor Kohaku's post-quantum signature work (Falcon/Dilithium)
- [ ] When available:
  - Add post-quantum signature scheme to TEE key manager
  - Dual-sign: classical (BLS/ECDSA) + post-quantum during transition
  - Gradually migrate to PQ-only as ecosystem supports it
- [ ] Timeline: likely 2028+ before PQ is urgent for blockchain

**Deliverable**: Federated mints, protocol-native privacy (EIP-8182),
cross-chain bridges, SaaS mode, advanced compliance, PQ readiness.

---

## 9. Open Questions

All architecture questions resolved as of 2026-06-02.

### Architecture (Resolved)

1. **TEE vendor**: **AWS Nitro first.** Define a `TeeBackend` interface
   but only implement Nitro initially. Google Cloud Confidential Space
   (AMD SEV-SNP based Confidential VMs with OIDC attestation) is the
   secondary target when needed. Intel TDX via Dstack as tertiary.

2. **TEE-only, no MPC.** Our `masterSeed → (index)` derivation model
   makes MPC unnecessary — key recovery = seed backup. TEE-only is
   simpler and lower latency. If federation comes later, use
   **multi-blind-signatures** (threshold BLS across TEE operators)
   rather than MPC key splitting.

3. **Separate TEE instances per mode.** Same audited code, different
   configs. Mint TEE holds mint BLS keys, wallet TEE holds user-derived
   keys. Independent attestation. Isolation prevents cross-compromise.

### Privacy (Resolved)

4. **Multi-denomination + multi-token + multi-mint-key.** Each
   (token, denomination, chain) tuple gets a dedicated BLS keypair.
   Powers-of-10 denominations. ERC-20 support. NozkVaultV3 contract.

4b. **BLS12-381 / BN254 curve abstraction.** BLS12-381 primary (EVM),
   BN254 for Solana and EVM fallback. Solana BLS12-381 via SIMD-0388
   landing Q3 2026 (Alpenglow).

5. **Anonymity sets per-chain, per-backend.** No cross-backend
   unification — the crypto primitives are incompatible. Users can
   manually move funds between backends (withdraw + re-deposit).
   Long-term research direction only.

6. **Two-layer compliance.** Mint-side: sanctions screening default ON
   (protects operator). User-side: compliance proofs (Privacy Pools ASP)
   opt-in (respects privacy).

### Business (Resolved)

7. **Pricing: gas + fixed fee.** Self-hosted: zero margin (gas only).
   SaaS/facilitator: gas + ~$0.001 per operation (~0.1¢ target, vs
   Coinbase CDP at ~0.5¢). Free tier for testnet/dev.

8. **Federation: Phase 5.** Single operator first. When federation
   comes, use multi-blind-signatures (threshold BLS across independent
   TEE operators) rather than MPC.

9. **Regulatory: non-custodial is the way.** Build with user-controlled
   keys (TEE attestation + key export). Get legal opinion before Phase 4
   production launch.

   **Legal cost estimate** (ballpark):
   - Regulatory opinion (non-custodial classification): $10k-25k
     (crypto-specialized firm, covers US MSB + EU MiCA analysis)
   - Per-state MTL if needed (US): $5k-20k/state — but non-custodial
     wallets are generally exempt from MTL requirements
   - Full MiCA CASP authorization (EU, if needed): $50k-150k+
   - **Recommended minimum**: $15k-30k for an initial legal opinion
     covering US + EU to confirm non-custodial exemption
   - **Timeline**: Start legal engagement in Phase 3, have opinion
     before Phase 4 production launch
   - MiCA deadline: July 1, 2026 — after this date, unlicensed CASPs
     serving EU clients face fines up to EUR 5M or 3% of annual turnover

---

## 10. Research References

Detailed technical documentation in `docs/research/`:

| Document | Topic |
|----------|-------|
| [x402-protocol.md](x402-protocol.md) | x402 payment protocol spec, facilitator model, SDK ecosystem |
| [coinbase-cdp-agentic-wallets.md](coinbase-cdp-agentic-wallets.md) | Coinbase CDP architecture, MPC+TEE, AgentKit, policy engine |
| [eip-8182-native-privacy.md](eip-8182-native-privacy.md) | EIP-8182 shielded pool, ZK precompile, Hegota timeline |
| [privacy-pools.md](privacy-pools.md) | Privacy Pools ASP model, compliance proofs, ragequit |
| [railgun-privacy.md](railgun-privacy.md) | Railgun SDK, shielded balances, Kohaku integration |
| [tee-wallet-architectures.md](tee-wallet-architectures.md) | TEE options (Nitro/TDX/SEV), patterns, non-custodial model |
| [agentic-wallet-standards.md](agentic-wallet-standards.md) | EIP-7702, ERC-4337, session keys, MCP, Kohaku framework |

### External Resources

- [x402 Protocol](https://github.com/coinbase/x402) — GitHub repo + spec
- [Coinbase AgentKit](https://github.com/coinbase/agentkit) — Open-source agent SDK
- [Coinbase cb-mpc](https://github.com/coinbase/cb-mpc) — Open-source MPC library
- [Privacy Pools Docs](https://docs.privacypools.com/) — Protocol documentation
- [Railgun Wiki](https://docs.railgun.org/wiki) — Technical documentation
- [Railgun Wallet SDK](https://github.com/Railgun-Community/wallet) — TypeScript SDK
- [Kohaku](https://github.com/ethereum/kohaku) — Ethereum Foundation privacy framework
- [EIP-8182](https://eip8182.com) — Full spec + reference implementation
- [EIP-7702](https://eip7702.io/) — Account delegation overview
- [OpenSigner](https://www.openfort.io/blog/non-custodial-wallet-infrastructure-open-beats-closed) — Self-hostable key management
- [Buterin et al. 2023](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4563364) — Privacy Pools paper (SSRN)
