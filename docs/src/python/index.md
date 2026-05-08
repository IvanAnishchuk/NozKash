# Python Library (`nozk_py`)

The Python implementation is the **cryptographic source of truth** for NozKash. All other implementations must produce byte-identical output.

## Components

| Module | Description |
|--------|-------------|
| `nozk_library.py` | Core blind signature protocol (blind, unblind, verify, redeem proof) |
| `bn254_crypto.py` | BN254 curve operations (hash-to-curve, point arithmetic) |
| `bls12_381_crypto.py` | BLS12-381 curve operations via `chia_rs` |
| `mint_server.py` | FastAPI/WebSocket mint daemon |
| `client.py` | Typer CLI wallet |
| `generate_vectors.py` | Test vector generator |

## Tooling

- **Runtime:** Python 3.13+, managed with [uv](https://docs.astral.sh/uv/)
- **Linting/formatting:** ruff (120-char lines, double quotes)
- **Type checking:** ty
- **Testing:** pytest

## Quick Commands

```bash
cd nozk_py

# Dev cycle
uv run ruff check . && uv run ruff format --check . && uv run ty check && uv run pytest -v

# Run mint server
uv run mint_server.py

# CLI wallet
uv run client.py deposit --index 0
uv run client.py scan
uv run client.py redeem --index 0 --to 0xAddr
```

## Sections

- [API Reference](api/nozk-library.md) -- core library functions
- [Curve Crypto](api/curve-crypto.md) -- BN254 and BLS12-381 backends
- [Mint Server](api/mint-server.md) -- server API
- [CLI Wallet](cli.md) -- command reference
- [Test Vectors](test-vectors.md) -- cross-language parity testing
