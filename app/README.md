# NozKash (app)

Vite + React frontend. All project control (scripts, lockfile, TypeScript, ESLint) lives **here**.

```bash
npm install
npm run dev
```

- Build: `npm run build` → `dist/`
- Env: copy `.env.example` to `.env` if needed
- Team / GitHub docs: `docs/`
- **GhostVault** contract address: configured via `VITE_GHOST_VAULT_ADDRESS` (and matching RPC / chain env vars)

To copy only this folder into another monorepo, use the full `app/` directory.
