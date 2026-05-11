# 👻 NozKash

**aleph-hackathon-m2026**

Default testnet: **Ethereum Sepolia** (chain ID 11155111).

[Simoneth Arianna Gomez](https://github.com/Simonethg), [Fabio Laura](https://github.com/raptor0929), [Ivan Anishchuk](https://github.com/IvanAnishchuk)

**Privacy-preserving eCash for EVM chains — without zero-knowledge proofs.**

nozkash uses BLS blind signatures over BLS12-381 to deliver unlinkable token transfers at a fraction of the gas cost of zk-SNARK privacy protocols. Users deposit a fixed denomination, receive a cryptographically blind-signed token from a mint, and redeem it to any address — the mint never learns which deposit corresponds to which redemption.

No circuits. No trusted setup. Just elliptic curve math via EIP-2537 Pectra precompiles.

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
Client                     NozkVault (on-chain)          Mint Server
  │                               │                            │
  │  derive spend + blind keys    │                            │
  │  Y = H(spendAddress)          │                            │
  │  B = r · Y                    │                            │
  │                               │                            │
  │── deposit(depositId, B) ─────▶│                            │
  │   + 0.001 ETH                 │── DepositLocked(id, B) ──▶│
  │                               │                            │  S' = sk · B
  │                               │◀── announce(id, S') ──────│
  │                               │                            │
  │  S = S' · r⁻¹  (unblind)     │                            │
  │  verify e(PK,Y)==e(G1,S)      │                            │
  │                               │                            │
  │── reveal(spendPub, S) ──────▶│  BLS pairing (EIP-2537)    │
  │── redeem(dest, sig, nId, dl)▶│                            │
  │                               │  BLS spend sig → verify    │
  │                               │  nullifier → double-spend  │
  │                               │── 0.001 ETH ─────────────▶ dest
```

**Blinding:** The client computes `B = r · H(spendAddress)` where `r` is a secret scalar. The mint sees only `B` — it cannot recover the spend address or link it to any future redemption.

**Signing:** The mint computes `S' = sk · B` without knowing what it signed. The client removes the blinding: `S = S' · r⁻¹ = sk · H(spendAddress)`.

**Verification:** The contract checks `e(pkMint, H_G2(spendPub)) == e(G1gen, S)` using the EIP-2537 BLS12-381 precompiles (Pectra). This is a single pairing check — no SNARK verification, no Groth16, no circuit compilation.

**MEV protection:** Redemption requires a BLS spend signature (AugSchemeMPL) over an EIP-712 message binding the recipient address and deadline. A front-runner cannot redirect funds without the spend private key.

**Stateless recovery:** All secrets derive deterministically from a master seed + token index. Lose your device, recover from seed.

---

## Gas Efficiency

nozkash uses EIP-2537 Pectra precompiles — no custom verifier contracts, no large proof calldata.

| Operation | Gas cost | What happens |
|-----------|----------|--------------|
| `deposit()` | ~50,000 | Store blinded G2 point + emit event |
| `announce()` | ~55,000 | Mint posts blind signature (G2) |
| `reveal()` | ~200,000 | BLS pairing check (EIP-2537) + register nullifier |
| `redeem()` | ~250,000 | BLS spend signature verification + ETH transfer |

For comparison, a zk-SNARK privacy pool typically costs 500k–1.5M gas per operation due to on-chain proof verification. nozkash's redeem costs less than a Uniswap swap.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | 3.13+ | Library, mint server, CLI wallet |
| Node.js | 20+ | TypeScript library, CLI client, test suite |
| [uv](https://docs.astral.sh/uv/) | latest | Python package management |
| npm | bundled with Node | TypeScript package management |
| [Foundry](https://book.getfoundry.sh/) | latest | Solidity testing and deployment |

---

## Quick Start

```bash
# Install dependencies
cd nozk_py && uv venv && uv sync       # Python
cd nozk_ts && npm install               # TypeScript (viem, mcl-wasm, @noble/curves, etc.)

# Generate keys and .env
cd nozk_py && uv run generate_keys.py

# Derive and add BLS public key to .env
cd nozk_py && uv run derive_bls.py 0x<your_bls_privkey>

# Run tests
cd nozk_py && uv run pytest -v          # Python unit + vector tests
cd nozk_ts && npx vitest run            # TypeScript vector parity tests
cd sol && forge test               # Solidity contract tests (forks Sepolia)

# Generate cross-language test vectors
cd nozk_py && uv run generate_vectors.py
```

---

## Repository Layout

```
├── README.md                         # This file
├── LICENSE.md                        # CC0 1.0 — public domain dedication
├── example.env                       # Template for .env configuration
├── nozk_flow.sh                     # Full lifecycle runner script
│
├── nozk_py/                               # Python: crypto library, mint, CLI wallet
│   ├── nozk_library.py              # Cryptographic library (source of truth)
│   ├── client.py                     # CLI wallet (deposit/scan/redeem/status/balance)
│   ├── mint_server.py                # Production mint daemon (WebSocket)
│   ├── mint_mock.py                  # Offline mock mint for testing
│   ├── redeem_mock.py                # Offline mock redeemer for testing
│   ├── contract_errors.py            # Decodes NozkVault revert selectors
│   ├── generate_keys.py              # Keypair + .env generator
│   ├── generate_vectors.py           # Cross-language test vector generator
│   ├── derive_bls.py                 # BLS pubkey derivation tool
│   ├── nozk_library_test.py         # Python unit tests
│   ├── test_vectors.py               # Python parametrized vector tests
│   ├── nozk_tip_test.py             # Python end-to-end smoke test
│   ├── test_vectors/                 # Generated vector files (JSON)
│   ├── pyproject.toml                # Python dependencies
│   └── README.md                     # Python-specific documentation
│
├── nozk_ts/                               # TypeScript: crypto library, CLI client, tests
│   ├── nozk-library.ts              # TypeScript crypto port (byte-for-byte parity)
│   ├── bls12-381-crypto.ts            # Low-level BLS12-381 primitives (noble-curves)
│   ├── client.ts                     # TypeScript CLI wallet (deposit/scan/redeem/balance)
│   ├── test-vectors.test.ts          # TypeScript parametrized vector tests
│   ├── test.ts                       # TypeScript end-to-end smoke test
│   ├── package.json                  # Node dependencies
│   └── tsconfig.json                 # TypeScript config
│
├── sol/                              # Solidity: smart contract + Foundry project
│   ├── src/
│   │   └── NozkVaultV2.sol          # Solidity smart contract (BLS12-381 + EIP-2537)
│   ├── test/
│   │   └── NozkVaultV2.t.sol        # Foundry test suite
│   ├── script/
│   │   └── NozkVaultV2.s.sol        # Deployment script
│   ├── scripts/
│   │   ├── generate_vectors.py       # Vector generator for Solidity tests
│   │   ├── nozk_library.py          # Standalone copy for sol/scripts
│   │   └── forge_test_generated_vectors.sh
│   ├── foundry.toml                  # Foundry configuration
│   ├── lib/forge-std/                # Forge standard library (git submodule)
│   └── README.md                     # Solidity-specific documentation
│
└── app/                              # Frontend: React wallet UI
    ├── src/
    │   ├── crypto/                   # Browser-bundled BLS12-381 + nozk-library
    │   ├── components/               # React components (Layout, DepositConfirmModal, Splash)
    │   ├── context/                  # NozkMasterSeedProvider, PrivacyProvider
    │   ├── hooks/                    # useWallet, useRedeemSign
    │   ├── lib/                      # nozkVault scanner, RPC helpers, ethereum utils
    │   ├── pages/                    # Dashboard, Deposit, Redeem, Recovery
    │   └── styles/                   # enozkash.css (full custom theme)
    └── ...
```

---

## Smart Contract

The NozkVaultV2 contract (`sol/src/NozkVaultV2.sol`) handles the complete token lifecycle using EIP-2537 Pectra precompiles:

| Function | Description |
|----------|-------------|
| `deposit(address depositId, uint256[8] B)` | Lock 0.001 ETH with a blinded G2 point |
| `announce(address depositId, uint256[8] S')` | Mint posts blind signature (authorized caller only) |
| `reveal(uint256[4] spendPub, uint256[8] S)` | BLS pairing check, register nullifier |
| `redeem(address recipient, uint256[8] spendSig, bytes32 nId, uint256 deadline)` | Verify BLS spend signature, transfer ETH |
| `revealAggregated(uint256[4][] spendPubs, uint256[8] sigma)` | Batch reveal with single pairing |
| `redeemAggregated(address recipient, uint256[8] sigma, bytes32[] nIds, uint256 deadline)` | Batch redeem with (n+1)-pairing |

On-chain verification:
1. **BLS pairing** (reveal) — `e(pkMint, Y) == e(G1_gen, S)` via EIP-2537 precompile
2. **BLS spend signature** (redeem) — AugSchemeMPL verification via EIP-2537
3. **Nullifier state** — UNREVEALED → REVEALED → SPENT (prevent double-reveal/double-spend)
4. **Hash-to-G2** — RFC 9380 via SHA-256 + MAP_FP2_TO_G2 precompile

---

## CLI Wallets

Both Python and TypeScript clients implement identical functionality, share the same wallet state file (`.nozk_wallet.json`), and use the same contract ABI.

### Python

```bash
cd nozk_py
uv run client.py deposit --index 0              # Lock 0.001 ETH
uv run client.py scan                            # Recover signed tokens (incremental)
uv run client.py redeem --index 0 --to 0xAddr    # Redeem to any address
uv run client.py status                          # Token lifecycle overview
uv run client.py balance                         # On-chain ETH balance
```

Additional flags: `--mock` (fully offline), `--dry-run` (simulate with RPC), `--verbosity verbose|debug|quiet`, `--relayer <url>` (gas-free redemption).

### TypeScript

```bash
cd nozk_ts
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
cd nozk_py
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
| `CONTRACT_ADDRESS` | all | Deployed NozkVault address |
| `WALLET_ADDRESS` / `WALLET_KEY` | client | Gas-paying wallet |
| `MINT_WALLET_ADDRESS` / `MINT_WALLET_KEY` | mint | Mint's gas-paying wallet |
| `RPC_HTTP_URL` | client | HTTP RPC endpoint |
| `RPC_WS_URL` | mint | WebSocket RPC endpoint |
| `SCAN_FROM_BLOCK` | client | Starting block for event scanning |

---

## Cross-Language Parity

The Python library (`nozk_py/nozk_library.py`) and the TypeScript port (`nozk_ts/nozk-library.ts` + `nozk_ts/bls12-381-crypto.ts`) must produce byte-identical output for every operation.

Both languages use:
- Identical hash-to-G2 (RFC 9380: SHA-256 + MAP_FP2_TO_G2, DST `BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_`)
- Identical token derivation (`keccak256(seed || index_be32)` → domain-separated keypairs)
- Identical EIP-712 redemption message (`NozkRedeem(address recipient, uint256 deadline)`)
- BLS AugSchemeMPL for spend signatures (chia_rs / noble-curves, both wrapping blst)

Parity is enforced by shared test vectors:

```bash
cd nozk_py && uv run generate_vectors.py        # Generate (Python)
cd nozk_py && uv run pytest test_vectors.py -v  # Verify (Python)
cd nozk_ts && npx vitest run                    # Verify (TypeScript)
```

Each vector tests: G1 key derivation, secret derivation, hash-to-G2, blinding, blind signature, unblinding, BLS spend proof, and full pairing verification.

---

## Cryptographic Design

**Curve:** BLS12-381 — ~120-bit security, standard for Ethereum consensus. Uses EIP-2537 Pectra precompiles (`BLS12_G1ADD` 0x0b, `BLS12_G1MSM` 0x0c, `BLS12_G2ADD` 0x0d, `BLS12_PAIRING` 0x0f, `BLS12_MAP_FP2_TO_G2` 0x11).

**BLS scheme:** Standard (PK in G1, Sig in G2). Spend auth uses AugSchemeMPL (chia_rs / blst).

**Hash-to-G2:** RFC 9380 (`expand_message_xmd` with SHA-256, two field elements, SSWU map, cofactor clearing). DST: `BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_`.

**Blind signature scheme:** Multiplicative blinding in the BLS12-381 scalar field. The algebraic identity `S = S'·r⁻¹ = sk·r·Y·r⁻¹ = sk·Y` ensures the pairing equation holds without the mint ever seeing `Y`.

**Token index encoding:** 4-byte big-endian (`DataView.setUint32` / `int.to_bytes(4, 'big')`). The `Uint8Array` constructor pattern is avoided because it silently truncates values ≥ 256.

**Nullifier design:** The nullifier ID is `keccak256(abi.encode(spendPub_G1))`. The spend public key (G1) is registered on-chain during `reveal()` and the nullifier state prevents double-spend. The BLS spend signature (AugSchemeMPL) binds the nullifier to a specific recipient and deadline.

**Point encoding:** G1 points use 4 x uint256 (128 bytes, EIP-2537 uncompressed). G2 points use 8 x uint256 (256 bytes, EIP-2537 uncompressed). Fp2 coefficients are in `[c0, c1]` order (c0 + c1·u).

---

## Testing

```bash
# Python unit tests
cd nozk_py && uv run pytest nozk_library_test.py -v

# Cross-language vector tests
cd nozk_py && uv run pytest test_vectors.py -v     # Python
cd nozk_ts && npx vitest run                       # TypeScript

# Solidity contract tests (forks Ethereum Sepolia)
cd sol && forge test

# End-to-end smoke tests
cd nozk_py && uv run nozk_tip_test.py             # Python (or --mock for full offline flow)
cd nozk_ts && npx tsx test.ts                      # TypeScript

# Full lifecycle (on-chain or mock)
./nozk_flow.sh --to 0xRecipient              # On-chain
./nozk_flow.sh --to 0xRecipient --mock       # Offline
./nozk_flow.sh --to 0xRecipient --dry-run    # Simulate
```

---

## Frontend App

NozKash ships with a mobile-first React wallet UI in the `app/` directory. It connects to MetaMask, derives vault secrets client-side, and talks directly to the deployed NozkVault contract — no backend server required for the wallet itself.

<!-- TODO: add screenshots
![Dashboard](docs/screenshots/dashboard.png)
![Deposit modal](docs/screenshots/deposit-modal.png)
![Redeem page](docs/screenshots/redeem.png)
-->

### Quick start

```bash
cd app
npm install
npm run dev          # Vite dev server
npm run build        # Production build → dist/
```

Copy `.env.example` to `.env` if you need to override the RPC endpoint or inject a dev master seed.

### Stack

Vite 8 + React 19 + Tailwind 4 + TypeScript 5.9. The crypto libraries (`mcl-wasm`, `@noble/curves`, `ethereum-cryptography`) are the same ones used by the CLI clients — the app bundles its own copies under `app/src/crypto/` (`bn254-crypto.ts`, `nozk-library.ts`, `nozkDeposit.ts`) so it runs entirely in the browser with no server-side crypto.

### Architecture

The app is a single-page wallet with four routes:

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard | Balance card, token stats (valid/spent), activity feed with date range + type filters, deposit button |
| `/deposit` | Deposit | Opens the deposit confirmation modal and redirects home |
| `/redeem` | Redeem | Lists redeemable tokens (MintFulfilled), recipient picker from MetaMask accounts or manual address entry |
| `/recovery` | Recovery | Blockchain scanner — re-derives token indices from seed and checks on-chain state |

### Key components

**`NozkMasterSeedProvider`** — React context that manages the vault master seed. On wallet connect, it prompts a one-time `personal_sign` in MetaMask to derive the seed deterministically (`keccak256(signature)`) — the seed lives only in RAM and is cleared on disconnect. For development, `VITE_NOZK_MASTER_SEED_HEX` bypasses the signature.

**`DepositConfirmModal`** — The deposit flow: amount selection (fixed 0.001 ETH denomination), real-time gas estimation via the configured RPC, calldata construction using `buildNozkVaultDepositCalldata()` (derives secrets → blinds → ABI-encodes `deposit(address,uint256[8])`), and `eth_sendTransaction` through MetaMask. Includes pre-flight checks: `DENOMINATION()` view call, `depositPending()` collision check, and `eth_call` simulation before broadcasting.

**`useWallet`** — Hook managing MetaMask connection, account switching (`wallet_requestPermissions`), chain enforcement (auto-switches to the target chain from `VITE_CHAIN_ID`), and balance polling.

**`nozkVault.ts`** — On-chain scanner that fetches `DepositLocked` and `MintFulfilled` events via `eth_getLogs`, matches them against derived `depositId`s, checks `spentNullifiers`, and assembles the activity feed. Handles RPC rate limiting (burst queue with pause), block range chunking (Avalanche public RPC caps at ~2048 blocks per query), and `last accepted block` edge cases.

### Seed derivation (wallet-based)

When no `VITE_NOZK_MASTER_SEED_HEX` is set, the app derives the master seed from a MetaMask signature:

1. User connects wallet → app prompts `personal_sign` with a deterministic message containing the account address and chain ID
2. The 65-byte ECDSA signature is hashed: `masterSeed = keccak256(signature)`
3. This seed is used for all `deriveTokenSecrets()` calls — same as the CLI clients
4. The seed stays in React state (RAM only) — disconnecting the wallet clears it

This means a user can recover their vault tokens on any device by connecting the same MetaMask account and signing the same derivation message.

### On-chain interaction

All RPC calls go through `chainPublicRpc.ts`, which uses `VITE_PUBLIC_RPC_URL` when set, otherwise a bundled Sepolia public endpoint. If the browser hits CORS errors locally, configure the provider to allow your origin or point `VITE_PUBLIC_RPC_URL` at an endpoint that does.

The deposit transaction is the only write operation — it uses MetaMask's `eth_sendTransaction` with pre-built calldata (same ABI encoding as the Python/TypeScript CLI clients). The app polls `eth_getTransactionReceipt` via HTTP RPC (not MetaMask) with a 30-second interval to avoid rate limits.

### Contract address

Set `VITE_NOZK_VAULT_ADDRESS` in `.env` to the deployed contract address.

### App environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_NOZK_MASTER_SEED_HEX` | — | Dev shortcut: 64-char hex seed, bypasses `personal_sign` |
| `VITE_CHAIN_ID` | Sepolia `0xaa36a7` | Target `eth_chainId` (hex) |
| `VITE_PUBLIC_RPC_URL` / `VITE_ETHEREUM_RPC_URL` | Sepolia public node | HTTPS JSON-RPC for reads (`chainRpcCall`) |
| `VITE_PUBLIC_WS_RPC_URL` / `VITE_ETHEREUM_WS_RPC_URL` | — | Optional WebSocket for live vault logs |
| `VITE_NOZK_VAULT_ADDRESS` | — | Deployed NozkVault contract |

---


## Deployment Walkthrough


```bash
# 1. Generate all keys
cd nozk_py && uv run generate_keys.py

# 2. Derive BLS public key
cd nozk_py && uv run derive_bls.py 0x<privkey_from_env>

# 3. Deploy NozkVault with pkMint (4 uint256) and mintAuthority address
#    (via Foundry)
cd sol && forge script script/NozkVault.s.sol:NozkVaultScript --rpc-url <your_rpc_url> --private-key <your_private_key>
#    Set CONTRACT_ADDRESS in .env

# 4. Fund wallet addresses with testnet ETH

# 5. Start the mint server (separate terminal)
cd nozk_py && uv run mint_server.py

# 6. Deposit, scan, redeem (Python or TypeScript)
cd nozk_py
uv run client.py deposit --index 0
uv run client.py scan
uv run client.py redeem --index 0 --to 0xRecipient

# Or in TypeScript:
cd nozk_ts
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
