---
title: "x402 Protocol — HTTP-Native Machine-to-Machine Payments"
type: research
status: draft
date: 2026-06-02
relevance: core — payment layer for agentic wallet service
sources:
  - https://github.com/coinbase/x402
  - https://docs.cdp.coinbase.com/x402/welcome
  - https://blog.cloudflare.com/x402/
  - https://docs.stripe.com/payments/machine/x402
  - https://solana.com/x402/what-is-x402
---

# x402 Protocol

## Overview

x402 is an open standard for internet-native payments built on HTTP 402
(Payment Required). Launched by Coinbase in May 2025, it enables
machine-to-machine micropayments — primarily for AI agents paying for API
access, data services, and computational resources.

Key partners: **Cloudflare**, **Circle**, **Stripe**, **AWS**, **Solana**.
An x402 Foundation was launched jointly with Cloudflare.

## Payment Flow (12-Step)

```
 Client                    Resource Server              Facilitator         Blockchain
   |                             |                          |                   |
   |--- 1. HTTP GET /resource -->|                          |                   |
   |<-- 2. 402 + PAYMENT-REQUIRED header (base64 JSON) ----|                   |
   |                             |                          |                   |
   | 3. Select PaymentRequirement, construct PaymentPayload |                   |
   | 4. Sign payment (EIP-3009 transferWithAuthorization)   |                   |
   |                             |                          |                   |
   |--- 5. HTTP GET /resource + PAYMENT-SIGNATURE header -->|                   |
   |                             |--- 6. POST /verify ----->|                   |
   |                             |    (validate signature,  |                   |
   |                             |     balance, nonce)      |                   |
   |                             |<-- 7. verify result -----|                   |
   |                             |                          |                   |
   |                             |--- 8. POST /settle ----->|                   |
   |                             |                          |--- 9. submit tx ->|
   |                             |                          |<- 10. confirm ----|
   |                             |<-- 11. settlement resp --|                   |
   |<-- 12. 200 OK + PAYMENT-RESPONSE header + body -------|                   |
```

## Key Headers

| Header | Direction | Content |
|--------|-----------|---------|
| `PAYMENT-REQUIRED` | Server -> Client (in 402) | Base64-encoded `PaymentRequired` object with price, token, chain, facilitator URL, recipient |
| `PAYMENT-SIGNATURE` | Client -> Server (retry) | Base64-encoded `PaymentPayload` with signed authorization |
| `PAYMENT-RESPONSE` | Server -> Client (in 200) | Base64-encoded settlement response with tx hash |

## Schemes and Networks

**Schemes** (logical payment methods):
- `exact` — fixed amount (EIP-3009 `transferWithAuthorization` for USDC/EURC)
- `permit2` — any ERC-20 token via Uniswap Permit2

**Networks** (blockchain implementations):
- EVM: Base (`eip155:8453`), Polygon, Arbitrum, World — identified by CAIP-2
- Solana: SVM support
- Stellar: support via x402 foundation

Same scheme requires different technical implementations across chains.

## Facilitator Model

The facilitator is a trusted intermediary that:
1. **Verifies** payment authorizations (signature, balance, nonce)
2. **Settles** payments on-chain (submits the `transferWithAuthorization` tx)
3. **Batches** multiple payments for gas efficiency

Coinbase CDP facilitator pricing: 1,000 free/month, then $0.001/tx.

**Trust minimization**: All payment schemes must NOT allow the facilitator
or resource server to move funds other than in accordance with client
intentions. The signed authorization binds amount + recipient.

Anyone can run a facilitator — the protocol is open.

## SDK Ecosystem

**TypeScript** (primary):
- `@x402/core` — protocol types, encoding
- `@x402/evm`, `@x402/svm`, `@x402/stellar` — chain-specific
- `@x402/express`, `@x402/fastify`, `@x402/hono`, `@x402/next` — server middleware

**Python**: `pip install x402`

**Go**: `github.com/x402-foundation/x402/go`

Design goal: **1 line for the server, 1 function for the client**.

## Integration Example (Server)

```typescript
import { paymentMiddleware } from "@x402/express";

app.use("/paid-resource", paymentMiddleware({
  price: "0.001",                          // USDC
  token: USDC_BASE_ADDRESS,
  network: "eip155:8453",                  // Base
  facilitatorUrl: "https://x402.coinbase.com/facilitator",
  recipientAddress: "0xMyAddress",
}));
```

## Integration Example (Client)

```typescript
import { paymentFetch } from "@x402/core";

const response = await paymentFetch(
  "https://api.example.com/paid-resource",
  { wallet }  // wallet with signing capability
);
```

## Relevance to NozKash

- x402 provides the **payment rail** for agentic wallet service
- Our service can act as both **facilitator** (verify + settle) and **resource server** (expose privacy operations as paid APIs)
- Privacy-preserving payments via x402: sign with TEE-held keys, settle through shielded pools
- NozKash eCash tokens could be a new payment **scheme** within x402
