# Frontend App (`app`)

React-based wallet interface for NozKash.

## Stack

- **React 19** with Vite 8
- **Tailwind 4** for styling
- **ESLint** for linting
- Imports crypto via `@nozk/` alias (Vite alias to `../nozk_ts`)

## Quick Commands

```bash
cd app

npm run dev       # Dev server with Sepolia RPC proxy
npm run build     # Production build -> dist/
npm run lint      # ESLint
npm run deploy    # Build and push to gh-pages
```

## Sections

- [Architecture](architecture.md) -- component structure and seed derivation
- [Development](development.md) -- local dev setup and conventions
