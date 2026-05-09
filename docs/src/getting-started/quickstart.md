# Quickstart

Run a full deposit-mint-reveal-redeem cycle offline using mock mode:

```bash
cd nozk_py
bash nozk_flow.sh --to 0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7 --mock
```

This exercises the complete token lifecycle (`FRESH -> AWAITING_MINT -> READY_TO_REDEEM -> SPENT`) without any on-chain transactions.

## Other Modes

```bash
# Dry run -- simulate with RPC but don't send transactions
bash nozk_flow.sh --to 0xRecipient --dry-run

# On-chain -- real transactions on Sepolia
bash nozk_flow.sh --to 0xRecipient
```

## Next Steps

- [Environment Setup](environment.md) -- configure `.env` for testnet use
- [Protocol Overview](../protocol/index.md) -- understand the cryptographic flow
- [Python CLI](../python/cli.md) -- individual wallet commands
