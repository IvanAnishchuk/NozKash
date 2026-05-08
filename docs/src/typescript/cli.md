# TypeScript CLI Wallet

Source: `nozk_ts/client.ts`

The TypeScript CLI provides the same wallet operations as the Python CLI.

## Commands

### `deposit`

```bash
npx tsx client.ts deposit --index 0
```

### `scan`

```bash
npx tsx client.ts scan
```

### `redeem`

```bash
npx tsx client.ts redeem --index 0 --to 0xRecipientAddress
```

## Configuration

Uses the same `.env` variables as the Python CLI. See [Environment Setup](../getting-started/environment.md).
