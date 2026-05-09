# Environment Setup

Copy the example environment file and fill in your values:

```bash
cp example.env .env
```

## Required Variables

| Variable | Description |
|----------|-------------|
| `MASTER_SEED` | Hex seed for wallet key derivation |
| `MINT_BLS_PRIVKEY` | BLS scalar (mint server only) |
| `MINT_BLS_PUBKEY` | G2 public key (4 uint256, comma-separated) |
| `CONTRACT_ADDRESS` | Deployed NozkVault address |
| `CHAIN_ID` | Target chain (default: `11155111` = Sepolia) |

## Mint Server

| Variable | Description |
|----------|-------------|
| `RPC_WS_URL` | WebSocket RPC endpoint |
| `MINT_WALLET_ADDRESS` | Mint's Ethereum address |
| `MINT_WALLET_KEY` | Mint's Ethereum private key |
| `POLL_INTERVAL_SECONDS` | Event polling interval |

## CLI Wallet

| Variable | Description |
|----------|-------------|
| `WALLET_ADDRESS` | Wallet's Ethereum address |
| `WALLET_KEY` | Wallet's Ethereum private key |
| `RPC_HTTP_URL` | HTTP JSON-RPC endpoint |
| `SCAN_FROM_BLOCK` | Block number to start scanning from |

## Frontend

| Variable | Description |
|----------|-------------|
| `VITE_CHAIN_ID` | Hex chain ID (e.g. `0xaa36a7`) |
| `VITE_PUBLIC_RPC_URL` | HTTP JSON-RPC endpoint |
| `VITE_NOZK_VAULT_ADDRESS` | Contract address |
| `VITE_NOZK_MASTER_SEED_HEX` | Dev-only seed bypass |

## Key Generation

```bash
cd nozk_py
uv run generate_keys.py
uv run derive_bls.py 0x<privkey>
```

See `example.env` for the full list of variables.
