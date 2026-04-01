# Agent Instructions for NozKash

This file provides guidance to AI coding assistants (Codex, Jules, OpenCode, etc.) working with the NozKash codebase.

## Project Mission

**NozKash** is a privacy-preserving eCash system for EVM chains using BLS blind signatures over BN254. The goal is to provide unlinkable token transfers without zero-knowledge proofs, using only standard EVM precompiles (`ecAdd`, `ecMul`, `ecPairing`, `ecrecover`).

**Default testnet:** Ethereum Sepolia (chain ID 11155111)

## Repository Organization

```
nozk_py/         # Python: crypto library (SOURCE OF TRUTH), mint server, CLI wallet
nozk_ts/         # TypeScript: byte-for-byte crypto port, CLI wallet
sol/             # Solidity: NozkVault smart contract (Foundry project)
app/             # React frontend wallet (Vite + React 19 + Tailwind)
test_vectors/    # Shared cross-language test vectors
abi/             # Shared contract ABI (single source)
```

### Critical Files

- **`nozk_py/nozk_library.py`** — Cryptographic source of truth. All crypto changes start here.
- **`nozk_ts/nozk-library.ts`** — Byte-for-byte port of Python crypto. Must match exactly.
- **`sol/src/NozkVault.sol`** — Smart contract with BLS pairing verification logic.
- **`test_vectors/manifest.json`** — Registry of all test vectors. Used by all test suites.
- **`abi/nozk_vault_abi.json`** — Single source of truth for contract ABI.

## Workflow Commands

### Python Development (`nozk_py/`)

```bash
cd nozk_py

# Setup
uv venv && uv sync

# Development cycle
uv run ruff check . && uv run ruff format . && uv run ty check && uv run pytest -v

# Run specific test
uv run pytest nozk_library_test.py::test_blind_sign -v

# Generate test vectors (REQUIRED after crypto changes)
uv run generate_vectors.py

# Run mint server
uv run mint_server.py --verbosity verbose

# CLI wallet operations
uv run client.py deposit --index 0
uv run client.py scan
uv run client.py balance
uv run client.py redeem --index 0 --to 0xRecipientAddress
```

### TypeScript Development (`nozk_ts/`)

```bash
cd nozk_ts
npm install

# Development cycle
npx biome check --fix . && npx tsc --noEmit && npx vitest run

# End-to-end test
npx tsx test.ts

# CLI wallet
npx tsx client.ts deposit --index 0
npx tsx client.ts scan
npx tsx client.ts redeem --index 0 --to 0xAddr
```

### Solidity Development (`sol/`)

```bash
cd sol

# Development cycle
forge build && forge test && forge fmt && forge snapshot

# Verbose test output
forge test -vvv

# Run specific test
forge test --match-test testDeposit

# Deploy to testnet
forge script script/NozkVault.s.sol:NozkVaultScript \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast --verify

# After deployment, sync ABI to abi/ directory
python sync_abi.py
```

### Frontend Development (`app/`)

```bash
cd app
npm install  # Requires nozk_ts node_modules to be installed first

# Development cycle
npm run lint && npm run build

# Local dev server
npm run dev

# Deploy to GitHub Pages
npm run deploy
```

### Full Stack Testing

```bash
# End-to-end lifecycle test
./nozk_flow.sh --to 0xRecipient             # on-chain
./nozk_flow.sh --to 0xRecipient --mock      # offline
./nozk_flow.sh --to 0xRecipient --dry-run   # simulate
```

## Protocol Architecture

### Blind Signature Flow

1. **Client derives secrets:** From `(masterSeed, index)` → `spend_priv`, `blind_priv`
2. **Client blinds token:** `B = r · H_G1(spend_addr)` where `r` is blinding factor
3. **Contract deposits:** User locks 0.001 ETH, contract emits `DepositLocked(depositId, B)`
4. **Mint signs blindly:** Mint computes `S' = sk · B` and posts via `announce()`
5. **Client unblinds:** `S = S' · r⁻¹ = sk · H(spend_addr)`
6. **Client redeems:** Provides `S` + ECDSA proof binding to recipient
7. **Contract verifies:** Checks BLS pairing + ecrecover, prevents double-spend, transfers ETH

### Key Properties

- **Unlinkability:** Mint never learns the mapping between deposits and redemptions
- **Unforgeability:** Only the mint can produce valid signatures (verified via pairing)
- **Non-custodial:** Users control redemption recipient (MEV-protected via ECDSA)
- **Stateless recovery:** All secrets re-derivable from seed

## Critical Constraints

### Cross-Language Parity

**MANDATORY:** `nozk_py/nozk_library.py` and `nozk_ts/nozk-library.ts` must produce byte-identical output for all operations.

**When modifying cryptography:**
1. Always update `nozk_py/nozk_library.py` first (source of truth)
2. Port changes to `nozk_ts/nozk-library.ts` maintaining exact behavior
3. Run `cd nozk_py && uv run generate_vectors.py` to regenerate test vectors
4. Verify parity: `cd nozk_py && uv run pytest test_vectors.py -v`
5. Verify TypeScript: `cd nozk_ts && npx vitest run`

**Test vector system:**
- Test vectors are JSON files in `test_vectors/<keypair_dir>/`
- `test_vectors/manifest.json` lists all keypair directories and token indices
- Foundry reads from the manifest; pytest and vitest auto-discover by scanning directories
- Vectors cover: key derivation, hash-to-curve, blinding, signing, unblinding, redemption

### Fixed Architecture Constraints

- **Denomination:** 0.001 ETH per token (hardcoded in contract, cannot change)
- **Limited refund path:** Depositors can reclaim ETH only if mint never fulfills (before `announce()`). Once announced, redemption is the only exit path
- **Stateless mint:** Mint stores nothing locally, all state is on-chain
- **G2 pubkey format:** Stored in EIP-197 limb order `[X_imag, X_real, Y_imag, Y_real]`
- **Hash-to-curve:** Uses try-and-increment with `keccak256(msg || counter_be32)`

### Frontend-Specific Constraints

- **Crypto library sharing:** Frontend imports `nozk_ts/` directly via `@nozk/` alias
- **No crypto duplication:** `app/src/crypto/` contains only wrappers, not implementations
- **Seed in memory only:** Master seed never persisted, derived from wallet signature
- **Event scanning:** Uses chunked `eth_getLogs` with ~2048 block windows

## Environment Setup

Copy `example.env` to `.env` and configure:

```bash
# Shared
MASTER_SEED=0x...              # Wallet master seed
MINT_BLS_PRIVKEY=0x...         # Mint signing key
MINT_BLS_PUBKEY=...            # G2 pubkey (4 uint256, comma-separated)
CONTRACT_ADDRESS=0x...         # Deployed NozkVault
CHAIN_ID=11155111              # Ethereum Sepolia

# Forge deployment (sol/)
PK_MINT_X_IMAG=...
PK_MINT_X_REAL=...
PK_MINT_Y_IMAG=...
PK_MINT_Y_REAL=...
MINT_AUTHORITY=0x...
DEPLOYER_PRIVATE_KEY=0x...

# Mint server (nozk_py/)
RPC_WS_URL=wss://...
MINT_WALLET_ADDRESS=0x...
MINT_WALLET_KEY=0x...

# CLI wallet (nozk_py/, nozk_ts/)
WALLET_ADDRESS=0x...
WALLET_KEY=0x...
RPC_HTTP_URL=https://...

# Frontend (app/)
VITE_CHAIN_ID=0xaa36a7
VITE_PUBLIC_RPC_URL=https://...
VITE_NOZK_VAULT_ADDRESS=0x...
VITE_NOZK_MASTER_SEED_HEX=0x...  # Dev only
```

## Common Tasks for Agents

### Adding a New Cryptographic Function

1. Implement in `nozk_py/nozk_library.py` with full docstring
2. Add unit tests in `nozk_py/nozk_library_test.py`
3. Run tests: `cd nozk_py && uv run pytest nozk_library_test.py -v`
4. Port to `nozk_ts/nozk-library.ts` (exact same logic)
5. Add test vectors to `nozk_py/generate_vectors.py`
6. Regenerate: `cd nozk_py && uv run generate_vectors.py`
7. Verify parity: Run pytest and vitest on test vectors

### Modifying Smart Contract

1. Edit `sol/src/NozkVault.sol`
2. Run `forge build` to compile
3. Run `forge test -vvv` to verify tests pass
4. Update gas snapshots: `forge snapshot`
5. If interface changed, sync ABI: `cd sol && python sync_abi.py` (creates `abi/nozk_vault_abi.json`)
6. Update TypeScript/Python clients if ABI changed

### Adding Frontend Features

1. Ensure `nozk_ts/node_modules` is installed
2. Edit files in `app/src/`
3. Import crypto via `import { ... } from '@nozk/nozk-library'`
4. Run `npm run lint` and fix issues
5. Test with `npm run dev`
6. Build with `npm run build`

### Deploying Contract Updates

1. Update mint BLS pubkey in `sol/.env` (if changed)
2. Run deployment script with `--broadcast --verify`
3. Note deployed contract address
4. Update `CONTRACT_ADDRESS` in all `.env` files
5. Sync ABI: `cd sol && python sync_abi.py`
6. Update frontend `.env` with new contract address

### Debugging Cryptographic Mismatches

1. Check test vectors: `cd nozk_py && uv run pytest test_vectors.py -v`
2. Compare Python vs TypeScript output for specific test case
3. Verify hash-to-curve counter logic (common mismatch point)
4. Check byte order in G1/G2 point serialization
5. Verify keccak256 input concatenation (endianness matters)

## Testing Philosophy

- **Unit tests:** Individual crypto operations (Python: pytest, TypeScript: vitest)
- **Cross-language vectors:** Enforce Python-TypeScript parity
- **End-to-end tests:** Full deposit-mint-redeem cycle (`nozk_tip_test.py`, `test.ts`)
- **Solidity tests:** Fork Sepolia for realistic precompile behavior
- **Integration test:** `./nozk_flow.sh` tests all components together

## Gas Efficiency

Target costs:
- `deposit()`: ~50k gas (locks 0.001 ETH)
- `announce()`: ~55k gas
- `redeem()`: ~120k gas (transfers 0.001 ETH)
- `refund()`: ~30k gas (only if mint never fulfilled)

When modifying contract, always run `forge snapshot` and verify gas costs haven't increased significantly.

## Security Considerations

- **No secrets in code:** Use environment variables for all keys
- **Nullifier double-spend:** `spentNullifiers` mapping prevents token reuse
- **MEV protection:** ECDSA signature binds redemption to specific recipient
- **Mint trust model:** Mint can deny service but cannot forge tokens or steal funds
- **Blinding factor security:** `r` must be uniformly random and secret

## CI/CD

GitHub Actions runs:
- Python: ruff lint/format, ty typecheck, pytest
- TypeScript: biome lint/format, tsc typecheck, vitest
- Solidity: forge build, forge test
- Frontend: npm build

All checks must pass before merging. See `.github/workflows/ci.yml` for details.
