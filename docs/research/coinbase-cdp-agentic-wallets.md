---
title: "Coinbase CDP Agentic Wallets — TEE + MPC Non-Custodial Architecture"
type: research
status: draft
date: 2026-06-02
relevance: core — reference architecture for our agentic wallet service
sources:
  - https://docs.cdp.coinbase.com/wallets/non-custodial-wallets/overview
  - https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets
  - https://eco.com/support/en/articles/14845485-coinbase-agentic-wallets-explained
  - https://github.com/coinbase/agentkit
  - https://docs.cdp.coinbase.com/agent-kit/welcome
  - https://www.coinbase.com/developer-platform/products/wallets
---

# Coinbase CDP Agentic Wallets

## Overview

Coinbase shipped **Agentic Wallets** on February 11, 2026 — MPC-secured
wallets designed for autonomous AI agents. Each wallet is a CDP Server
Wallet v2 account with keys split via MPC and held inside AWS Nitro Enclaves.

## Architecture

### Key Management: MPC + TEE Hybrid

```
  Agent (LLM)          CDP API              AWS Nitro Enclave
      |                   |                        |
      |-- sign request -->|                        |
      |                   |-- policy check ------->|
      |                   |   (session caps,       |
      |                   |    tx limits,          |
      |                   |    contract allowlist) |
      |                   |                        |
      |                   |   EC-DKG key shares    |
      |                   |   + threshold ECDSA    |
      |                   |   over secp256k1       |
      |                   |                        |
      |                   |<-- MPC signature ------|
      |<-- signed tx -----|                        |
```

**cb-mpc** (open-source Coinbase MPC library):
- Elliptic Curve Distributed Key Generation (EC-DKG)
- Threshold ECDSA over secp256k1
- Schnorr signing over Curve25519
- Key shares split between Coinbase and operator's CDP project
- Below threshold, no signature is possible

**AWS Nitro Enclave properties:**
- Isolated VM with no persistent storage
- No operator login (not even Coinbase can access)
- Attestation document proves code identity
- Raw key material never reconstituted in plaintext on a normal host

### Non-Custodial Guarantees

1. **TEE isolation**: Coinbase infrastructure cannot extract private keys
2. **MPC threshold**: Neither party alone can sign
3. **Attestation**: Cryptographic proof of enclave code identity
4. **Policy enforcement**: User-defined rules enforced inside enclave
5. **Key export**: Users can export their private keys (ultimate control)

### Policy Engine

Policies enforced inside the enclave before any signature:
- **Session caps**: Maximum amount an agent can spend per session
- **Per-transaction limits**: Individual transaction size caps
- **Contract allowlists**: Which contracts the agent may interact with
- **Time windows**: When signing is allowed
- **Rate limiting**: Max transactions per time period

Keys never leave the enclave; the policy engine checks requests against
configured rules before producing the MPC signature.

## AgentKit Framework

AgentKit is the open-source skills framework on top of Agentic Wallets:

**Skill modules**: authenticate, fund, send, trade, earn

**LLM integrations**:
- LangChain tool definitions
- OpenAI function calling
- Claude MCP tools
- Any agent framework via REST API

**SDK shape** (TypeScript):
```typescript
import { CdpClient } from "@coinbase/cdp-sdk";

const cdp = new CdpClient();

// Create a wallet (keys generated in TEE)
const account = await cdp.evm.createAccount();

// Sign a message
const signature = await cdp.evm.signMessage({
  address: account.address,
  message: "hello",
});

// Send a transaction
const txHash = await cdp.evm.sendTransaction({
  address: account.address,
  transaction: {
    to: "0x...",
    value: parseEther("0.01"),
    chainId: 8453, // Base
  },
});
```

**Python SDK** (AgentKit 0.2.0):
```python
from coinbase_agentkit import AgentKit

kit = AgentKit()
wallet = kit.create_wallet()
tx = wallet.send(to="0x...", value="0.01", chain_id=8453)
```

## x402 Integration

Native x402 support built in — when an agent encounters a 402 response:
1. AgentKit middleware intercepts the 402
2. Reads payment requirements from `PAYMENT-REQUIRED` header
3. Constructs `transferWithAuthorization` (EIP-3009) message
4. Signs via CDP wallet (MPC in TEE)
5. Retries request with `PAYMENT-SIGNATURE` header
6. Facilitator verifies and settles on-chain

Gasless settlement on Base via paymaster.

## Supported Chains

EVM: Base, Ethereum, Arbitrum, Polygon, Optimism
Non-EVM: Solana (mainnet + devnet)
Testnets: Base Sepolia, Ethereum Sepolia, Solana Devnet

## Competitive Landscape (2026)

| Service | Key Management | Self-Hostable | Open Source |
|---------|---------------|---------------|-------------|
| Coinbase CDP | MPC + TEE (Nitro) | No (SaaS) | AgentKit yes, infra no |
| Privy | TEE + key sharding | No | No |
| Turnkey | TEE | No | No |
| Fireblocks | MPC + TEE | No | No |
| OpenSigner (Openfort) | TEE | **Yes** | **Yes** |
| Lit Protocol | Distributed TEE | Partial | Yes |

## Relevance to NozKash

Our service differentiates by being:
1. **Self-hostable** — unlike Coinbase/Privy/Turnkey
2. **Privacy-native** — built-in eCash + pluggable privacy solutions
3. **Mint-capable** — same TEE can run the NozKash mint service
4. **Open-source** — full stack auditable, not just the agent SDK
