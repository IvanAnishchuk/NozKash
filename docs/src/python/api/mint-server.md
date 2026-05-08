# Mint Server API Reference

<!-- TODO: Auto-generate from mint_server.py -->

Source: `nozk_py/mint_server.py`

## Overview

The mint server is a stateless FastAPI daemon that watches for `DepositLocked` events on-chain and responds by blind-signing the deposited token via `announce()`.

## Endpoints

The mint server operates via WebSocket event subscription. It:

1. Connects to an Ethereum node via `RPC_WS_URL`
2. Watches for `DepositLocked` events on the NozkVault contract
3. Blind-signs each deposit's blinded point with the mint's BLS private key
4. Calls `announce(depositId, S')` on-chain

## Configuration

See [Environment Setup](../../getting-started/environment.md) for required environment variables.

## Running

```bash
cd nozk_py
uv run mint_server.py [--verbosity verbose|debug]
```
