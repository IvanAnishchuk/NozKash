# 👻 NozKash

**aleph-hackathon-m2026**

Deployed on Avalanche Fuji testnet!

[Simoneth Arianna Gomez](https://github.com/Simonethg), [Fabio Laura](https://github.com/raptor0929), [Ivan Anishchuk](https://github.com/IvanAnishchuk)

**Privacy-preserving eCash for EVM chains — without zero-knowledge proofs.**

nozkash uses BLS blind signatures over BN254 to deliver unlinkable token transfers at a fraction of the gas cost of zk-SNARK privacy protocols. Users deposit a fixed denomination, receive a cryptographically blind-signed token from a mint, and redeem it to any address — the mint never learns which deposit corresponds to which redemption.

No circuits. No trusted setup. No off-chain relayer infrastructure. Just elliptic curve math that the EVM already understands.

---

## Why nozkash?

Privacy on EVM today sits at two extremes:

| Approach | Privacy | Trust | Gas cost | Complexity |
|----------|---------|-------|----------|------------|
| **Custodial mixers** | Weak (operator sees everything) | Full trust in operator | Low | Low |
| **zk-SNARK pools** | Strong (zero-knowledge) | Trustless | Very high (~1M+ gas) | Very high (circuits, trusted setup, proof generation) |
| **nozkash** | Strong (blind signatures) | Minimal — mint signs blindly | **~50k gas deposit, ~120k gas redeem** | Low (standard EVM precompiles) |

nozkash occupies a practical middle ground: **privacy comparable to dark pools, costs comparable to a token transfer, complexity comparable to a multisig.**

### The tradeoff

nozkash introduces a **mint** — an off-chain signer that blind-signs deposit tokens. The mint:

- ✅ **Cannot link** deposits to redemptions (blinding factor `r` is secret)
- ✅ **Cannot forge** tokens (BLS signatures are verified on-chain)
- ✅ **Cannot steal** funds (redemption goes directly to the user's chosen address)
- ⚠️ **Can refuse** to sign (liveness dependency)
- ⚠️ **Can collude** with an observer to deanonymize if it logs timing metadata

These trust assumptions are **strictly weaker** than custodial pools (where the operator controls funds outright) and can be further minimized:

- **Threshold blind signatures** — distribute the mint across N-of-M signers so no single party can deny service or correlate deposits
- **TEE attestation** — run the mint in a trusted execution environment with remote attestation, proving it doesn't log metadata
- **Multiple independent mints** — users choose which mint to use, preventing any single point of censorship

In all cases, **verification remains fully on-chain** via the EVM `ecPairing` precompile — no trust is required at redemption time.

---

## How It Works

```
Client                     GhostVault (on-chain)          Mint Server
  │                               │                            │
  │  derive spend + blind keys    │                            │
  │  Y = H(spendAddress)          │                            │
  │  B = r · Y                    │                            │
  │                               │                            │
  │── deposit(depositId, B) ─────▶│                            │
  │   + 0.01 ETH                  │── DepositLocked(id, B) ──▶│
  │                               │                            │  S' = sk · B
  │                               │◀── announce(id, S') ──────│
  │                               │                            │
  │  S = S' · r⁻¹  (unblind)     │                            │
  │  verify e(S,G2)==e(Y,PK)      │                            │
  │                               │                            │
  │── redeem(dest, sig, null, S)─▶│                            │
  │                               │  ecrecover → verify sig    │
  │                               │  nullifier → double-spend  │
  │                               │  ecPairing → BLS verify    │
  │                               │── 0.01 ETH ──────────────▶ dest
```

**Blinding:** The client computes `B = r · H(spendAddress)` where `r` is a secret scalar. The mint sees only `B` — it cannot recover the spend address or link it to any future redemption.

**Signing:** The mint computes `S' = sk · B` without knowing what it signed. The client removes the blinding: `S = S' · r⁻¹ = sk · H(spendAddress)`.

**Verification:** The contract checks `e(S, G2) == e(H(nullifier), PK_mint)` using the EVM `ecPairing` precompile (0x08). This is a single pairing check — no SNARK verification, no Groth16, no circuit compilation.

**MEV protection:** Redemption includes an ECDSA signature over `keccak256("Pay to RAW: " || recipient_address)`. A front-runner cannot redirect funds without the spend private key.

**Stateless recovery:** All secrets derive deterministically from a master seed + token index. Lose your device, recover from seed.

---

## Gas Efficiency

nozkash uses only standard EVM precompiles — no custom verifier contracts, no large proof calldata.

| Operation | Gas cost | What happens |
|-----------|----------|--------------|
| `deposit()` | ~50,000 | Store blinded point + emit event |
| `announce()` | ~55,000 | Mint posts blind signature |
| `redeem()` | ~120,000 | ecrecover + ecPairing + ETH transfer |

For comparison, a zk-SNARK privacy pool typically costs 500k–1.5M gas per operation due to on-chain proof verification. nozkash's redeem costs less than a Uniswap swap.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | 3.13+ | Library, mint server, CLI wallet |
| Node.js | 20+ | TypeScript library, CLI client, test suite |
| [uv](https://docs.astral.sh/uv/) | latest | Python package management |
| npm | bundled with Node | TypeScript package management |

---

## Quick Start

```bash
# Install dependencies
uv venv && uv sync      # Python
npm install              # TypeScript (viem, mcl-wasm, @noble/curves, etc.)

# Generate keys and .env
uv run generate_keys.py

# Derive and add BLS public key to .env
uv run derive_bls.py 0x<your_bls_privkey>

# Run tests
uv run pytest -v         # Python unit + vector tests
npx vitest run           # TypeScript vector parity tests

# Generate cross-language test vectors
uv run generate_vectors.py
```

---

## Repository Layout

```
├── GhostVault.sol                # Solidity smart contract
├── ghost_vault_abi.json          # Contract ABI (shared source of truth)
├── example.env                   # Template for .env configuration
├── ghost_flow.sh                 # Full lifecycle runner script
│
│── Cryptographic Libraries ──────────────────────────
├── ghost_library.py              # Python crypto library (source of truth)
├── ghost-library.ts              # TypeScript port (byte-for-byte parity)
├── bn254-crypto.ts               # Low-level BN254 primitives (mcl-wasm)
│
│── CLI Wallets ──────────────────────────────────────
├── client.py                     # Python wallet (deposit/scan/redeem/status/balance)
├── client.ts                     # TypeScript wallet (deposit/scan/redeem/balance)
│
│── Mint Infrastructure ──────────────────────────────
├── mint_server.py                # Production mint daemon (WebSocket)
├── mint_mock.py                  # Offline mock mint for testing
├── redeem_mock.py                # Offline mock redeemer for testing
│
│── Tooling ──────────────────────────────────────────
├── contract_errors.py            # Decodes GhostVault revert selectors
├── generate_keys.py              # Keypair + .env generator
├── generate_vectors.py           # Cross-language test vector generator
├── derive_bls.py                 # BLS pubkey derivation tool
│
│── Test Suite ───────────────────────────────────────
├── ghost_library_test.py         # Python unit tests
├── test_vectors.py               # Python parametrized vector tests
├── test-vectors.test.ts          # TypeScript parametrized vector tests
├── ghost_tip_test.py             # Python end-to-end smoke test
├── test.ts                       # TypeScript end-to-end smoke test
├── test_vectors/                 # Generated vector files (JSON)
│
│── Config ───────────────────────────────────────────
├── pyproject.toml                # Python dependencies
├── package.json                  # Node dependencies
├── tsconfig.json                 # TypeScript config
└── .env                          # Local secrets (never committed)
```

---

## Smart Contract

The GhostVault contract handles the complete token lifecycle using only standard EVM precompiles:

| Function | Description |
|----------|-------------|
| `deposit(address depositId, uint256[2] B)` | Lock 0.01 ETH with a blinded G1 point |
| `announce(address depositId, uint256[2] S')` | Mint posts blind signature (authorized caller only) |
| `redeem(address recipient, bytes sig, address nullifier, uint256[2] S)` | Verify BLS + ECDSA, transfer ETH |

On-chain verification:
1. **ecrecover** — recover signer from ECDSA signature, verify against nullifier
2. **Nullifier check** — prevent double-spend via `spentNullifiers` mapping
3. **Hash-to-curve** — `keccak256(nullifier || counter)` try-and-increment to BN254 G1
4. **ecPairing** — verify `e(S, G2) == e(H(nullifier), PK_mint)` in a single precompile call

Custom errors: `InvalidValue`, `InvalidECDSA`, `AlreadySpent`, `InvalidBLS`, `InvalidSignatureLength`, `EthSendFailed`, `HashToCurveFailed`, `NotMintAuthority`, `DepositNotFound`, `DepositIdAlreadyUsed`, `AlreadyFulfilled`, `InvalidDepositId`.

---

## CLI Wallets

Both Python and TypeScript clients implement identical functionality, share the same wallet state file (`.ghost_wallet.json`), and use the same contract ABI.

### Python

```bash
uv run client.py deposit --index 0              # Lock 0.01 ETH
uv run client.py scan                            # Recover signed tokens (incremental)
uv run client.py redeem --index 0 --to 0xAddr    # Redeem to any address
uv run client.py status                          # Token lifecycle overview
uv run client.py balance                         # On-chain ETH balance
```

Additional flags: `--mock` (fully offline), `--dry-run` (simulate with RPC), `--verbosity verbose|debug|quiet`, `--relayer <url>` (gas-free redemption).

### TypeScript

```bash
npx tsx client.ts deposit --index 0
npx tsx client.ts scan
npx tsx client.ts redeem --index 0 --to 0xAddr
npx tsx client.ts balance
```

Auto-detects chain ID from RPC — works on any EVM chain.

### Token Lifecycle

```
FRESH → AWAITING_MINT → READY_TO_REDEEM → SPENT
```

Scanning is incremental (resumes from last block) and skips tokens with cached signatures. Both clients verify `e(S, G2) == e(Y, PK_mint)` locally before submitting on-chain — catching key mismatches early and saving gas.

---

## Mint Server

Stateless async daemon. Connects over WebSocket, listens for `DepositLocked` events, blind-signs, and calls `announce()`.

```bash
uv run mint_server.py
uv run mint_server.py --verbosity verbose    # Intermediate values
uv run mint_server.py --verbosity debug      # Raw event data
```

The mint validates G1 points before signing — off-curve inputs are rejected without wasting gas.

---

## Environment Variables

| Variable | Used by | Description |
|----------|---------|-------------|
| `MASTER_SEED` | client | Hex seed — all wallet secrets derive from this |
| `MINT_BLS_PRIVKEY` | mint, client | Hex BLS scalar |
| `MINT_BLS_PUBKEY` | client | G2 pubkey for local verification (4 hex uint256, EIP-197 order) |
| `CONTRACT_ADDRESS` | all | Deployed GhostVault address |
| `WALLET_ADDRESS` / `WALLET_KEY` | client | Gas-paying wallet |
| `MINT_WALLET_ADDRESS` / `MINT_WALLET_KEY` | mint | Mint's gas-paying wallet |
| `RPC_HTTP_URL` | client | HTTP RPC endpoint |
| `RPC_WS_URL` | mint | WebSocket RPC endpoint |
| `SCAN_FROM_BLOCK` | client | Starting block for event scanning |

---

## Cross-Language Parity

The Python library (`ghost_library.py`) is the cryptographic source of truth. The TypeScript port (`ghost-library.ts` + `bn254-crypto.ts`) produces byte-identical output for every operation.

Both languages use:
- Identical hash-to-curve (try-and-increment with `keccak256(msg || counter_be32)`)
- Identical token derivation (`keccak256(seed || index_be32)` → domain-separated keypairs)
- Identical message format (`"Pay to RAW: " || raw_20_byte_address`)
- The standard BN254 G2 generator (EIP-197 / `py_ecc.bn128.G2`)

Parity is enforced by shared test vectors:

```bash
uv run generate_vectors.py           # Generate (Python)
uv run pytest test_vectors.py -v     # Verify (Python)
npx vitest run                       # Verify (TypeScript)
```

Each vector tests: G2 key derivation, secret derivation, hash-to-curve, blinding, blind signature, unblinding, ECDSA proof, and full BLS pairing.

---

## Cryptographic Design

**Curve:** BN254 (`alt_bn128`) — the only pairing-friendly curve with native EVM precompile support (`ecAdd` 0x06, `ecMul` 0x07, `ecPairing` 0x08). ECDSA uses secp256k1 via `ecrecover`.

**Hash-to-curve:** Try-and-increment on `keccak256(address_20_bytes || counter_be32)`. Square root via `y = rhs^((p+1)/4) mod p` (valid since `p ≡ 3 mod 4`).

**Blind signature scheme:** Multiplicative blinding in the BN254 scalar field. The algebraic identity `S = S'·r⁻¹ = sk·r·Y·r⁻¹ = sk·Y` ensures the pairing equation holds without the mint ever seeing `Y`.

**Token index encoding:** 4-byte big-endian (`DataView.setUint32` / `int.to_bytes(4, 'big')`). The `Uint8Array` constructor pattern is avoided because it silently truncates values ≥ 256.

**Nullifier design:** The spend address (derived from the spend keypair) serves as the nullifier. It is passed explicitly to `redeem()` and checked against `spentNullifiers` to prevent double-spend. The ECDSA signature binds the nullifier to a specific recipient.

**G2 public key format:** EIP-197 limb order `[X_imag, X_real, Y_imag, Y_real]`. The `py_ecc` internal order is `FQ2([real, imag])` — all conversion code handles this correctly.

---

## Testing

```bash
# Python unit tests
uv run pytest ghost_library_test.py -v

# Cross-language vector tests
uv run pytest test_vectors.py -v     # Python
npx vitest run                       # TypeScript

# End-to-end smoke tests
uv run ghost_tip_test.py             # Python (or --mock for full offline flow)
npx tsx test.ts                      # TypeScript

# Full lifecycle (on-chain or mock)
./ghost_flow.sh --to 0xRecipient              # On-chain
./ghost_flow.sh --to 0xRecipient --mock       # Offline
./ghost_flow.sh --to 0xRecipient --dry-run    # Simulate
```

---

## Front End App


```bash
cd app
npm install
npm run dev
```


## Deployment Walkthrough


```bash
# 1. Generate all keys
uv run generate_keys.py

# 2. Derive BLS public key
uv run derive_bls.py 0x<privkey_from_env>

# 3. Deploy GhostVault with pkMint (4 uint256) and mintAuthority address
#    Set CONTRACT_ADDRESS in .env

# 4. Fund wallet addresses with testnet ETH

# 5. Start the mint server (separate terminal)
uv run mint_server.py

# 6. Deposit, scan, redeem (Python or TypeScript)
uv run client.py deposit --index 0
uv run client.py scan
uv run client.py redeem --index 0 --to 0xRecipient

# Or in TypeScript:
npx tsx client.ts deposit --index 0
npx tsx client.ts scan
npx tsx client.ts redeem --index 0 --to 0xRecipient
```

---

## Future Directions

- **Threshold blind signatures** — N-of-M mint committee for censorship resistance
- **TEE-backed mint** — attestation that the mint runs no-log code
- **Variable denominations** — multiple vaults with different face values
- **Relayer network** — gas-free redemption via meta-transactions
- **Cross-chain** — deposit on one chain, redeem on another via bridge attestations

---

## License

Dedicated to public goods under CC0.

---

(Buenos Aires, Sunday, March 22 / 9:00 AM Argentina Time)
