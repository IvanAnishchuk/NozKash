# Python CLI Wallet

Source: `nozk_py/client.py`

## Commands

### `deposit`

Lock 0.001 ETH into the vault and register a blinded token.

```bash
uv run client.py deposit --index 0
```

### `scan`

Scan on-chain events to discover and update token states.

```bash
uv run client.py scan
```

### `redeem`

Redeem a ready token to a recipient address.

```bash
uv run client.py redeem --index 0 --to 0xRecipientAddress
```

### `status`

Show wallet status and token inventory.

```bash
uv run client.py status
```

### `balance`

Show total redeemable balance.

```bash
uv run client.py balance
```

## Wallet State

Token state is tracked in `.nozk_wallet.json`:

```
FRESH -> AWAITING_MINT -> READY_TO_REDEEM -> SPENT
```

All secrets are deterministically re-derivable from `(masterSeed, index)`.
