# Relayer Server Log — All Testing Sessions

**Date:** 2026-04-02
**Service:** `relayer_server.py` (FastAPI + uvicorn)
**Wallet:** `0x72A14358BaD8fc0023B329B24C64D9F1134E3721`
**Contract:** `0x9f275144f24795426539d6adea1197a4de93e47f` (Revision E)
**Chain:** Ethereum Sepolia (11155111)
**Port:** 8000

## Startup

```
$ uv run relayer_server.py

╭──────────────────────────────────────────────────────────────────────────────╮
│    👻  GHOST-TIP RELAYER  👻                                                 │
╰──────────────────────────── Reveal & Redeem Service · Sepolia ───────────────╯

╭──────────────────────────────── Configuration ───────────────────────────────╮
│                                                                              │
│    Wallet             0x72A14358BaD8fc0023B329B24C64D9F1134E3721             │
│    Contract           0x9f275144f24795426539d6adea1197a4de93e47f             │
│    RPC                https://sepolia.infura.io/v3/7…61bde166                │
│    Chain ID           11155111                                               │
│    Verbosity          normal                                                 │
│    Has BLS pubkey     yes                                                    │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯

  ✅  Connected  chain=11155111  block=10576152  balance=0.099999 ETH

  🌐  Listening on http://0.0.0.0:8000
```

## Transaction Log

### Session 1: Python CLI (token #0)

| # | Action | Nullifier | Tx Hash | Block | Gas |
|---|--------|-----------|---------|-------|-----|
| 1 | reveal | `0x9bC227…4b1c60` | `d2b0eebfd5…59e9d98f` | 10576195 | 207,110 |
| 2 | redeem | `0x9bC227…4b1c60` | `7f4d941593…24596095` | 10576198 | 48,880 |

### Session 2: Flow Script (token #1)

| # | Action | Nullifier | Tx Hash | Block | Gas |
|---|--------|-----------|---------|-------|-----|
| 3 | reveal | `0x9abdad…1F0E0D` | `25effe27ac…6f07cf3e` | 10576226 | 207,110 |
| 4 | redeem | `0x9abdad…1F0E0D` | `e88412bc07…912fcfa0` | 10576229 | 48,892 |

### Session 3: TypeScript CLI (token #2)

| # | Action | Nullifier | Tx Hash | Block | Gas |
|---|--------|-----------|---------|-------|-----|
| 5 | reveal | `0x0adCC1…FF44F6` | `f950890e10…d1036f3b` | 10576244 | 224,259 |
| 6 | redeem | `0x0adCC1…FF44F6` | `e664354cfc…a3f13c8d` | 10576250 | 48,880 |

### Raw log output

```
  ✅  reveal  nullifier=0x9bC227…4b1c60  tx=d2b0eebfd5…59e9d98f  block=10576195  gas=207110
  ✅  redeem  nullifier=0x9bC227…4b1c60  tx=7f4d941593…24596095  block=10576198  gas=48880
  ✅  reveal  nullifier=0x9abdad…1F0E0D  tx=25effe27ac…6f07cf3e  block=10576226  gas=207110
  ✅  redeem  nullifier=0x9abdad…1F0E0D  tx=e88412bc07…912fcfa0  block=10576229  gas=48892
  ✅  reveal  nullifier=0x0adCC1…FF44F6  tx=f950890e10…d1036f3b  block=10576244  gas=224259
  ✅  redeem  nullifier=0x0adCC1…FF44F6  tx=e664354cfc…a3f13c8d  block=10576250  gas=48880
```

## Gas Analysis

| Operation | Gas range | Notes |
|-----------|----------|-------|
| reveal() | 207,110 – 224,259 | ecPairing precompile (~100k) + 2 SSTOREs |
| redeem() | 48,880 – 48,892 | ecrecover + 1 SSTORE + ETH transfer |

Total relayer gas across 3 sessions: **784,131**
- 3 reveals: 207,110 + 207,110 + 224,259 = 638,479
- 3 redeems: 48,880 + 48,892 + 48,880 = 146,652
