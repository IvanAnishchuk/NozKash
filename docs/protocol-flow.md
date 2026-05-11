# NozKash Protocol Flow

Privacy-preserving eCash on EVM using BLS blind signatures over BLS12-381.

## Overview

NozKash uses blind signatures to break the on-chain link between depositor
and redeemer. The mint (a semi-trusted authority) signs blinded tokens without
learning which spend key they correspond to. The contract verifies BLS
pairings via EIP-2537 Pectra precompiles — no zero-knowledge proofs needed.

## Token Lifecycle

```
FRESH -> AWAITING_MINT -> READY_TO_REDEEM -> SPENT
```

Each token has a fixed denomination of 0.001 ETH. Every secret is
deterministically derived from `(masterSeed, index)`, enabling stateless
wallet recovery via chain scanning.

## Full Protocol Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant V as NozkVaultV2
    participant M as Mint Authority

    Note over C: derive secrets from (masterSeed, index)
    Note over C: spend_priv, spend_pub (G1), r, deposit_id

    C->>C: B = r * H_G2(spend_pub)
    C->>V: deposit(depositId, B) + 0.001 ETH
    V-->>C: DepositLocked event

    M->>V: scan DepositLocked events
    M->>M: S' = sk_mint * B (blind sign)
    M->>V: announce(depositId, S')
    V-->>C: MintFulfilled event

    C->>C: S = S' * r^(-1) (unblind)
    Note over C: S = sk_mint * H_G2(spend_pub)

    C->>V: reveal(spendPub, S)
    Note over V: BLS pairing check:<br/>e(pkMint, H_G2(spendPub)) == e(G1gen, S)
    Note over V: stores spendPub by nullifier ID
    V-->>C: NullifierRevealed event

    C->>C: spendSig = AugSchemeMPL.sign(spend_priv, msg)
    Note over C: msg = EIP-712(recipient, deadline)
    C->>V: redeem(recipient, spendSig, nId, deadline)
    Note over V: looks up spendPub by nId<br/>BLS verify: e(spendPub, H_G2(aug_msg)) == e(G1gen, spendSig)
    V-->>C: 0.001 ETH to recipient
```

### Key insight: spend pubkey storage

During `reveal()`, the contract stores the spend public key (G1 point,
4 x uint256) indexed by the nullifier ID. This is why `redeem()` does not
need the spend pubkey as a parameter — the contract looks it up from
the nullifier ID passed in the redeem call.

This two-phase approach (reveal then redeem) separates the BLS mint
signature verification from the spend authorization, allowing each step
to use a single pairing check.

## Relayer Flow

In the frontend app, a relayer submits transactions on behalf of the
user so the redeemer's wallet never appears on-chain:

```mermaid
sequenceDiagram
    participant C as Client (App)
    participant R as Relayer
    participant V as NozkVaultV2

    C->>R: POST /reveal {spendPubG1, S_G2}
    R->>V: reveal(uint256[4], uint256[8])
    V-->>R: tx hash (revealed)
    R-->>C: tx_hash

    C->>R: POST /redeem {recipient, sigmaCompressed, pkCompressed, nId, deadline}
    R->>V: redeem(address, uint256[8], bytes32, uint256)
    V-->>R: tx hash (spent)
    R-->>C: tx_hash
```

The relayer is gas-only — it cannot forge spend signatures or redirect
funds. MEV protection is enforced by the BLS spend signature over an
EIP-712 message binding the recipient address and deadline.

## Aggregation

For batching multiple tokens in a single transaction:

- **`revealAggregated(spendPubs[], sigma)`** — batch reveal with a
  single pairing: `e(pkMint, sum(Y_i)) == e(G1gen, sigma)`
- **`redeemAggregated(recipient, sigma, nIds[], deadline)`** — batch
  redeem with (n+1)-pairing verification

## Cryptographic Primitives

| Primitive | Specification |
|-----------|---------------|
| Hash-to-G2 | RFC 9380 (SHA-256 + EIP-2537 MAP_FP2_TO_G2) |
| DST | `BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_` |
| Spend signatures | BLS AugSchemeMPL (chia_rs / noble-curves) |
| Token derivation | `keccak256(seed \|\| index_be32)` with domain separation |
| Redeem message | EIP-712 typed structured data |
| G1 points | 4 x uint256 (EIP-2537 uncompressed, 128 bytes) |
| G2 points | 8 x uint256 (EIP-2537 uncompressed, 256 bytes) |
| Public key | G1 (mint authority) |
| Signatures | G2 (mint blind sig, spend sig) |

## Contract Entry Points

| Function | Parameters | Purpose |
|----------|-----------|---------|
| `deposit` | `address depositId, uint256[8] B` | Lock 0.001 ETH, register blinded G2 point |
| `announce` | `address depositId, uint256[8] S'` | Mint posts blind signature (G2) |
| `reveal` | `uint256[4] spendPub, uint256[8] S` | Reveal spend pubkey + unblinded sig, BLS pairing check |
| `redeem` | `address recipient, uint256[8] spendSig, bytes32 nId, uint256 deadline` | Verify BLS spend sig, transfer ETH |
| `refund` | `address depositId` | Reclaim ETH before announce |
| `revealAggregated` | `uint256[4][] spendPubs, uint256[8] sigma` | Batch reveal, single pairing |
| `redeemAggregated` | `address recipient, uint256[8] sigma, bytes32[] nIds, uint256 deadline` | Batch redeem, (n+1)-pairing |

---

> A rabbit taps code on the moonlit pane,
> Swaps curves, BN to BLS arcane.
> G1 the key, G2 the gleam,
> Vault V2 hums like a dream.
> Precompiles purr, nullifiers sing --
> Hop! Redeem -- privacy on wing.

*-- CodeRabbit, PR #13*
