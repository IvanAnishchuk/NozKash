# Frontend Development

## Prerequisites

Install `nozk_ts` dependencies first (the app imports from it via Vite alias):

```bash
cd nozk_ts && npm install
cd ../app && npm install
```

## Dev Server

```bash
cd app
npm run dev
```

The dev server proxies Sepolia RPC requests.

## Environment

Create `app/.env` with:

```
VITE_CHAIN_ID=0xaa36a7
VITE_PUBLIC_RPC_URL=<your-sepolia-rpc>
VITE_NOZK_VAULT_ADDRESS=<deployed-contract>
VITE_NOZK_MASTER_SEED_HEX=<dev-only-seed>
```

## Production Build

```bash
npm run build    # outputs to dist/
npm run deploy   # builds and pushes to gh-pages
```

## Conventions

- No crypto implementations in `app/src/crypto/` -- only thin wrappers
- ESLint for linting
- React 19 features (use, actions, etc.)
