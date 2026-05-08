# TypeScript Library (`nozk_ts`)

The TypeScript implementation is a **byte-for-byte port** of the Python crypto library, sharing identical test vectors to guarantee parity.

## Components

| Module | Description |
|--------|-------------|
| `nozk-library.ts` | Core blind signature protocol (mirrors `nozk_library.py`) |
| `bn254-crypto.ts` | BN254 curve operations |
| `client.ts` | CLI wallet |

## Tooling

- **Runtime:** Node.js 20+, npm
- **Linting/formatting:** Biome
- **Type checking:** `tsc --noEmit` (strict, NodeNext module resolution)
- **Testing:** vitest

## Quick Commands

```bash
cd nozk_ts

# Dev cycle
npx biome check . && npx tsc --noEmit && npx vitest run

# CLI wallet
npx tsx client.ts deposit --index 0
npx tsx client.ts scan
npx tsx client.ts redeem --index 0 --to 0xAddr
```

## Sections

- [nozk-library API](api/nozk-library.md) -- core library functions
- [bn254-crypto API](api/bn254-crypto.md) -- curve operations
- [CLI Wallet](cli.md) -- command reference
