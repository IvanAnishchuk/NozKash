# UX Stories: NozKash Private Payments

A product-level description of how NozKash should feel to users. This document defines the target experience for the frontend and client overhaul — what users do, what they see, what they don't need to think about.

---

## Design Principles

1. **Two verbs, not five.** Users think in "shield" and "send." The protocol has deposit, wait-for-mint, scan, reveal, redeem — the product has two buttons.
2. **Background everything.** Scanning, mint polling, and state transitions happen without user action. The wallet is always up to date.
3. **Money metaphor.** Users have a "private balance" measured in ETH, not a list of cryptographic tokens. Tokens are an implementation detail visible only in advanced/debug views.
4. **Privacy by default.** Amounts and activity are hidden until the user explicitly reveals them. No accidental information leakage in screenshots or screen-shares.
5. **No jargon in the happy path.** Words like "nullifier," "blinding factor," "BLS pairing," and "EIP-712" never appear in the main UI. They belong in tooltips, developer docs, and the advanced view.
6. **Graceful degradation.** Every error state has a recovery path. Lost wallet? Re-scan from seed. Mint down? Show clear status and refund option. Wrong chain? One-click switch.

---

## Personas

### Alex — Freelancer
Gets paid by clients for design work. Wants to receive ETH without every payment being publicly traceable to the same address. Doesn't care about cryptography, just wants "deposit goes in, payment comes out, nobody can connect the two."

### Sam — Privacy-conscious user
Holds ETH and occasionally sends to friends, charity, or merchants. Doesn't want their entire transaction graph public. Comfortable with a wallet app, not comfortable with a CLI. Expects a mobile-quality UX in a web app.

### River — Power user / developer
Runs their own mint, tests edge cases, debugs cross-language parity. Needs full visibility into every cryptographic step. Uses the CLI. Wants batch operations, raw hex output, and scriptable commands.

---

## Story 1: First-Time Setup

**Alex opens the app for the first time.**

> Alex connects their wallet (MetaMask, WalletConnect, etc.). A brief onboarding screen explains: "NozKash gives you a private balance. Funds you shield here can be sent to anyone — and nobody can trace which deposit paid which person."
>
> The app asks Alex to sign a message to derive their vault key. The message is human-readable: "Unlock your NozKash vault on [chain name]." One signature, no transaction, no gas.
>
> Alex sees an empty dashboard: "Private balance: 0 ETH. Shield some funds to get started."

**What happens underneath:** `personal_sign` → `keccak256(sig)` → master seed in RAM. No on-chain transaction. Seed never persisted to disk.

**Key requirement:** The sign-message prompt must clearly communicate this is NOT a transaction and costs nothing. Wallet UIs often make signatures look scary — the copy must compensate.

---

## Story 2: Shielding Funds (Deposit)

**Alex wants to shield 0.01 ETH.**

> Alex taps "Shield" and enters an amount. The app shows:
>
> ```
> Shield 0.01 ETH
> ≈ 10 private tokens
> Network fee: ~0.0003 ETH (est.)
> ───────────────────────────
> [Cancel]  [Shield →]
> ```
>
> Alex confirms. One wallet popup (the deposit transaction). A progress indicator shows:
>
> ```
> ✓ Transaction confirmed
> ◐ Waiting for mint to process... (usually < 1 min)
> ```
>
> After 15 seconds, the balance updates:
>
> ```
> Private balance: 0.01 ETH
> ```

**What happens underneath:**
1. App calculates how many tokens to mint (amount ÷ denomination)
2. For each token: derive secrets, compute blinded point, call `deposit()`
3. Batched into a single multicall or sequential txs (user sees one confirmation per batch)
4. Background poller watches for `MintFulfilled` events
5. On fulfillment: auto-unblind, auto-reveal (background tx or queued for next user action)
6. Balance increments as tokens become spendable

**Simplifications from current state:**
- Current: user must manually run `scan`, then manually `reveal` each token (separate tx + gas)
- Target: scan is automatic and continuous; reveal is either batched in background or deferred to send-time
- Current: only 0.001 ETH denomination; user manages individual token indices
- Target: user enters ETH amount; app handles token count math internally

**Edge cases:**
- Mint is slow (>2 min): show "Still waiting — the mint is processing your deposit. You can close this page; your funds are safe on-chain."
- Mint is down: after timeout, show "The mint hasn't responded. You can wait or reclaim your deposit." with a [Refund] button.
- Partial batch: if 7 of 10 tokens are minted, show "0.007 ETH available, 0.003 ETH pending."

---

## Story 3: Sending a Private Payment

**Alex wants to pay Sam 0.005 ETH.**

> Alex taps "Send" and enters Sam's address and the amount:
>
> ```
> Send to: 0x1234...abcd
> Amount:  0.005 ETH (5 tokens)
> Network fee: ~0.0005 ETH (est.)
> ───────────────────────────
> Private balance: 0.01 ETH → 0.005 ETH after send
> [Cancel]  [Send →]
> ```
>
> Alex confirms. One wallet popup (or zero, if using a relayer for gas abstraction). The app shows progress:
>
> ```
> Sending 0.005 ETH privately...
> ✓ 3 of 5 tokens sent
> ◐ Sending remaining...
> ```
>
> Done:
>
> ```
> ✓ Sent 0.005 ETH to 0x1234...abcd
> Private balance: 0.005 ETH
> ```

**What happens underneath:**
1. App selects the required number of revealed tokens from the user's balance
2. For tokens that are ready-to-reveal but not yet revealed: batch-reveal first (or combine in same session)
3. For each token: generate EIP-712 redemption proof (ECDSA sign with spend key), call `redeem(recipient, sig, nullifier, deadline)`
4. Batch where possible; sequential otherwise
5. Balance decrements as each redeem confirms

**Simplifications from current state:**
- Current: user must pick a specific token index, run `reveal`, then run `redeem` with explicit `--to` address — three commands, two on-chain txs per token
- Target: user enters an address and an amount; everything else is automatic
- Current: each redeem is a separate tx requiring gas from the user's public address
- Target: optional relayer integration so the user's public address is never associated with the redemption

**On relayers and gas abstraction:**
The recipient receives ETH directly from the contract. The person calling `redeem()` does not need to be the token owner — anyone with the valid ECDSA proof can submit it. This enables relayers: the user sends the proof to a relayer off-chain, the relayer submits the tx and deducts a small fee. The user's gas-paying address never touches the redeem transaction.

---

## Story 4: Receiving a Private Payment

**Sam wants to receive payment from a client without revealing their main address.**

> Sam opens NozKash and taps "Receive." The app shows:
>
> ```
> Share this address to receive private payments:
>
> 0x9abc...def0  [Copy] [QR]
>
> Funds sent to this address will appear in your
> private balance after shielding.
> ```
>
> Sam's client sends 0.01 ETH to that address. Sam shields it:
>
> ```
> Incoming: 0.01 ETH detected on your deposit address
> [Shield now →]
> ```

**Note on the receive flow:** NozKash currently requires the *sender* to shield their own funds first, then redeem to the recipient. A true "receive" flow where Sam gives out an address and the sender's payment automatically enters Sam's private balance is a future feature. Three candidate designs are under consideration:

**Option A: Pre-loaded blinded tokens (ingress account)**
Sam pre-generates a batch of blinded tokens (blinded points + deposit IDs) and publishes them behind a limited smart account (or simple relay). The sender deposits ETH into this ingress address, which triggers registration of Sam's pre-loaded blinded points. The mint signs them, and Sam unblurs and reveals as usual. Sam never shares their seed — only pre-computed, single-use deposit parameters.

- Pros: Funds enter Sam's private balance directly; sender just sends ETH to an address
- Cons: Sam must pre-generate tokens (how many?); ingress account adds contract complexity; token exhaustion if more payments arrive than pre-generated tokens

**Option B: Stealth addresses (EIP-5564)**
Sam publishes a stealth meta-address. The sender derives a one-time address only Sam can spend from. Sam scans for payments using their viewing key. Once found, Sam shields the received ETH into their own vault.

- Pros: Standard, well-understood mechanism; no pre-generation; compatible with any sender
- Cons: Two steps for Sam (receive public ETH at stealth address, then shield it); stealth address scanning infrastructure needed

**Option C: Rotated ingress addresses**
Sam's wallet derives a sequence of one-time deposit addresses (rotated after each use or on a schedule). Sam shares the current ingress address. The sender deposits to it. The wallet auto-detects and shields.

- Pros: Simple UX; each address is single-use (better privacy); no pre-computed token batch
- Cons: Address rotation protocol needs definition; sender must use the current address; stale addresses create failed deposits

**Current status:** Option A is the most "native" to NozKash (the tokens enter the private balance directly without an intermediate public step), but Options B and C may be easier to implement initially. This is an active design question — see [R&D: Melt, Epochs, Batching](rd-melt-epochs-batching.md) for related protocol extensions.

For the initial overhaul, "Receive" means: Sam shares their regular Ethereum address. The sender redeems to that address from their own private balance. Sam receives public ETH, which they can then shield into their own private balance if desired.

---

## Story 5: Checking Balance and Activity

**Sam opens the app to check their balance.**

> The dashboard shows:
>
> ```
> ┌──────────────────────────┐
> │  PRIVATE BALANCE         │
> │  ●●●●●●●  [👁]          │
> │                          │
> │  Available    Pending    │
> │  ●●●●●●●    ●●●●●●●    │
> └──────────────────────────┘
> ```
>
> Sam taps the eye icon to reveal amounts:
>
> ```
> ┌──────────────────────────┐
> │  PRIVATE BALANCE         │
> │  0.037 ETH   [👁]       │
> │                          │
> │  Available    Pending    │
> │  0.030 ETH   0.007 ETH  │
> └──────────────────────────┘
> ```
>
> Below, the activity feed shows:
>
> ```
> Today
>   ↓ Shielded 0.01 ETH           12:34
>   ↑ Sent 0.005 ETH → 0x12...cd  11:02
>
> Yesterday
>   ↓ Shielded 0.02 ETH           09:15
>   ↑ Sent 0.003 ETH → 0xab...ef  08:41
> ```

**What happens underneath:** The scanner runs in the background on a timer (every 30s or on focus). It queries `DepositLocked`, `MintFulfilled`, `NullifierRevealed`, and `Redeemed` events, reconciles against the user's known token set, and updates the local state.

**Simplifications from current state:**
- Current: activity shows individual tokens with protocol-level labels ("Deposit · mint fulfilled · token #3", "Revealed · ready to redeem · token #7")
- Target: activity is grouped into user-level actions ("Shielded 0.01 ETH", "Sent 0.005 ETH to 0x...")
- Current: amounts shown as "0.001 ETH" per row (one row per token)
- Target: amounts aggregated by action (10 tokens deposited together = "Shielded 0.01 ETH")

---

## Story 6: Recovery

**Alex gets a new phone / browser and needs to restore their wallet.**

> Alex connects the same wallet address and signs the vault message. The app detects this is an existing user (or just scans regardless):
>
> ```
> Scanning for existing private balance...
> Found 37 tokens across blocks 10,500,000 – 10,576,000
>
> Private balance: 0.030 ETH (30 available, 7 pending)
> ```

**What happens underneath:** The scanner derives deposit IDs for token indices 0, 1, 2, ... and queries `DepositLocked` events filtered by each. It stops when it hits a gap (configurable number of consecutive empty indices). For each found deposit, it checks `MintFulfilled`, unblinding status, nullifier state, and redeem state.

**Key property:** The master seed + token index is sufficient to re-derive every secret. No backup file is needed. The wallet is fully recoverable from the seed alone + on-chain data.

---

## Story 7: CLI Power User

**River wants to deposit 100 tokens, monitor the mint, and redeem in batch.**

> ```bash
> # Deposit 100 tokens in one command
> nozk deposit --count 100
>
> # Watch mint progress in real-time
> nozk watch --from-block latest
>
> # Reveal all unblinded tokens
> nozk reveal --all
>
> # Redeem all revealed tokens to a single address
> nozk send --all --to 0xRecipient
>
> # Or: one-shot flow
> nozk flow --count 10 --to 0xRecipient
> ```

**Target CLI improvements:**
- `deposit` accepts `--count N` instead of `--index N` (app picks indices)
- `send` replaces `redeem` as the primary command (reveal happens implicitly)
- `watch` provides live-updating status (replaces manual scan loop)
- `flow` combines everything into one command (like `nozk_flow.sh` but native)
- `status` shows a clean summary table, not per-token raw hex
- `balance` shows aggregated ETH amount, not token count

**Verbose mode for developers:**
```bash
nozk send --to 0xRecipient --amount 0.005 --verbose

  Token #12: reveal(nullifier=0x9bc2..., S=[0x7ce0..., 0x557f...])
    tx: 0xabc123... confirmed block 10576300 (gas: 142,000)
  Token #12: redeem(recipient=0xRecipient, deadline=1715180400)
    EIP-712 hash: 0xdef456...
    ECDSA sig: r=0x... s=0x... v=28
    tx: 0x789abc... confirmed block 10576302 (gas: 118,000)
  ...
```

---

## Information Architecture (Target)

```
Dashboard
├── Balance card (available / pending)
├── [Shield] button → Shield flow
├── [Send] button → Send flow
├── Activity feed (grouped by action, not by token)
│   └── Expandable detail (token-level info for power users)
└── Settings gear
    ├── Privacy mode toggle
    ├── Advanced view toggle (shows token-level detail)
    ├── Relayer configuration
    └── Network selection

Shield Flow (modal / sheet)
├── Amount input (ETH, with token count shown small)
├── Fee estimate
├── Confirm → single wallet approval
└── Progress → "waiting for mint" → "done"

Send Flow (modal / sheet)
├── Recipient address input (paste / QR scan / ENS)
├── Amount input (ETH)
├── Fee estimate (direct / via relayer)
├── Confirm → wallet approval (or relayer submit)
└── Progress → "sending" → "done"

Receive (modal / sheet)
├── "Share your address" + Copy + QR
└── (Future: stealth address / payment request link)

Recovery
└── Automatic on wallet connect — scan and restore
```

---

## Token Lifecycle (User-Facing vs. Protocol-Level)

| User sees | Protocol state | Trigger |
|-----------|---------------|---------|
| (nothing — shield in progress) | `deposit()` tx pending | User confirms shield |
| "Pending" | `DepositLocked` confirmed, no `MintFulfilled` | Deposit mined |
| "Pending" | `MintFulfilled` emitted, not yet revealed | Mint signed |
| "Available" | `reveal()` confirmed, nullifier = REVEALED | Auto-reveal or user-triggered |
| "Sending..." | `redeem()` tx pending | User confirms send |
| "Sent" | nullifier = SPENT | Redeem confirmed |
| "Refunded" | `Refunded` event | User requested refund |

**Key change:** The user never sees "AWAITING_MINT," "READY_TO_REVEAL," or "REVEALED" as separate states. From their perspective:
- After shielding: funds are "pending" until available
- Available funds can be sent immediately
- The reveal step is invisible (handled by the app automatically)

---

## Interactions with the Protocol That Should Be Invisible

| Protocol step | Why it exists | How it becomes invisible |
|---------------|--------------|--------------------------|
| `scan` for `MintFulfilled` | Recover unblinded signature | Background poller, auto on app load and periodic |
| `unblindSignature(S', r)` | Remove blinding factor | Automatic when `MintFulfilled` event found |
| `reveal(nullifier, S)` | Register nullifier on-chain | Auto-reveal in background, or just-in-time before send |
| Token index management | Deterministic key derivation | App tracks next-index internally; user never sees indices |
| EIP-712 proof generation | Anti-MEV binding | Generated automatically at send time |
| Deadline parameter | Signature expiry | App sets deadline = now + 1 hour; user never sets it |
| `depositId` derivation | Unique deposit identifier | Derived from seed; never shown to user |

---

## Open Design Questions

1. **Reveal timing:** Auto-reveal in background (costs gas per token, but makes send instant) vs. just-in-time reveal at send time (user waits longer during send, but no background gas spend)?

2. **Multi-denomination:** Current denomination is 0.001 ETH. Supporting user-specified amounts means either variable denomination (contract change) or the app managing bundles of fixed-denomination tokens internally. The latter is simpler.

3. **Relayer economics:** Who pays the relayer? Fee deducted from token value? Separate relayer token? Free relayer subsidized by the mint? This affects the "zero gas" UX promise.

4. **Batch transactions:** Can we use multicall/batch patterns to deposit or redeem multiple tokens in a single on-chain transaction? Reveal already supports `revealBatch()`. Deposit and redeem may need batch variants.

5. **ENS / address book:** Should the send flow support ENS names? This improves UX but introduces a privacy leak (ENS resolution reveals interest in the recipient).

6. **Notifications:** Should the app notify users when pending funds become available? Browser notifications? In-app badge?

7. **Cross-chain:** If NozKash deploys on multiple chains, should the balance view aggregate across chains or show per-chain?

---

## Success Metrics

The overhaul succeeds if:

- **Time to first shield:** Under 60 seconds from app load to confirmed deposit (excluding wallet install)
- **Steps to send:** Two interactions maximum (enter recipient + amount, confirm in wallet)
- **Zero protocol vocabulary:** A user who has never heard of BLS, nullifiers, or blind signatures can complete a full shield-and-send cycle without confusion
- **Recovery confidence:** A user who clears their browser can restore their full balance within 30 seconds of reconnecting their wallet
- **Privacy default:** No amount or address is visible on screen without explicit user action
