# Agent Instructions for NozKash

This file guides AI coding assistants working in this repository.

## Project Mission

**NozKash** is a privacy-preserving eCash system for EVM chains using BLS blind signatures over BN254. It aims to provide unlinkable fixed-denomination transfers without zero-knowledge proofs, using standard EVM precompiles (`ecAdd`, `ecMul`, `ecPairing`, `ecrecover`).

**Default testnet:** Ethereum Sepolia (`11155111`)

## Repository Organization

```text
nozk_py/         Python source of truth: crypto library, mint server, CLI wallet
nozk_ts/         TypeScript crypto port, tests, CLI wallet
sol/             Solidity NozkVault contract (Foundry)
app/             Vite + React frontend wallet
test_vectors/    Shared cross-language test vectors
abi/             Shared contract ABI
```

Additional repo-level docs you may want to inspect before larger changes:

- `README.md`
- `CONVENTIONS.md`
- `GEMINI.md`
- `CLAUDE.md`

## Critical Files

- `nozk_py/nozk_library.py` — cryptographic source of truth
- `nozk_ts/nozk-library.ts` — TypeScript parity port of the Python crypto
- `sol/src/NozkVault.sol` — on-chain deposit / announce / redeem / refund logic
- `test_vectors/manifest.json` — shared vector registry used across languages
- `abi/nozk_vault_abi.json` — shared ABI generated from Foundry artifacts
- `app/vite.config.ts` — frontend aliasing of `@nozk` to `../nozk_ts`

## Current Architecture Notes

- The protocol uses a fixed denomination of `0.001 ether` per token.
- `depositId` is the blind address and is an `address` on-chain.
- The contract supports `deposit`, `announce`, `redeem`, and `refund`.
- Refunds are only possible while a deposit is awaiting mint fulfillment.
- Redemption currently uses an EIP-712 typed message:
  `NozkRedeem(address recipient,uint256 deadline)`
- The contract stores the mint G2 pubkey in EIP-197 limb order:
  `[X_imag, X_real, Y_imag, Y_real]`
- Hash-to-curve is try-and-increment with `keccak256(message || uint32_be(counter))`
- Frontend code must reuse `nozk_ts` via the `@nozk` alias. Do not duplicate crypto implementations inside `app/src/crypto`.

## Workflow Commands

### Python (`nozk_py/`)

```bash
cd nozk_py

uv venv
uv sync --group dev

uv run ruff check .
uv run ruff format .
uv run ty check
uv run pytest -v

uv run pytest nozk_library_test.py::test_blind_sign -v
uv run generate_vectors.py

uv run mint_server.py --verbosity verbose

uv run client.py deposit --index 0
uv run client.py scan
uv run client.py status
uv run client.py balance
uv run client.py redeem --index 0 --to 0xRecipientAddress
```

### TypeScript (`nozk_ts/`)

```bash
cd nozk_ts

npm install

npm run lint
npm run lint:fix
npm run format
npm run typecheck
npm run test

npx tsx test.ts

npx tsx client.ts deposit --index 0
npx tsx client.ts scan
npx tsx client.ts redeem --index 0 --to 0xRecipientAddress
```

### Solidity (`sol/`)

```bash
cd sol

forge build
forge test
forge test -vvv
forge fmt

forge script script/NozkVault.s.sol:NozkVaultScript \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast --verify

python3 sync_abi.py
```

Notes:

- `forge snapshot` is not currently part of the checked-in Solidity workflow.
- Solidity tests use Foundry and the repo currently includes fork-oriented endpoint config in `sol/foundry.toml`.

### Frontend (`app/`)

```bash
cd nozk_ts && npm install
cd ../app && npm install

npm run lint
npm run build
npm run dev
npm run deploy
```

Notes:

- The frontend depends on `nozk_ts/node_modules` being installed first.
- The app currently uses Vite, React 19, ESLint, and Tailwind via `@tailwindcss/vite`.

### End-to-End Flow

```bash
./nozk_flow.sh --to 0xRecipient
./nozk_flow.sh --to 0xRecipient --mock
./nozk_flow.sh --to 0xRecipient --dry-run
```

## Cross-Language Parity Rules

`nozk_py/nozk_library.py` is the source of truth. Any cryptographic behavior change must be reflected in `nozk_ts/nozk-library.ts`.

When changing cryptography:

1. Update Python first.
2. Port the exact behavior to TypeScript.
3. Regenerate vectors with `cd nozk_py && uv run generate_vectors.py`.
4. Verify Python vectors with `cd nozk_py && uv run pytest test_vectors.py -v`.
5. Verify TypeScript parity with `cd nozk_ts && npx vitest run`.

Test vector facts:

- Files live under `test_vectors/<keypair_dir>/token_<index>.json`
- `test_vectors/manifest.json` is the registry all suites read
- Vectors cover derivation, hash-to-curve, blinding, signing, unblinding, and redemption inputs

## Smart Contract Notes

`sol/src/NozkVault.sol` currently:

- hardcodes `DENOMINATION = 0.001 ether`
- enforces a single mint authority for `announce`
- exposes `refund(address depositId)` for unfulfilled deposits
- verifies redemptions with EIP-712 + `ecrecover` + BN254 pairing
- prevents double-spend with `spentNullifiers`

If the ABI changes:

1. Rebuild with `forge build`
2. Run `cd sol && python3 sync_abi.py`
3. Confirm `abi/nozk_vault_abi.json` changed as expected
4. Update Python, TypeScript, and frontend callers

## Frontend Constraints

- Import shared crypto via `@nozk/...`, not duplicated browser-only rewrites.
- Keep master seed handling in memory only.
- Preserve the existing chunked event scanning approach in `app/src/lib/nozkVault*.ts`.
- Check for existing refund and live-activity flows before changing dashboard logic.

## Environment Files

Primary shared template:

- `example.env`

Additional mint template:

- `mint.ethereum.testnet.env.example`

Common variables used across components include:

```bash
MASTER_SEED=...
MINT_BLS_PRIVKEY=...
MINT_BLS_PUBKEY=...
CONTRACT_ADDRESS=...
CHAIN_ID=11155111
RPC_HTTP_URL=...
RPC_WS_URL=...
WALLET_ADDRESS=...
WALLET_KEY=...
MINT_WALLET_ADDRESS=...
MINT_WALLET_KEY=...
DEPLOYER_PRIVATE_KEY=...
```

Frontend-specific variables include:

```bash
VITE_CHAIN_ID=0xaa36a7
VITE_PUBLIC_RPC_URL=...
VITE_NOZK_VAULT_ADDRESS=...
VITE_NOZK_MASTER_SEED_HEX=...
```

## Common Tasks for Agents

### Crypto Changes

1. Edit `nozk_py/nozk_library.py`
2. Update tests in `nozk_py/nozk_library_test.py`
3. Port behavior to `nozk_ts/nozk-library.ts`
4. Regenerate vectors
5. Run Python and TypeScript parity tests

### Contract Changes

1. Edit `sol/src/NozkVault.sol`
2. Run `forge build` and `forge test`
3. Sync ABI if needed
4. Update downstream callers in `nozk_py`, `nozk_ts`, and `app`

### Frontend Changes

1. Install `nozk_ts` dependencies first, then `app`
2. Reuse shared crypto via `@nozk`
3. Run `npm run lint` and `npm run build` in `app`

### Debugging Mismatches

1. Run Python vector tests
2. Run TypeScript vector tests
3. Check hash-to-curve counter encoding
4. Check G1/G2 serialization and limb order
5. Check keccak input byte order
6. Check EIP-712 domain / typed-data fields if redemption signatures fail

## Testing Philosophy

- Python unit tests cover crypto and client-side helpers
- TypeScript tests enforce parity and client behavior
- Solidity tests validate contract behavior
- `nozk_flow.sh` exercises the full lifecycle in live, mock, or dry-run modes
- Cross-language vectors are mandatory whenever crypto behavior changes

## CI Status

GitHub Actions currently runs:

- Python: `ruff check`, `ruff format --check`, `ty check`, `pytest -v`
- TypeScript: `biome check .`, `tsc --noEmit`, `vitest run`
- Solidity: `forge build`, `forge test`
- Frontend: `npm run build`

The current CI workflow does **not** run frontend linting.

## Security Considerations

- Never commit secrets or filled `.env` files.
- Do not weaken nullifier double-spend protections.
- Keep redemption bound to the intended recipient and deadline.
- Preserve blind-signature unlinkability when touching derivation, blinding, or scanning logic.
- Be careful with any change that increases depositor-to-deposit linkage on-chain or in logs.
