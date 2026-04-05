# TypeScript CLI Full Lifecycle Test

**Date:** 2026-04-02
**Contract:** `0x9f275144f24795426539d6adea1197a4de93e47f` (Revision E — reveal/redeem split)
**Chain:** Ethereum Sepolia (11155111)
**Wallet:** `0x7B61749598787aC8c913f99C2Ba219cD85F1ce7E`
**Relayer:** `http://localhost:8000`
**Mint:** mint_server.py (WebSocket polling)

## Overview

Tests the full 4-step lifecycle using the TypeScript CLI client (`nozk_ts/client.ts`):
1. Deposit — user locks 0.001 ETH, registers blinded point
2. Scan — find MintFulfilled event, unblind signature, verify BLS locally
3. Reveal — submit unblinded signature via relayer (BLS verified on-chain)
4. Redeem — submit ECDSA proof via relayer (ETH transferred to recipient)

This session shares the same wallet state file (`.nozk_wallet.json` at repo root) with the Python CLI and flow script sessions. Token #0 was spent earlier by the Python CLI (pre-session), token #1 by the flow script. This session uses token #2.

## Step 1: Deposit

```
$ cd nozk_ts
$ npx tsx client.ts deposit --index 2
```

```
[dotenv@17.3.1] injecting env (21) from ../.env

👻  GHOST-TIP TS CLIENT  👻


──── 📥  DEPOSIT · Token #2 ────

──── 🔑  Step 1 · Derive Token Secrets ────
    Token index              2
    Spend address            0x0adcc1589ac94c8f78819db867687c001aff44f6
    Deposit ID               0x2bb6b97e89b238e147254ba275139bfa7bfc2d73
  Spend address = nullifier (revealed only at redemption)

──── 🎭  Step 2 · Blind Token → G1 ────
    B.x                      0x2c38d61257dc6839…275a9c51
    B.y                      0x8fc5b99f0608c5ea…bec0b98f
    Deposit ID               0x2bb6b97e89b238e147254ba275139bfa7bfc2d73

──── 📋  Step 3 · Build deposit() Transaction ────
  [chain] Connected to chain ID 11155111
    Wallet address           0x7B61749598787aC8c913f99C2Ba219cD85F1ce7E
    Balance                  0.097999856155626601 ETH
    Deposit amount           0.001 ETH

──── 📡  Step 4 · Broadcast ────
    Transaction sent         0x65f020f2dcdbd01fca5ac595dad77a93ba4343cc6cf77d93cc41cb64fb88ec57
  Waiting for confirmation…
    Confirmed block          10576239
    Gas used                 71927
    Deposit ID               0x2bb6b97e89B238e147254Ba275139bFA7bfc2D73
  ✅  Deposit complete. Next: run scan to recover the signed token.
```

## Step 2: Scan (after 20s wait for mint)

```
$ npx tsx client.ts scan
```

```
👻  GHOST-TIP TS CLIENT  👻


──── 🔍  SCAN · Tokens 0–9 ────
  [chain] Connected to chain ID 11155111
    Scanning blocks          10576222 → 10576242
    Token indices            0 – 9

──── 📡  Step 1 · Fetch MintFulfilled Events ────
    Events found             2

──── 🔗  Step 2 · Match Tokens by Deposit ID ────

  Token 1  ·  SPENT

  Token 2  ·  AWAITING_MINT
      Unblinding: S = S' · r⁻¹ mod q …
  ✅  BLS pairing verified locally ✓
    → READY_TO_REVEAL

  Scan complete: 1 token(s) recovered · block 10576242 saved
```

Scan correctly shows token #1 as SPENT (from the flow script session) and token #2 as READY_TO_REVEAL. The TS client reads the same `.nozk_wallet.json` that Python wrote.

## Step 3: Reveal (via relayer)

```
$ npx tsx client.ts reveal --index 2 --relayer http://localhost:8000
```

```
👻  GHOST-TIP TS CLIENT  👻


──── 🔓  REVEAL · Token #2 ────

──── 🔓  Step 1 · Load Unblinded Signature ────
    S.x                      0xd8dca5d84e71eec9…172a6b0a
    S.y                      0xe7581d4aa7ab8434…bb16ab9d
  ✅  BLS pairing verified locally

──── 📡  Step 2 · Submit reveal() ────
    Relayer URL              http://localhost:8000
  Sending reveal request to relayer — no local ETH required.
    Transaction hash         f950890e10615be2872360266fb1fc74ec515b6d25c46c90ed06d72fd1036f3b
    Confirmed at block       10576244
    Gas used                 224259
  ✅  On-chain BLS pairing verified
  ✅  Nullifier registered. Token 2 → REVEALED.
```

## Step 4: Redeem (via relayer)

```
$ npx tsx client.ts redeem --index 2 --to 0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7 --relayer http://localhost:8000
```

```
👻  GHOST-TIP TS CLIENT  👻


──── 💸  REDEEM · Token #2 → 0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7 ────

──── 🔑  Step 1 · Derive Spend Key ────
    Spend address (nullifier) 0x0adcc1589ac94c8f78819db867687c001aff44f6
    Deposit ID               0x2bb6b97e89b238e147254ba275139bfa7bfc2d73

──── 🛡️  Step 2 · Generate Anti-MEV ECDSA Proof (EIP-712) ────
  [chain] Connected to chain ID 11155111
    msg_hash                 1d4d27adacdb6d4041…10c42eb0
    compact_hex              0x878cfd169af88c8f…2622b09e
    recovery_bit             1
    v (EVM)                  28
  ✅  Local ecrecover check passed

──── 📋  Step 3 · Build redeem() Transaction ────
    Recipient                0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7
    Nullifier                0x0adCC1589aC94c8f78819db867687c001aFF44F6

──── 📡  Step 4 · Broadcast via Relayer ────
    Relayer URL              http://localhost:8000
  Sending redeem request to relayer — no local ETH required.
    Transaction hash         e664354cfc8774860b12476d79f4e02018c212d9d3ff06e104fdb43fa3f13c8d
    Confirmed at block       10576250
    Gas used                 48880
  ✅  On-chain checks passed:
    ✔  ecrecover → nullifier matches spend address
    ✔  nullifier was in REVEALED state
    ✔  0.001 ETH transferred to 0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7
  ✅  Redemption complete. Token 2 is now spent.
```

## Cross-Language Observations

The TS scan correctly sees token #1 (deposited and spent by Python/flow script) as SPENT. Both clients share `.nozk_wallet.json` at repo root and `.env` at repo root. The TS `nullifierState()` call returned `2` (SPENT) for token #1 without issues.

## Summary

| Step | Tx Hash | Block | Gas | Paid by |
|------|---------|-------|-----|---------|
| Deposit | `65f020f2…88ec57` | 10576239 | 71,927 | Depositor |
| Reveal | `f950890e…036f3b` | 10576244 | 224,259 | Relayer |
| Redeem | `e664354c…f13c8d` | 10576250 | 48,880 | Relayer |
