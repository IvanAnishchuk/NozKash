# NozKash Python Library

Privacy-preserving eCash for EVM chains using BLS blind signatures over BLS12-381.

Users deposit a fixed denomination (0.001 ETH), receive a blind-signed token
from an off-chain mint, and redeem to any address — without the mint learning
which deposit corresponds to which redemption.

---

## How It Works

```
Client                     NozkVaultV2 (on-chain)        Mint Server
  │                               │                            │
  │  derive spend_priv, r         │                            │
  │  spend_pub = spend_priv * G1  │                            │
  │  B = r * H_G2(spend_pub)      │                            │
  │                               │                            │
  │── deposit(depositId, B) ─────▶│                            │
  │   + 0.001 ETH                 │── DepositLocked ─────────▶│
  │                               │                            │  S' = sk * B
  │                               │◀── announce(id, S') ──────│
  │                               │                            │
  │  S = S' * r⁻¹  (unblind)     │                            │
  │  verify e(pkMint,Y)==e(G1,S)  │                            │
  │                               │                            │
  │── reveal(spendPub, S) ──────▶│                            │
  │                               │  BLS pairing check         │
  │                               │  stores spendPub by nId    │
  │                               │                            │
  │── redeem(dest, sig, nId) ───▶│                            │
  │                               │  BLS spend sig verify      │
  │                               │── 0.001 ETH ─────────────▶ dest
```

**Privacy:** The blinding factor `r` is known only to the client. The mint signs
`B = r·H(spendPub)` without ever seeing `spendPub`. At redemption the contract
learns the nullifier but cannot link it back to the original deposit.

**MEV protection:** Redemption requires a BLS spend signature (AugSchemeMPL)
over an EIP-712 message binding the recipient address and deadline. A
front-runner cannot redirect funds without the spend private key.

**Stateless recovery:** All secrets are deterministically derived from a master
seed and token index, so the wallet can be fully reconstructed from the seed.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | 3.13+ | Library, mint server, CLI wallet |
| [uv](https://docs.astral.sh/uv/) | latest | Python package management |

---

## Quick Start

```bash
cd nozk_py
uv venv && uv sync

# Generate keys and .env
uv run generate_keys.py

# Run tests
uv run pytest -v

# Full mock lifecycle
bash nozk_flow.sh --to 0xRecipient --mock
```

---

## Repository Layout

```
├── bls12_381_crypto.py       # BLS12-381 primitives (py_ecc + chia_rs)
├── nozk_library.py           # Protocol library (source of truth)
│
├── mint_server.py            # Off-chain mint daemon (WebSocket)
├── relayer_server.py         # FastAPI relayer for gas abstraction
├── client.py                 # CLI wallet (deposit / scan / redeem)
├── generate_keys.py          # Keypair + .env generator
├── generate_vectors.py       # Cross-language test vector generator
├── test_constants.py         # Shared anvil test keys
│
├── nozk_library_test.py      # Unit tests
├── test_vectors.py           # Cross-language vector tests
├── test_crypto_parity.py     # RFC 9380 + BLS parity tests
├── test_e2e_anvil.py         # On-chain E2E (local anvil)
├── test_mint_integration.py  # Mint server integration tests
├── test_relayer_integration.py  # Relayer endpoint tests
├── nozk_tip_test.py          # End-to-end smoke test
│
├── nozk_flow.sh              # Full lifecycle automation
├── pyproject.toml            # Dependencies
└── .env                      # Local secrets (never committed)
```

---

## Library API Reference

The Python library (`nozk_library.py`) is the source of truth. The TypeScript
port (`nozk_ts/nozk-library.ts`) must produce byte-identical output, enforced
by shared test vectors in `test_vectors/`.

### Types

| Concept | Python | Description |
|---------|--------|-------------|
| G1 point | `G1Point` | BLS12-381 G1 (public keys) |
| G2 point | `G2Point` | BLS12-381 G2 (signatures, blinded tokens) |
| Scalar | `Scalar` (int) | Field element mod CURVE_ORDER |
| Token secrets | `TokenSecrets` dataclass | spend keys + blind keys + r |
| Blinded points | `BlindedPoints` dataclass | Y (hash point) + B (blinded) |
| Redemption proof | `RedemptionProof` dataclass | BLS AugSchemeMPL spend signature |
| Mint keys | `MintKeypair` dataclass | sk (Scalar) + pk (G1Point) |

### Key Functions

#### Token Derivation

```python
secrets = derive_token_secrets(master_seed, token_index)
# secrets.spend_bls_pub   — G1 public key (nullifier identity)
# secrets.deposit_id      — address derived from blind key
# secrets.r               — blinding scalar
# secrets.nullifier_id    — keccak256(abi_encode(spend_bls_pub))
```

#### Blinding & Unblinding

```python
blinded = blind_token(secrets.spend_bls_pub, secrets.r)
# blinded.Y = H_G2(spend_pub), blinded.B = r * Y

S_prime = mint_blind_sign(blinded.B, keypair.sk)  # mint side
S = unblind_signature(S_prime, secrets.r)          # client side
```

#### Verification

```python
# Mint signature (reveal)
assert verify_bls_mint_signature(S, blinded.Y, keypair.pk)

# Spend signature (redeem)
proof = generate_redemption_proof(
    secrets.spend_chia_sk, secrets.spend_chia_pk,
    recipient, chain_id, contract_address, deadline,
)
```

#### Aggregation

```python
sigma = aggregate_reveal_sigma([S1, S2, S3])
sigma = aggregate_redeem_sigma([sig1, sig2, sig3])
```

---

## CLI Wallet (`client.py`)

```bash
uv run client.py deposit --index 0
uv run client.py scan --from-block 7500000
uv run client.py redeem --index 0 --to 0xAddr
uv run client.py redeem --index 0 --to 0xAddr --relayer http://localhost:8000
uv run client.py status
uv run client.py balance
```

Token lifecycle: `FRESH` → `AWAITING_MINT` → `READY_TO_REDEEM` → `SPENT`

---

## Mint Server (`mint_server.py`)

Stateless async daemon. Connects over WebSocket, polls for `DepositLocked`
events, computes `S' = sk·B`, and calls `announce()`.

```bash
uv run mint_server.py
uv run mint_server.py --verbosity verbose
```

---

## Relayer Server (`relayer_server.py`)

FastAPI service for gas-abstracted reveal/redeem. Validates BLS signatures
off-chain before submitting transactions.

```bash
uv run relayer_server.py --port 8000
```

Endpoints: `POST /reveal`, `POST /redeem`, `GET /status/{nId}`, `GET /health`

---

## Testing

```bash
uv run pytest -v                           # Full suite
uv run pytest nozk_library_test.py -v      # Unit tests
uv run pytest test_vectors.py -v           # Cross-language vectors
uv run pytest test_e2e_anvil.py -v         # On-chain E2E (requires anvil)
uv run pytest test_mint_integration.py -v  # Mint integration
uv run pytest test_relayer_integration.py -v  # Relayer endpoints
```

### Cross-language vector tests

Both Python and TypeScript load the same JSON vectors, proving byte-for-byte
cryptographic parity across BLS primitives.

### Generating vectors

```bash
uv run generate_vectors.py
```

---

## Cryptographic Design

**Curve:** BLS12-381 — using EIP-2537 Pectra precompiles (`BLS12_G1ADD`,
`BLS12_G1MSM`, `BLS12_G2ADD`, `BLS12_PAIRING`, `BLS12_MAP_FP2_TO_G2`).

**Hash-to-G2:** RFC 9380 with SHA-256 and DST
`BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_`.

**Blinding:** Multiplicative in G2. The algebraic identity
`S = S'·r⁻¹ = sk·r·H(spendPub)·r⁻¹ = sk·H(spendPub)` ensures the pairing
equation holds after unblinding.

**Spend signatures:** BLS AugSchemeMPL (chia_rs) over EIP-712 typed data
`NozkRedeem(address recipient, uint256 deadline)`.

**Key scheme:** PK in G1, Sig in G2 — matches Ethereum consensus layer
conventions and chia_rs/blst defaults.
