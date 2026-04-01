# GEMINI.md - NozKash Project Context

## Project Overview
NozKash is a privacy-preserving eCash protocol for EVM-compatible chains (defaulting to Ethereum Sepolia). It leverages **BLS blind signatures over the BN254 (alt_bn128) elliptic curve** to provide unlinkable token transfers without the high gas costs or complexity of zero-knowledge proofs (zk-SNARKs).

### Core Features
- **Privacy without ZK:** Uses elliptic curve math (BLS) supported natively by EVM precompiles.
- **High Efficiency:** Low gas costs (~50k for `deposit`, ~120k for `redeem`).
- **Minimal Trust:** The "mint" server signs tokens blindly; it cannot link deposits to redemptions or steal funds.
- **Stateless Recovery:** Secrets are derived deterministically from a master seed + token index.
- **Cross-Language Parity:** Identical cryptographic implementations in Python and TypeScript.

## Repository Architecture
The project is a monorepo containing the following key components:

- **`sol/`**: Solidity smart contracts and Foundry development environment.
  - `NozkVault.sol`: The core contract handling deposits, mint announcements, and redemptions.
- **`nozk_py/`**: Canonical Python implementation.
  - `nozk_library.py`: The cryptographic source of truth.
  - `mint_server.py`: WebSocket-based production mint daemon.
  - `client.py`: CLI wallet for deposit, scan, and redeem operations.
- **`nozk_ts/`**: TypeScript port of the crypto library and CLI client.
  - `nozk-library.ts`: Port ensuring byte-for-byte parity with Python.
  - `client.ts`: TypeScript CLI wallet.
- **`app/`**: React/Vite frontend application (mobile-first wallet UI).
- **`test_vectors/`**: Shared JSON test vectors ensuring parity across all implementations.
- **`abi/`**: Shared contract ABIs.

## Development Conventions

### Source of Truth Hierarchy
1. **Cryptography:** `nozk_py/nozk_library.py`
2. **Contract ABI:** `abi/nozk_vault_abi.json`
3. **Test Vectors:** `test_vectors/manifest.json`
4. **Environment:** `example.env`

### Cross-Language Parity
- Python and TypeScript crypto **must** produce byte-identical results.
- Any change to Python crypto must be reflected in TypeScript in the same commit.
- Parity is enforced via `generate_vectors.py` and corresponding tests in both languages.

### Implementation Patterns
- **Endianness:** All multi-byte values (integers, counters) use **big-endian** encoding.
- **Hash-to-Curve:** Try-and-increment with `keccak256(msg || counter_be32)`.
- **G2 Format:** EIP-197 limb order `[X_imag, X_real, Y_imag, Y_real]`.
- **ECDSA Message:** EIP-712 typed data: `NozkRedeem(address recipient, uint256 deadline)` with domain `NozkVault` v1.

## Building and Running

### Prerequisites
- Python 3.13+ (with `uv`)
- Node.js 20+ (with `npm`)
- Foundry (for Solidity)

### Environment Setup
1. Copy `example.env` to `.env` in the root or component directories.
2. Generate keys: `cd nozk_py && uv run generate_keys.py`.
3. Derive BLS public key: `cd nozk_py && uv run derive_bls.py 0x<PRIVATE_KEY>`.

### Key Commands

| Component | Install | Test | Run |
| :--- | :--- | :--- | :--- |
| **Python** | `cd nozk_py && uv sync` | `uv run pytest` | `uv run client.py --help` |
| **TypeScript**| `cd nozk_ts && npm install`| `npx vitest run` | `npx tsx client.ts --help` |
| **Solidity** | `cd sol && forge install` | `forge test` | `forge script script/NozkVault.s.sol` |
| **Frontend** | `cd app && npm install` | `npm run lint` | `npm run dev` |

### Full Lifecycle Test
Run the full flow (deposit -> mint -> redeem) using the helper script:
```bash
./nozk_flow.sh --to <RECIPIENT_ADDRESS> --mock
```

## Key Files for Reference
- `README.md`: High-level overview and technical details.
- `CONVENTIONS.md`: Detailed coding standards and parity rules.
- `nozk_py/nozk_library.py`: Primary cryptographic logic.
- `sol/src/NozkVault.sol`: On-chain vault implementation.
- `example.env`: Template for configuration.
