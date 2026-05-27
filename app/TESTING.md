# Frontend Manual Testing — Token State & Cache

> **Note:** These instructions are a draft and have not been fully verified.
> Commands, env vars, and setup steps may be outdated or incomplete.
> Refer to the main `CLAUDE.md` and `example.env` for authoritative configuration.

## Prerequisites

### Option A: Local Anvil (full on-chain flow)

**Terminal 1 — Local chain:**
```bash
anvil --chain-id 31337 --silent
```

**Terminal 2 — Deploy contract:**
```bash
cd sol
forge script script/NozkVault.s.sol:NozkVaultScript \
  --rpc-url http://127.0.0.1:8545 --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast
```

**Terminal 3 — Mint server (watches for deposits, posts blind signatures):**
```bash
cd nozk_py
uv run mint_server.py --verbosity verbose
```

**Terminal 4 — Relayer (handles reveal + redeem on behalf of users):**
```bash
cd nozk_py
uv run relayer_server.py --port 8000 --verbosity verbose
```

**Terminal 5 — Frontend:**
```bash
cd nozk_ts && npm install
cd ../app && npm install
npm run dev
```

Ensure `app/.env` has:
```env
VITE_CHAIN_ID=0x7a69
VITE_PUBLIC_RPC_URL=http://127.0.0.1:8545
VITE_RELAYER_URL=http://127.0.0.1:8000
VITE_NOZK_VAULT_ADDRESS=<deployed address>
VITE_NOZK_MASTER_SEED_HEX=<optional, for dev without wallet signing>
VITE_NOZK_DEBUG=true
```

### Option B: Sepolia testnet

Same as above but use Sepolia RPC endpoints and the deployed contract.
The mint server and relayer need funded Sepolia accounts.

### Option C: Mock flow (no chain, no servers)

```bash
cd nozk_py
bash nozk_flow.sh --to 0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7 --mock
```
This runs the full deposit->mint->reveal->redeem cycle offline. Does not test the frontend UI but verifies the crypto pipeline end-to-end.

### Debug logging

- Set `VITE_NOZK_DEBUG=true` in `app/.env` (or `app/.env.local`)
- Open browser console, filter for `[NozkVault`

## Test 1: Deposit (optimistic pending)

1. Connect wallet, unlock vault (sign)
2. Click "Add Deposit"
3. Confirm the 0.001 ETH transaction in MetaMask

**Expected:**
- "Pending" row appears **immediately** after tx confirms (optimistic)
- Console shows NO `fetch start` log — no full re-scan triggered
- Balance card "PENDING" count increments instantly

## Test 2: MintFulfilled polling

After depositing (Test 1), wait for the mint daemon to announce.

**Expected:**
- Within 10 seconds (one poll interval), the "Pending" row updates to "Deposit" (mint fulfilled)
- Console shows `fetchVaultRowForTokenIndex` probe for the pending token index
- No full `fetchVaultActivityForFirstTokens` scan runs

## Test 3: Reveal (instant local mutation)

1. Find a "Deposit" row (mint fulfilled, not yet revealed)
2. Click "Reveal"
3. Wait for relayer confirmation

**Expected:**
- Row updates from "Deposit" to "Revealed" **instantly** after tx confirms
- Console shows NO `fetch start` log
- Balance card: PENDING decreases, AVAILABLE increases

## Test 4: Redeem (instant local mutation)

1. Find a "Revealed" row
2. Enter a recipient address, click "Redeem"
3. Wait for relayer confirmation

**Expected:**
- Row updates from "Revealed" to "Redeem" (spent) **instantly**
- Console shows NO `fetch start` log
- Balance card: AVAILABLE decreases, SPENT increases

## Test 5: Refund (instant local mutation)

1. Find a "Pending" row (before mint announces)
2. Click "Refund"
3. Confirm in MetaMask

**Expected:**
- Row updates from "Pending" to "Refunded" **instantly**
- Console shows NO `fetch start` log

## Test 6: Batch reveal + batch redeem

1. With multiple "Deposit" tokens, use the batch reveal controls
2. Reveal N tokens at once

**Expected:**
- Each token updates to "Revealed" as its relayer call completes (one by one)
- No full scan after the batch

3. Then batch redeem N "Revealed" tokens

**Expected:**
- Each token updates to "Redeem" as its relayer call completes
- No full scan after the batch

## Test 7: localStorage persistence — instant reload

1. Complete tests 1-4 so you have tokens in various states
2. **Refresh the page** (F5)

**Expected:**
- Token rows appear **immediately** (loaded from localStorage)
- Console shows `seeding cache from localStorage` followed by `loaded from localStorage`
- An incremental scan runs from `lastBlock + 1` (should be near-instant, few blocks)
- No full scan from deployment block

## Test 8: localStorage cleared on account switch

1. Have tokens loaded
2. Disconnect wallet, connect a different account
3. Re-sign to unlock vault

**Expected:**
- Old rows disappear immediately
- Full scan runs for the new seed
- localStorage key changes (different seed hash)

## Test 9: Polling stops when no pending tokens

1. Ensure all tokens are in terminal states (Revealed, Redeemed, Refunded)
2. Watch console for 30+ seconds

**Expected:**
- No polling activity — no `fetchVaultRowForTokenIndex` calls
- Console silent (no `fetch start`, no probes)

## Test 10: Full recovery (clear localStorage)

1. Open DevTools > Application > Local Storage
2. Delete all `nozk:vault-activity:*` entries
3. Refresh the page

**Expected:**
- Full scan runs from deployment block (normal bootstrap)
- All tokens reconstructed correctly from chain
- localStorage repopulated after scan completes

## Debug tips

- **Console filter:** `[NozkVault` shows all vault debug logs
- **Check localStorage:** Look for keys starting with `nozk:vault-activity:` and `nozk:redemption-draft-v2`
- **Force full scan:** Call `clearVaultActivityCache()` in console, then trigger refresh via account switch
- **env overrides:**
  - `VITE_NOZK_VAULT_RPC_POLL_MS=5000` — faster polling (5s)
  - `VITE_NOZK_VAULT_SCAN_CACHE_MS=0` — disable in-memory cache TTL
  - `VITE_NOZK_DEBUG=true` — enable all debug logs
