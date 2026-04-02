# Flow Script (`nozk_flow.sh`) Full Lifecycle Test

**Date:** 2026-04-02
**Contract:** `0x9f275144f24795426539d6adea1197a4de93e47f` (Revision E — reveal/redeem split)
**Chain:** Ethereum Sepolia (11155111)
**Wallet:** `0x7B61749598787aC8c913f99C2Ba219cD85F1ce7E`
**Relayer:** `http://localhost:8000`
**Mint:** mint_server.py (WebSocket polling)

## Overview

Tests the full lifecycle using the shell orchestration script `nozk_flow.sh`, which drives `client.py` through all steps automatically:
1. Deposit (client.py deposit)
2. Wait for mint (countdown timer)
3. Scan (client.py scan)
4. Reveal (client.py reveal via relayer)
5. Redeem (client.py redeem via relayer)
6. Final status (client.py status)

## Command

```
$ cd nozk_py
$ bash nozk_flow.sh \
    --to 0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7 \
    --index 1 \
    --relayer http://localhost:8000 \
    --wait-mint 25 \
    --skip-balance
```

## Output

### STEP 1: Deposit Token

```
──────────────────────────────────────────────────
  STEP 1 · Deposit Token (index=1)
──────────────────────────────────────────────────

─────────────────────────── 📥  DEPOSIT  ·  Token #1 ───────────────────────────
    Token index                  1
    Spend address                0x9abdad1d320e31d2b00f54be3dfa06a2de1f0e0d
    Blind address                0x07669e9f1f85b641a047eb54a2b7eb81d17914b0

    Wallet address               0x7B61749598787aC8c913f99C2Ba219cD85F1ce7E
    Balance                      0.099000 ETH
    Nonce                        1
    Deposit amount               0.001 ETH

    Transaction sent
b2b292214c2e811a0451bb35639e37f4034606329ec2a5f99836bc3809a7e28e
    Confirmed block              10576220
    Gas used                     71927
    Deposit ID                   0x07669e9f1f85b641a047eb54a2b7eb81d17914b0

  ✅  Deposit complete.
  ✅  Deposit step complete.
```

### STEP 2: Wait for Mint Server

```
──────────────────────────────────────────────────
  STEP 2 · Wait for Mint Server (~25s)
──────────────────────────────────────────────────
  Waiting 25s for the mint server to sign the blinded point…
  (Start mint_server.py in another terminal if it isn't running.)
   24s remaining… ... 0s remaining…
  ✅  Wait complete.
```

### STEP 3: Scan Chain for Signed Token

```
──────────────────────────────────────────────────
  STEP 3 · Scan Chain for Signed Token (index=1)
──────────────────────────────────────────────────

    Scanning blocks              0 → 10576222
    Token indices                1 – 1
    Events found                 5

  Token 1  ·  AWAITING_MINT
    Unblinding: S = S' · r⁻¹ mod q …
  ✅    BLS pairing verified locally ✓
  → READY_TO_REVEAL

    Scan complete                1 token(s) recovered · block 10576222 saved
  ✅  Scan complete.
```

### STEP 4: Reveal Token

```
──────────────────────────────────────────────────
  STEP 4 · Reveal Token (index=1)
──────────────────────────────────────────────────

    S.x                          0x7ce0857ba77ded8d…34b0a3a7
    S.y                          0x557f8a05d674dcf7…7e09343e
  ✅  BLS pairing verified locally ✓

    Relayer URL                  http://localhost:8000
  Sending reveal request to relayer — no local ETH required.
    Transaction hash
25effe27ac4da96ffbd02a3e65da30916b2255a89f83b397279c6eb06f07cf3e
    Confirmed at block           10576226
    Gas used                     207110

  ✅  On-chain BLS pairing verified ✓
  ✅  Nullifier registered. Token 1 → REVEALED.
  ✅  Reveal complete. Nullifier registered on-chain.
```

### STEP 5: Redeem Token

```
──────────────────────────────────────────────────
  STEP 5 · Redeem Token (index=1 → 0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7)
──────────────────────────────────────────────────

    Spend address (nullifier)    0x9abdad1d320e31d2b00f54be3dfa06a2de1f0e0d
    Deposit ID                   0x07669e9f1f85b641a047eb54a2b7eb81d17914b0

    Payload                      EIP-712 NozkRedeem(recipient=0x89205A…43e7, deadline=1775157526)
    recovery_bit                 1
    v (EVM)                      28
  ✅  Local ecrecover check passed

    Recipient                    0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7
    Nullifier                    0x9abdad1D320e31D2b00f54be3Dfa06a2DE1F0E0D
    Calldata size                260 bytes

    Relayer URL                  http://localhost:8000
  Sending redeem request to relayer — no local ETH required.
    Transaction hash
e88412bc07cdf84a05bb6a9c9c19cd4ec3551fd23118106755481590912fcfa0
    Confirmed at block           10576229
    Gas used                     48892

  ✅  On-chain checks passed:
    ✔  ecrecover → nullifier matches spend address
    ✔  nullifier was in REVEALED state
    ✔  0.001 ETH transferred to 0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7

  ✅  Redemption complete. Token 1 is now spent.
  ✅  Redemption complete. 0.001 ETH transferred to 0x89205A…43e7.
```

### STEP 6: Final Wallet Status

```
──────────────────────────────────────────────────
  STEP 6 · Final Wallet Status
──────────────────────────────────────────────────

    Wallet address     0x7B61749598787aC8c913f99C2Ba219cD85F1ce7E
    ETH balance        0.098000 ETH
    Last scanned       block 10576222

                                Token Records
╭───┬────────┬─────────────┬─────────────┬─────────────────┬─────────────────╮
│ # │ Status │ Spend addr  │ Deposit ID  │ Deposit tx      │ Redeem tx       │
├───┼────────┼─────────────┼─────────────┼─────────────────┼─────────────────┤
│ 0 │ FRESH  │ 0x9bc2…1c60 │ 0x88eb…1481 │ —               │ —               │
│ 1 │ SPENT  │ 0x9abd…0e0d │ 0x0766…14b0 │ b2b29221…a7e28e │ e88412bc…2fcfa0 │
│ ...                                                                        │
╰───┴────────┴─────────────┴─────────────┴─────────────────┴─────────────────╯

  🎉  NOZK FLOW COMPLETE
  Token #1 lifecycle finished successfully.
```

## Summary

| Step | Tx Hash | Block | Gas | Paid by |
|------|---------|-------|-----|---------|
| Deposit | `b2b29221…a7e28e` | 10576220 | 71,927 | Depositor |
| Reveal | `25effe27…07cf3e` | 10576226 | 207,110 | Relayer |
| Redeem | `e88412bc…2fcfa0` | 10576229 | 48,892 | Relayer |
