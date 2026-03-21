# 👻 Ghost-Tip Protocol

A stateless, privacy-preserving eCash system for EVM chains, built on BLS blind signatures over the BN254 curve. Users deposit a fixed denomination (0.01 ETH), receive a cryptographically blind-signed token from an off-chain mint, and can redeem it to any address without the mint ever learning which deposit corresponds to which redemption.

This repository is a research and reference implementation. It contains a shared cryptographic library with byte-for-byte parity between Python and TypeScript, a mint server daemon, a CLI wallet, and a comprehensive cross-language test suite.

---

## Protocol Overview

The protocol implements a 1-of-1 Chaumian blind signature scheme scaled to EVM constraints:

```
Client                    Contract (GhostVault)         Mint Server
  │                              │                            │
  │  1. derive spend keypair     │                            │
  │     Y = H(spendAddress)      │                            │
  │     B = r · Y  (blind)       │                            │
  │─────── deposit(B) ──────────▶│                            │
  │        + 0.01 ETH            │── DepositLocked(id, B) ──▶│
  │                              │                            │  S' = sk · B
  │                              │◀─── announce(id, S') ─────│
  │                              │                            │
  │  4. S = S' · r⁻¹  (unblind)  │                            │
  │     verify e(S,G2)==e(Y,PK)  │                            │
  │                              │                            │
  │─────── redeem(dest, sig, S) ▶│                            │
  │                              │  ecrecover → nullifier     │
  │                              │  ecPairing → BLS verify    │
  │                              │─── transfer 0.01 ETH ─────▶ dest
```

**Privacy property:** The blinding factor `r` is known only to the client. The mint signs `B = r·Y` and never sees `Y` or the spend address. The contract verifies `e(S, G2) == e(H(nullifier), PK_mint)` using the EVM's native `ecPairing` precompile — it learns the nullifier (spend address) only at redemption time, and cannot link it to the original deposit.

**MEV protection:** The redemption proof is an ECDSA signature over `"Pay to: <recipient>"`. The contract calls `ecrecover` to recover the nullifier (spend address) and verifies it hasn't been spent. A front-running bot cannot change the recipient without invalidating the signature.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | 3.13+ | Library, mint server, CLI wallet |
| Node.js | 20+ | TypeScript library, TS test suite |
| [uv](https://docs.astral.sh/uv/) | latest | Python package management |
| npm | bundled with Node | TypeScript package management |

---

## Repository Structure

```
.
├── ghost_library.py          # Python cryptographic library (source of truth)
├── ghost-library.ts          # TypeScript port (byte-for-byte parity with Python)
├── bn254-crypto.ts           # Low-level BN254 primitives (mcl-wasm wrapper)
│
├── mint_server.py            # Off-chain mint daemon (listens & signs)
├── client.py                 # CLI wallet (deposit / scan / redeem / status)
├── generate_keys.py          # One-time keypair & .env generator
├── generate_vectors.py       # Cross-language test vector generator
│
├── ghost_library_test.py     # Python unit + integration tests
├── test_vectors.py           # Python parametrized cross-language vector tests
├── test-vectors.test.ts      # TypeScript parametrized cross-language vector tests
│
├── ghost_tip_test.py         # End-to-end lifecycle smoke test (Python, uses .env)
├── test.ts                   # End-to-end lifecycle smoke test (TypeScript, uses .env)
│
├── test_vectors/             # Generated vector files (created by generate_vectors.py)
│   └── <seed>_<sk>/
│       └── token_<index>.json
├── vectors.json              # Legacy single-vector file (fallback for test suites)
│
├── pyproject.toml            # Python project & dependency manifest
├── package.json              # Node project & dependency manifest
└── .env                      # Local secrets (created by generate_keys.py, never commit)
```

---

## Quick Start

### 1. Clone and install

```bash
# Python
uv venv
uv sync

# TypeScript
npm install
```

### 2. Generate keys and secrets

```bash
uv run generate_keys.py
```

This creates a `.env` file with:
- `MASTER_SEED` — deterministic seed for the client wallet
- `MINT_BLS_PRIVKEY` — BLS scalar private key for the mint server (hex)
- A commented-out `PK_MINT_SOLIDITY` array ready to paste into `GhostVault.sol`

### 3. Run all tests

```bash
# Python (unit tests + vector tests)
uv run pytest -v

# TypeScript (vector parity tests)
npx vitest run
```

All tests should pass against the shared `vectors.json` or any generated `test_vectors/` files.

---

## Environment Variables

### Shared (client and mint)

| Variable | Required | Description |
|----------|----------|-------------|
| `MASTER_SEED` | client | Hex string seed; all wallet secrets derive from this |
| `MINT_BLS_PRIVKEY` | mint | Hex scalar `sk` used for `S' = sk·B` |
| `CONTRACT_ADDRESS` | both | Deployed `GhostVault` contract address |

### Mint server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_WS_URL` | ✅ | — | WebSocket RPC (`wss://sepolia.infura.io/...`) |
| `MINT_WALLET_ADDRESS` | ✅ | — | Address that pays gas for `announce()` |
| `MINT_WALLET_KEY` | ✅ | — | Private key for `MINT_WALLET_ADDRESS` |
| `POLL_INTERVAL_SECONDS` | | `2` | Event polling interval |
| `LOG_LEVEL` | | `INFO` | Python logging level |

### CLI wallet

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WALLET_ADDRESS` | ✅ | — | Address that pays gas for `deposit()` and `redeem()` |
| `WALLET_KEY` | ✅ | — | Private key for `WALLET_ADDRESS` |
| `RPC_HTTP_URL` | ✅ | — | HTTP RPC (`https://sepolia.infura.io/...`) |
| `SCAN_FROM_BLOCK` | | `0` | Default start block for chain scans |

### End-to-end smoke tests only

| Variable | Required | Description |
|----------|----------|-------------|
| `MINT_BLS_PRIVKEY_INT` | ✅ | Decimal integer form of the BLS key (legacy, used by `ghost_tip_test.py` and `test.ts`) |

---

## Python Library (`ghost_library.py`)

The core cryptographic library. All other Python components import from this.

### Types

```python
G1Point = NewType("G1Point", tuple[FQ, FQ])    # BN254 G1 point
G2Point = NewType("G2Point", tuple[FQ2, FQ2])  # BN254 G2 point
Scalar  = NewType("Scalar", int)               # Z_q field element
```

### Dataclasses

```python
@dataclass
class TokenSecrets:
    spend_priv:          keys.PrivateKey  # CLIENT ONLY — never sent to mint
    spend_address_hex:   str              # The nullifier / token identity
    spend_address_bytes: bytes
    r:                   Scalar           # BLS blinding factor

@dataclass
class BlindedPoints:
    Y: G1Point   # H(spend_address) — unblinded hash-to-curve
    B: G1Point   # r·Y — blinded point sent to the mint

@dataclass
class RedemptionProof:
    msg_hash:      bytes
    compact_hex:   str             # 128-char r||s hex (matches TS compactHex)
    recovery_bit:  int             # 0 or 1; EVM ecrecover expects v = bit + 27
    signature_obj: keys.Signature

@dataclass
class MintKeypair:
    sk: Scalar    # BLS scalar private key
    pk: G2Point   # sk·G2 — public verification key
```

### Exception hierarchy

```
GhostError
├── CurveError
│   ├── InvalidPointError      # carries .x, .y, .curve attributes
│   └── ScalarMultiplicationError
├── DerivationError            # bad seed, negative index, index > 2^32
└── VerificationError          # malformed compact_hex or invalid recovery_bit
```

### Public API

```python
# Setup
generate_mint_keypair() -> MintKeypair

# Point utilities
hash_to_curve(message_bytes: bytes) -> G1Point
serialize_g1(point: G1Point) -> tuple[int, int]      # → Solidity uint256[2]
parse_g1(x: int, y: int) -> G1Point                  # raises InvalidPointError

# Client operations
derive_token_secrets(master_seed: bytes, token_index: int) -> TokenSecrets
blind_token(spend_address_bytes: bytes, r: Scalar) -> BlindedPoints
unblind_signature(S_prime: G1Point, r: Scalar) -> G1Point
generate_redemption_proof(spend_priv: PrivateKey, destination: str) -> RedemptionProof

# Mint operation
mint_blind_sign(B: G1Point, sk_mint: Scalar) -> G1Point  # raises InvalidPointError

# EVM simulations
verify_ecdsa_mev_protection(msg_hash, compact_hex, recovery_bit, expected_address) -> bool
verify_bls_pairing(S: G1Point, Y: G1Point, PK_mint: G2Point) -> bool
```

### Usage example

```python
from ghost_library import (
    generate_mint_keypair, derive_token_secrets, blind_token,
    mint_blind_sign, unblind_signature, generate_redemption_proof,
    verify_ecdsa_mev_protection, verify_bls_pairing,
)

keypair = generate_mint_keypair()
secrets = derive_token_secrets(b"my_seed", token_index=0)

# Client blinds
blinded = blind_token(secrets.spend_address_bytes, secrets.r)

# Mint signs (only B crosses the boundary — spend address stays private)
S_prime = mint_blind_sign(blinded.B, keypair.sk)

# Client unblinds and generates redemption proof
S     = unblind_signature(S_prime, secrets.r)
proof = generate_redemption_proof(secrets.spend_priv, "0xRecipient...")

assert verify_bls_pairing(S, blinded.Y, keypair.pk)
assert verify_ecdsa_mev_protection(
    proof.msg_hash, proof.compact_hex, proof.recovery_bit, secrets.spend_address_hex
)
```

---

## TypeScript Library (`ghost-library.ts` + `bn254-crypto.ts`)

TypeScript port with byte-for-byte cryptographic parity with the Python library. Requires `initBN254()` before any BN254 operations.

### Error hierarchy

```typescript
GhostError
├── DerivationError
└── VerificationError
    └── RecoveryBitError   // thrown if neither recovery bit reproduces the address
```

### Interfaces

```typescript
interface TokenSecrets {
    spendPriv:          Uint8Array;
    spendAddressHex:    string;
    spendAddressBytes:  Uint8Array;
    r:                  bigint;
}

interface RedemptionProof {
    msgHash:            Uint8Array;
    signatureObj:       Uint8Array;   // raw 64-byte compact r||s
    compactHex:         string;
    recoveryBit:        0 | 1;        // always mathematically verified, never a default
    pubKeyUncompressed: Uint8Array;
}
```

### Public API (`ghost-library.ts`)

```typescript
// Must be called once at startup
import { initBN254 } from './bn254-crypto.js';
await initBN254();

// Setup
generateMintKeypair(): { skMint: bigint; pkMint: mcl.G2 }

// Client operations
deriveTokenSecrets(masterSeed: Uint8Array, tokenIndex: number): TokenSecrets
blindToken(spendAddressBytes: Uint8Array, r: bigint): BlindedPoints
unblindSignature(S_prime: mcl.G1, r: bigint): mcl.G1
generateRedemptionProof(spendPriv: Uint8Array, destination: string): Promise<RedemptionProof>

// Mint operation
mintBlindSign(B: mcl.G1, skMint: bigint): mcl.G1

// EVM simulations
verifyEcdsaMevProtection(proof: RedemptionProof, expectedAddress: string): boolean
verifyBlsPairing(S: mcl.G1, Y: mcl.G1, pkMint: mcl.G2): boolean
```

### Low-level BN254 primitives (`bn254-crypto.ts`)

```typescript
// Constants
FIELD_MODULUS: bigint
CURVE_ORDER:   bigint

// Operations
initBN254(): Promise<void>
hashToCurveBN254(messageBytes: Uint8Array): mcl.G1
multiplyBN254(point: mcl.G1, scalar: bigint): mcl.G1
verifyPairingBN254(S: mcl.G1, Y: mcl.G1, PK_mint: mcl.G2): boolean
formatG1ForSolidity(point: mcl.G1): [string, string]    // base-10 strings for ethers/viem
modularInverse(k: bigint, mod: bigint): bigint
```

---

## Mint Server (`mint_server.py`)

Stateless async daemon. Connects over WebSocket, polls for `DepositLocked` events, performs `S' = sk·B`, and broadcasts the result via `announce()`.

```bash
uv run mint_server.py
```

### What it does

1. Connects to the contract over WebSocket
2. Creates a `DepositLocked` event filter from the latest block
3. For each event: validates the submitted G1 point, computes `S' = sk·B`, submits `announce(depositId, S')`
4. Waits for transaction confirmation and logs the block number
5. Reconnects automatically on WebSocket disconnection

### Required `.env` additions

```env
MINT_BLS_PRIVKEY=0x...         # from generate_keys.py (hex scalar)
CONTRACT_ADDRESS=0x...
RPC_WS_URL=wss://sepolia.infura.io/ws/v3/YOUR_KEY
MINT_WALLET_ADDRESS=0x...
MINT_WALLET_KEY=...
```

### Security note

`mint_blind_sign` validates that the submitted point is on the BN254 G1 curve before signing. Off-curve points would produce garbage signatures and are rejected with a warning log rather than spending gas on a doomed `announce()` call.

---

## CLI Wallet (`client.py`)

Reference implementation of the full client lifecycle. Each command prints every intermediate cryptographic value for debugging and auditing.

Wallet state is persisted to `.ghost_wallet.json` in the working directory. This is purely a cache — all secrets are re-derivable from `MASTER_SEED`, so losing the file only requires re-running `scan`.

### Commands

#### `deposit`

Derives token secrets, blinds the spend address to a G1 point, submits `deposit(B)` with 0.01 ETH, and records the `depositId` from the `DepositLocked` receipt event.

```bash
uv run client.py deposit --index 0
```

Output shows:
- Spend address (nullifier) derived from seed + index
- Blinding scalar `r`
- `Y = H(spendAddress)` and `B = r·Y` coordinates
- Transaction hash, block number, gas used
- `depositId` extracted from the receipt log

#### `scan`

Fetches `DepositLocked` and `MintFulfilled` events in a block range, matches them to token indices by re-deriving and comparing `B` coordinates, unbblinds `S' → S` for any fulfilled deposits, and checks nullifier status on-chain.

```bash
uv run client.py scan --from-block 7500000 --indices 0 1 2
# Omit --indices to scan all known tokens from wallet state
# Omit --from-block to resume from last scanned block
```

Output shows per token:
- Derived `B` coordinates used for matching
- `depositId` matched from `DepositLocked` events
- `S'.x`, `S'.y` from `MintFulfilled`
- `S.x`, `S.y` after unblinding
- On-chain nullifier spent status

#### `redeem`

Loads the unblinded signature from wallet state, generates the anti-MEV ECDSA proof, runs a local `ecrecover` verification, then submits `redeem(recipient, spendSig, S)`.

```bash
uv run client.py redeem --index 0 --to 0xRecipientAddress
```

Output shows:
- `S.x`, `S.y` loaded from state
- Spend address (nullifier)
- ECDSA payload string, `msg_hash`, `compact_hex`, `recovery_bit`
- `v = recovery_bit + 27` (EVM encoding)
- Full 65-byte encoded `spendSignature`
- Local `ecrecover` verification result (must pass before submitting)
- Transaction hash, block, gas used
- Confirmation of all three on-chain checks passing

#### `status`

```bash
uv run client.py status
```

Shows on-chain ETH balance and a summary table of all token records with their lifecycle state:
`FRESH` → `AWAITING_MINT` → `READY_TO_REDEEM` → `SPENT`

#### `balance`

```bash
uv run client.py balance
```

Queries on-chain ETH balance for `WALLET_ADDRESS`.

### Required `.env` additions

```env
MASTER_SEED=...               # from generate_keys.py
WALLET_ADDRESS=0x...
WALLET_KEY=...
CONTRACT_ADDRESS=0x...
RPC_HTTP_URL=https://sepolia.infura.io/v3/YOUR_KEY
SCAN_FROM_BLOCK=7500000       # optional, saves time on first scan
```

---

## Test Infrastructure

### Python unit tests (`ghost_library_test.py`)

20 tests covering the full library surface including the exception hierarchy, determinism, boundary conditions, point validation, and negative cases.

```bash
uv run pytest ghost_library_test.py -v
```

Notable tests:
- `test_index_boundary_256_differs_from_0` — catches the DataView truncation bug where `Uint8Array([0,0,0,256])` silently wraps to `[0,0,0,0]`
- `test_mev_protection_rejects_wrong_recovery_bit` — verifies the verifier uses `ecrecover` logic, not a stored key shortcut
- `test_bls_pairing_rejects_wrong_keypair` / `_wrong_token` — cross-keypair and cross-token rejection

### Cross-language vector tests

Both `test_vectors.py` (pytest) and `test-vectors.test.ts` (vitest) load the same JSON files and run identical assertions. A test passing in both languages proves byte-for-byte cryptographic parity.

```bash
# Python
uv run pytest test_vectors.py -v

# TypeScript
npx vitest run
```

Each vector file is tested for:
1. G2 public key derivation from scalar
2. Token secret derivation (spend address + blinding factor)
3. Hash-to-curve and multiplicative blinding (Y and B)
4. Blind signature (S')
5. Unblinding (S)
6. Full BLS pairing: `e(S, G2) == e(Y, PK_mint)`

### Generating test vectors

```bash
# Default: 3 random keypairs × indices [0, 1, 42, 255, 256, 1000] = 18 files
uv run generate_vectors.py

# Custom
uv run generate_vectors.py --keypairs 10 --indices 0 42 256 65535

# Output: test_vectors/<seed_prefix>_<sk_prefix>/token_<index>.json
```

Index 256 is always included because it exercises the `DataView` fix: under the old `Uint8Array([0,0,0,tokenIndex])` encoding, index 256 would silently produce the same bytes as index 0, making two tokens share a spend address.

The test suites fall back to `vectors.json` automatically if `test_vectors/` doesn't exist yet, so CI passes before the generator has been run.

### End-to-end smoke tests

These scripts run the full protocol lifecycle against a shared `.env` and print every intermediate value. Use them to verify Python ↔ TypeScript parity manually.

```bash
uv run ghost_tip_test.py   # Python
npx tsx test.ts             # TypeScript
```

Both produce identical spend addresses, blinding factors, G1 coordinates, and BLS signatures when given the same `MASTER_SEED` and `MINT_BLS_PRIVKEY_INT`.

---

## Key Generation (`generate_keys.py`)

Generates a fresh random keypair and writes a `.env` file.

```bash
uv run generate_keys.py
```

Creates `.env` with:
- `MASTER_SEED` — 32-byte random hex string
- `MINT_BLS_PRIVKEY` — BLS scalar (hex) for the mint server
- A commented `PK_MINT_SOLIDITY` — `uint256[4]` array ready to hardcode into `GhostVault.sol`

> **Note on coordinate ordering:** Solidity's `ecPairing` precompile uses the imaginary coefficient before the real coefficient for G2 points: `[x_imag, x_real, y_imag, y_real]`. `generate_keys.py` handles this swap automatically. The TypeScript library uses a different G2 representation (`mcl.hashAndMapToG2`) that is not directly comparable to the Python G2 coordinates — see `ghost_tip_test.py` vs `test.ts` output for the difference.

---

## Cryptographic Design Notes

### Curve choice

All BLS operations use **BN254** (`alt_bn128`), the only pairing-friendly curve natively supported by EVM precompiles (`ecAdd` at `0x06`, `ecMul` at `0x07`, `ecPairing` at `0x08`).

ECDSA for MEV protection uses **secp256k1**, the same curve as Ethereum keys, so the nullifier recovery uses the existing `ecrecover` opcode with no additional precompile cost.

### Hash-to-curve

The `hash_to_curve` implementation uses try-and-increment: iterate `keccak256(message || counter)` until the resulting `x` satisfies `y² = x³ + 3` over the BN254 field. The square root is `y = (y²)^((p+1)/4) mod p` (works because `p ≡ 3 mod 4`). The Python and TypeScript implementations use identical byte encoding (`message || counter_big_endian_4_bytes`) and produce identical points.

### Blinding

Multiplicative blinding in Z_q: `B = r·Y` where `r` is derived deterministically from `keccak256(b"blind" || base_material)`. The mint sees only `B` and returns `S' = sk·B`. The client computes `S = S'·r⁻¹ = sk·Y`, which satisfies `e(S, G2) = e(sk·Y, G2) = e(Y, sk·G2) = e(Y, PK_mint)`.

### Token index encoding

Token indices are encoded as 4-byte big-endian integers using `DataView.setUint32` in TypeScript and `int.to_bytes(4, 'big')` in Python. The `Uint8Array([0, 0, 0, tokenIndex])` pattern was intentionally avoided: JavaScript's `Uint8Array` constructor truncates values modulo 256, so index 256 would silently produce the same bytes as index 0. The `test_index_boundary_256_differs_from_0` test explicitly guards this.

### Recovery bit

The ECDSA recovery bit (`v`) determines which of the two possible public keys is recovered from a signature. The TypeScript library always derives this mathematically by trial — it never reads a `.recovery` property from the signature object, which may be absent in older library versions and would silently default to 0, causing 50% of on-chain redemptions to revert. The `test_mev_protection_rejects_wrong_recovery_bit` test enforces this.

---

## Adding `web3` to the project

The mint server and CLI wallet require `web3`. Add it to the project:

```bash
uv add web3
```

Or add manually to `pyproject.toml`:

```toml
dependencies = [
    ...
    "web3>=7.0.0",
]
```

---

## Full Lifecycle Example (Sepolia Testnet)

```bash
# 1. Generate keys
uv run generate_keys.py
# → .env created with MASTER_SEED and MINT_BLS_PRIVKEY

# 2. Add to .env:
#    CONTRACT_ADDRESS=0x... (deployed GhostVault)
#    RPC_WS_URL=wss://...   (for mint server)
#    RPC_HTTP_URL=https://... (for client)
#    WALLET_ADDRESS=0x...
#    WALLET_KEY=...
#    MINT_WALLET_ADDRESS=0x...
#    MINT_WALLET_KEY=...

# 3. Start the mint server (separate terminal)
uv run mint_server.py

# 4. Check wallet balance
uv run client.py balance

# 5. Deposit token (locks 0.01 ETH, emits DepositLocked)
uv run client.py deposit --index 0
# → mint server picks up event, calls announce(), emits MintFulfilled

# 6. Scan chain to recover the signed token
uv run client.py scan --from-block <deposit_block> --indices 0
# → unblinded S stored in .ghost_wallet.json

# 7. Check status
uv run client.py status

# 8. Redeem to any address
uv run client.py redeem --index 0 --to 0xAnyRecipient...
# → 0.01 ETH arrives at recipient, nullifier marked spent on-chain

# 9. Verify tests still pass (nothing broken by config changes)
uv run pytest -v
npx vitest run
```
