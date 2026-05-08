# nozk_py Packaging Plan

To enable editable install (`uv add --editable ../nozk_py`) and proper autodoc via mkdocstrings, nozk_py needs standard Python package structure.

## Current Structure (flat scripts)

```
nozk_py/
├── pyproject.toml
├── nozk_library.py
├── bls12_381_crypto.py
├── bn254_crypto.py
├── client.py
├── mint_server.py
├── relayer_server.py
├── wallet_state.py
├── contract_errors.py
├── nozk_theme.py
├── generate_keys.py
├── derive_bls.py
├── generate_vectors.py
├── fund_addresses.py
├── mint_mock.py
├── redeem_mock.py
├── nozk_library_test.py
├── test_vectors.py
├── mock_test.py
├── nozk_tip_test.py
├── test_e2e_anvil.py
└── contract_errors_test.py
```

## Proposed Structure

```
nozk_py/
├── pyproject.toml
├── src/
│   └── nozk/                    # importable package: `from nozk import library`
│       ├── __init__.py
│       ├── library.py           # was nozk_library.py
│       ├── bls12_381.py         # was bls12_381_crypto.py
│       ├── bn254.py             # was bn254_crypto.py (legacy, kept for BN254 vault)
│       ├── wallet.py            # was wallet_state.py
│       ├── errors.py            # was contract_errors.py
│       └── theme.py             # was nozk_theme.py
├── cli/
│   └── client.py                # typer CLI entry point (or nozk.cli module)
├── servers/
│   ├── mint.py                  # was mint_server.py
│   └── relayer.py               # was relayer_server.py
├── scripts/
│   ├── generate_keys.py
│   ├── derive_bls.py
│   ├── generate_vectors.py
│   ├── fund_addresses.py
│   ├── mint_mock.py
│   └── redeem_mock.py
└── tests/
    ├── test_library.py          # was nozk_library_test.py
    ├── test_vectors.py
    ├── test_mock.py             # was mock_test.py
    ├── test_tip.py              # was nozk_tip_test.py
    ├── test_e2e_anvil.py
    └── test_contract_errors.py
```

## pyproject.toml Changes

```toml
[project]
name = "nozkash"
version = "0.1.0"
requires-python = ">=3.13"
dependencies = [...]

[project.scripts]
nozk = "nozk.cli:app"          # `uv run nozk deposit --index 0`
nozk-mint = "nozk.servers.mint:main"
nozk-relayer = "nozk.servers.relayer:main"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

## Migration Steps

1. Create `src/nozk/` package with `__init__.py`
2. Move library modules into `src/nozk/`, rename to shorter names
3. Move tests into `tests/`, update imports
4. Move CLI into `cli/` or `src/nozk/cli.py`, register as entry point
5. Move servers into `servers/` or `src/nozk/servers/`
6. Move scripts into `scripts/`
7. Update all internal imports (`from nozk.library import ...`)
8. Update TypeScript cross-language test references
9. Update `nozk_flow.sh` and any shell scripts
10. Update CLAUDE.md commands
11. Update docs/zensical.toml mkdocstrings paths

## What This Unblocks

- `uv add --editable ../nozk_py` works from docs project
- mkdocstrings can autodoc via `::: nozk.library`
- mkdocs-typer2 can autodoc CLI via `:module: nozk.cli`
- `pip install -e .` works for downstream consumers
- pytest discovers tests automatically
- Entry points (`nozk`, `nozk-mint`) replace `uv run client.py`

## Known Issues to Fix During Migration

- `import requests` in client.py should be `import httpx` (requests is not a declared dependency)
