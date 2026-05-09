# Frontend Architecture

## Crypto Integration

The app imports `nozk_ts/nozk-library.ts` and `nozk_ts/bn254-crypto.ts` directly via the `@nozk/` Vite alias. No crypto implementations live in `app/src/crypto/` -- only thin wrappers.

## Seed Derivation

On wallet connect, the app calls `personal_sign` with a deterministic message. The 65-byte signature is hashed via `keccak256` to produce the `masterSeed`. The seed lives in RAM only (React context), never persisted to storage.

**Dev bypass:** Set `VITE_NOZK_MASTER_SEED_HEX` in `.env` to skip wallet signing during development.

## Scanner

Source: `app/src/lib/nozkVault.ts`

Fetches events via `eth_getLogs`, chunks by ~2048 blocks, rate-limited with burst queue.

## Pages

- Activity dashboard
- Deposit flow
- Redeem flow
- Recovery
