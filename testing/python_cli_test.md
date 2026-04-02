# Python CLI Full Lifecycle Test

**Date:** 2026-04-02
**Contract:** `0x9f275144f24795426539d6adea1197a4de93e47f` (Revision E — reveal/redeem split)
**Chain:** Ethereum Sepolia (11155111)
**Wallet:** `0x7B61749598787aC8c913f99C2Ba219cD85F1ce7E`
**Relayer:** `http://localhost:8000` (relayer_server.py)
**Mint:** mint_server.py (WebSocket polling)

## Overview

Tests the full 4-step lifecycle using the Python CLI client (`client.py`):
1. Deposit — user locks 0.001 ETH, registers blinded point
2. Scan — find MintFulfilled event, unblind signature, verify BLS locally
3. Reveal — submit unblinded signature to contract via relayer (BLS verified on-chain)
4. Redeem — submit ECDSA proof to contract via relayer (ETH transferred to recipient)

The depositor wallet pays gas only for the deposit tx. Reveal and redeem gas is paid by the relayer.

---

## Step 1: Deposit

```
$ uv run client.py deposit --index 0 --verbosity verbose
```

```
╭──────────────────────────────────────────────────────────────────────────────╮
│    👻  GHOST-TIP CLI WALLET  👻                                              │
╰─────────────────── eCash · BLS Blind Signatures · Sepolia ───────────────────╯

─────────────────────────── 📥  DEPOSIT  ·  Token #0 ───────────────────────────
────────────────────── 🔑  Step 1 · Derive Token Secrets ───────────────────────
    Token index                  0
    Spend address                0x9bc22770af0292e6a909f13a0828b1d2c24b1c60
    Blind address                0x88eb2488ad4dda1743d716673bbba30b1ebf1481
    Blinding scalar r
0xd9c782292c90647fc0d9ae1378677e53f055f1f5327d541f467274bd26c488
  Spend address = nullifier (revealed only at redemption)
  Blind address = deposit ID (submitted with deposit tx)

──────────────────────── 🎭  Step 2 · Blind Token → G1 ─────────────────────────
    Y = H(spend_addr) x
0x2ebc7847736248e0ce6d5b11387bad9cf7a2026266f3868603ddcc2bf5e1288f
    Y = H(spend_addr) y
0x9b436a9eb4f65945aa767b5f3a1744b46eef4fd4d5422a3bd9f60bfd5ceae9b
    B = r·Y  x
0xd9e65ced235e575f0249930801f1952662c3897440a0542d3317e2edfc3ce0e
    B = r·Y  y
0x6d8cbcc6cf5e1f21f3fb3e2734f36f714e23b18229f003328443c048cf69b5f
    Deposit ID                   0x88eb2488ad4dda1743d716673bbba30b1ebf1481
  B is the blinded point — mint cannot derive spend address without r

──────────────────── 📋  Step 3 · Build deposit() Calldata ─────────────────────
    Wallet address               0x7B61749598787aC8c913f99C2Ba219cD85F1ce7E
    Balance                      0.100000 ETH
    Nonce                        0
    Gas price                    0.00 gwei
    Deposit amount               0.001 ETH

──────────────────────────── 📡  Step 4 · Broadcast ────────────────────────────
    Transaction sent
25ba90d67cb4492b13e19a36aa291ddccf34539dcbb67c4339ec1ddac3d569fa
  Waiting for confirmation…
    Confirmed block              10576179
    Gas used                     71915
    Deposit ID                   0x88eb2488ad4dda1743d716673bbba30b1ebf1481

  ✅  Deposit complete. Next: run 'scan' to recover the signed token.
```

---

## Step 2: Scan (after ~20s for mint)

```
$ uv run client.py scan --verbosity verbose
```

```
─────────────────────────── 🔍  SCAN  ·  Tokens 0–9 ────────────────────────────
    Scanning blocks              0 → 10576190
    Token indices                0 – 9

─────────────────── 📡  Step 1 · Fetch MintFulfilled Events ────────────────────
    Events found                 4
      S'.x [0x88eb…1481]
0xf4136d0ac4f17adf4d919dbc6502b0aec23d89f37d644607e5af59747765518

─────────────────── 🔗  Step 2 · Match Tokens by Deposit ID ────────────────────

  Token 0  ·  AWAITING_MINT
      S'.x (blind sig)
0xf4136d0ac4f17adf4d919dbc6502b0aec23d89f37d644607e5af59747765518
      S'.y (blind sig)
0xcb211b759e66fc318810289ac0ccaecc5a1ff562dae6f8e82eed79e463abeea
    Unblinding: S = S' · r⁻¹ mod q …
      S.x (unblinded)
0x15f36622d71cef04c94af52a344fade2de3933a2d4c76c20d0890d27d57f9905
      S.y (unblinded)
0x2e239a459cc6ffe5a058ebdcfc4611496af299c9b2e7468d224d33cf604e59af
  ✅    BLS pairing verified locally ✓
  → READY_TO_REVEAL

────────────────────────────────────────────────────────────────────────────────
    Scan complete                1 token(s) recovered · block 10576190 saved
```

---

## Step 3: Reveal (via relayer)

```
$ uv run client.py reveal --index 0 --relayer http://localhost:8000
```

```
─────────────────────────── 🔓  REVEAL  ·  Token #0 ────────────────────────────
──────────────────── 🔓  Step 1 · Load Unblinded Signature ─────────────────────
    S.x                          0x15f36622d71cef04…d57f9905
    S.y                          0x2e239a459cc6ffe5…604e59af
  ✅  BLS pairing verified locally ✓

───────────────────────── 📡  Step 2 · Submit reveal() ─────────────────────────
    Relayer URL                  http://localhost:8000
  Sending reveal request to relayer — no local ETH required.
    Transaction hash
d2b0eebfd5135b447c04f6622e3432a8b583ffac33a9cd46daaa89eb59e9d98f
    Confirmed at block           10576195
    Gas used                     207110

  ✅  On-chain BLS pairing verified ✓
  ✅  Nullifier registered. Token 0 → REVEALED.
```

---

## Step 4: Redeem (via relayer)

```
$ uv run client.py redeem --index 0 --to 0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7 --relayer http://localhost:8000
```

```
──── 💸  REDEEM  ·  Token #0  →  0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7 ────
──────────────────── 🔓  Step 1 · Load Unblinded Signature ─────────────────────
    S.x                          0x15f36622d71cef04…d57f9905
    S.y                          0x2e239a459cc6ffe5…604e59af
  ✅  BLS pairing verified locally ✓

──────────────────────── 🔑  Step 2 · Derive Spend Key ─────────────────────────
    Spend address (nullifier)    0x9bc22770af0292e6a909f13a0828b1d2c24b1c60
    Deposit ID                   0x88eb2488ad4dda1743d716673bbba30b1ebf1481

───────────── 🛡️  Step 3 · Generate Anti-MEV ECDSA Proof (EIP-712) ─────────────
    Payload                      EIP-712
NozkRedeem(recipient=0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7,
deadline=1775157168)
    msg_hash                     ec6d5fdf3023f92670…b08fa910
    compact_hex                  0x9a15f46dfa131d6c…2ef9dc5b
    recovery_bit                 0
    v (EVM)                      27
  ✅  Local ecrecover check passed

───────────────────── 📋  Step 4 · Build redeem() Calldata ─────────────────────
    Recipient                    0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7
    Nullifier                    0x9bC22770af0292e6A909F13A0828b1D2C24b1c60
    Calldata size                260 bytes

────────────────────── 📡  Step 5 · Broadcast via Relayer ──────────────────────
    Relayer URL                  http://localhost:8000
  Sending redeem request to relayer — no local ETH required.
    Transaction hash
7f4d941593b4e2dae1e9658e50f4a89ccbe4a40ca5810b6f4a17601224596095
    Confirmed at block           10576198
    Gas used                     48880

  ✅  On-chain checks passed:
    ✔  ecrecover → nullifier matches spend address
    ✔  nullifier was in REVEALED state
    ✔  0.001 ETH transferred to 0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7

  ✅  Redemption complete. Token 0 is now spent.
```

---

## Summary

| Step | Tx Hash | Block | Gas | Paid by |
|------|---------|-------|-----|---------|
| Deposit | `25ba90d6…d569fa` | 10576179 | 71,915 | Depositor |
| Reveal | `d2b0eebf…e9d98f` | 10576195 | 207,110 | Relayer |
| Redeem | `7f4d9415…596095` | 10576198 | 48,880 | Relayer |
