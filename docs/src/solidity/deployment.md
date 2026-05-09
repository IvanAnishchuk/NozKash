# Deployment

## Deploy Script

Source: `sol/script/NozkVault.s.sol`

```bash
cd sol
forge script script/NozkVault.s.sol:NozkVaultScript \
  --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast --verify
```

## Required Environment Variables

| Variable | Description |
|----------|-------------|
| `PK_MINT_X_IMAG` | BLS pubkey G2 X imaginary limb |
| `PK_MINT_X_REAL` | BLS pubkey G2 X real limb |
| `PK_MINT_Y_IMAG` | BLS pubkey G2 Y imaginary limb |
| `PK_MINT_Y_REAL` | BLS pubkey G2 Y real limb |
| `MINT_AUTHORITY` | Address authorized to call `announce()` |
| `DEPLOYER_ADDRESS` | Deployer public address |
| `DEPLOYER_PRIVATE_KEY` | Deployer private key |

## ABI Sync

After deploying or modifying the contract interface:

```bash
cd sol && python sync_abi.py
```

This copies the ABI to `abi/nozk_vault_abi.json`, which is the single source referenced by `nozk_py/`, `nozk_ts/`, and `app/`.

## Target Network

Default testnet: **Ethereum Sepolia** (chain ID 11155111).
