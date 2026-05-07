# Mint Server Log — All Testing Sessions

**Date:** 2026-04-02
**Service:** `mint_server.py` (WebSocket event polling daemon)
**Wallet:** `0x72A14358BaD8fc0023B329B24C64D9F1134E3721`
**Contract:** `0x9f275144f24795426539d6adea1197a4de93e47f` (Revision E)
**Chain:** Ethereum Sepolia (11155111)
**Poll interval:** 2.0s

## Startup

```
$ uv run mint_server.py

╭──────────────────────────────────────────────────────────────────────────────╮
│    👻  GHOST-TIP MINT SERVER  👻                                             │
╰──────────────────────────── BLS Blind Signature Daemon · Sepolia ────────────╯

─────────────────────────────────── Starting Daemon ────────────────────────────
╭──────────────────────────────── Configuration ───────────────────────────────╮
│                                                                              │
│    Wallet            0x72A14358BaD8fc0023B329B24C64D9F1134E3721              │
│    Contract          0x9f275144f24795426539d6adea1197a4de93e47f              │
│    RPC               wss://sepolia.infura.io/ws/v3/…61bde166                 │
│    Poll interval     2.0s                                                    │
│    Verbosity         normal                                                  │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯

  👂  Listening for DepositLocked events…

───────────────────────── WebSocket Connection ─────────────────────────────────
  ✅  Connected  chain=11155111  block=10576152

  👂  Listening for DepositLocked events…
```

## Transaction Log

### Deposit 1: Python CLI (token #0)

```
╭───────────────────────── 📥  Deposit Received ───────────────────────────────╮
│                                                                              │
│    Event          DepositLocked                                              │
│    Deposit ID     0x88eb2488Ad4dda1743D716673bbbA30b1EBF1481                 │
│    Tx hash        25ba90d67cb449…c3d569fa                                    │
│    Block          10576179                                                   │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
  📤  announce() sent   deposit=0x88eb24…BF1481   tx=630d8bfdea…895abef1
  ✅  Confirmed          block=10576185   gas=48353
```

### Deposit 2: Flow Script (token #1)

```
╭───────────────────────── 📥  Deposit Received ───────────────────────────────╮
│                                                                              │
│    Event          DepositLocked                                              │
│    Deposit ID     0x07669e9f1F85B641A047eb54a2B7eb81D17914B0                 │
│    Tx hash        b2b292214c2e81…09a7e28e                                    │
│    Block          10576220                                                   │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
  📤  announce() sent   deposit=0x07669e…7914B0   tx=61980ecc07…8ff991a5
  ✅  Confirmed          block=10576222   gas=48353
```

### Deposit 3: TypeScript CLI (token #2)

```
╭───────────────────────── 📥  Deposit Received ───────────────────────────────╮
│                                                                              │
│    Event          DepositLocked                                              │
│    Deposit ID     0x2bb6b97e89B238e147254Ba275139bFA7bfc2D73                 │
│    Tx hash        65f020f2dcdbd0…fb88ec57                                    │
│    Block          10576239                                                   │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
  📤  announce() sent   deposit=0x2bb6b9…fc2D73   tx=1ab9e1d8a1…2cbfaa5b
  ✅  Confirmed          block=10576240   gas=48353
```

## Summary

| # | Deposit ID | Deposit Block | Announce Block | Announce Gas | Client |
|---|-----------|---------------|----------------|-------------|--------|
| 1 | `0x88eb24…BF1481` | 10576179 | 10576185 | 48,353 | Python CLI |
| 2 | `0x07669e…7914B0` | 10576220 | 10576222 | 48,353 | Flow script |
| 3 | `0x2bb6b9…fc2D73` | 10576239 | 10576240 | 48,353 | TypeScript CLI |

All three deposits announced within 1–6 blocks. Total announce gas: 145,059 (~48.4k each).
