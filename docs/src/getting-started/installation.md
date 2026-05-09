# Installation

## Prerequisites

- Python 3.13+ with [uv](https://docs.astral.sh/uv/)
- Node.js 20+ with npm
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`, `anvil`)

## Python Library & Mint

```bash
cd nozk_py
uv venv && uv sync
```

## TypeScript Library

```bash
cd nozk_ts
npm install
```

## Smart Contracts

```bash
cd sol
forge install
forge build
```

## Frontend App

Requires `nozk_ts` node_modules installed first:

```bash
cd nozk_ts && npm install
cd ../app && npm install
```

## Verify Installation

Run the full check to confirm everything builds and passes:

```bash
cd nozk_py && uv run pre-commit run --all-files && \
  uv run pytest -v && \
  cd ../nozk_ts && npx vitest run && \
  cd ../sol && forge build && forge test && \
  cd ../app && npm run build
```
