# R&D: Melt, Multi-Denomination, Batch Aggregation, and Epoch-Based Key Rotation

Research and design notes on advanced protocol features for NozKash.

---

## 1. Melt: Atomic Nullifier Exchange

### Concept

A **melt** operation lets a user atomically exchange a revealed token for a freshly minted one — consuming the old nullifier and producing a new one — without the funds ever touching a public address. The ETH stays inside the vault; only the cryptographic identity of the token changes.

```
User holds: token A (revealed, nullifier = N_A, denomination = 0.001 ETH)
User requests: melt(N_A) → token B (new nullifier = N_B)
Result: N_A is SPENT, new deposit created for N_B, mint blind-signs it
```

### Why Melt Matters

1. **Anonymity set refresh.** A token minted in epoch 1 carries the "epoch 1 anonymity set." Melting it in epoch 5 migrates it into the epoch 5 set — a larger, fresher pool. This is the primary anonymity amplifier (see Section 4).

2. **Denomination change.** Melt is the mechanism for splitting and combining tokens across denominations (see Section 2). Melt 1x 0.01 ETH into 10x 0.001 ETH, or combine 10x 0.001 ETH into 1x 0.01 ETH.

3. **Key rotation migration.** When the mint rotates keys (see Section 4), old tokens signed under the previous key need to be re-signed under the new key. Melt is how users do this voluntarily.

4. **Forward secrecy.** After melting, the old nullifier is spent. Even if the user's seed is later compromised, the old token's linkage to the new one is protected by the blinding factor of the new token — the mint signed it blindly and cannot correlate old to new.

### Protocol Design

**On-chain:**
```solidity
function melt(
    bytes32          oldNullifierId,
    uint256[4] calldata spendSig,      // BLS spend proof for old token
    uint256          deadline,
    address          newDepositId,      // blind keypair address for new token
    uint256[4] calldata newBlindedB     // blinded point for new token
) external {
    // 1. Verify old token is REVEALED
    // 2. Verify BLS spend signature (same as redeem, but recipient = address(this))
    // 3. Mark old nullifier SPENT
    // 4. Register new deposit (same as deposit(), but no msg.value — ETH stays in vault)
    // 5. Emit MeltCompleted(oldNullifierId, newDepositId)
}
```

**Key property:** The ETH never leaves the contract. The old token is consumed and a new deposit slot is created in the same transaction. The mint then blind-signs the new deposit (via `announce()`) just like any other deposit.

**Mint's view:** The mint sees a `MeltCompleted` event with a `newDepositId` and a blinded point `B`. It cannot link this to the old nullifier because:
- The spend signature proves ownership of the old token, but the new `B` is blinded with a fresh `r`
- The mint signs `B` without knowing what nullifier it will resolve to
- The old and new deposit IDs are derived from different keypairs

### Melt vs. Redeem-then-Deposit

A user could achieve a similar result by redeeming to themselves and re-depositing. Melt is better because:

| Aspect | Redeem + Deposit | Melt |
|--------|-----------------|------|
| ETH leaves contract | Yes (to user, then back) | No |
| Gas cost | ~120k + ~50k = ~170k | ~130k (est.) |
| On-chain linkability | Redeem and deposit in same tx/block = obvious link | Single atomic tx, no ETH movement visible |
| Requires gas-paying address | Yes (for both txs) | Yes (for one tx), or relayer |
| Denomination change | No (same denomination in and out) | Yes (multi-denomination melt) |

### Cashu Precedent

Cashu's **swap** operation (NUT-03) is the closest analogue:
- User sends old tokens + new blinded secrets to the mint
- Mint verifies and invalidates old tokens, blind-signs new ones
- Used for: denomination change (split/combine), privacy refresh, token consolidation

Cashu NUT specifications: <https://github.com/cashubtc/nuts>
Cashu docs: <https://docs.cashu.space/protocol>

---

## 2. Multi-Denomination and Multi-Currency

### Denomination Tiers

The contract currently enforces a single `DENOMINATION = 0.001 ether`. To support arbitrary amounts efficiently, use power-of-2 (or power-of-10) denomination tiers:

```
Tier 0:  0.001 ETH    (current)
Tier 1:  0.01  ETH    (10x)
Tier 2:  0.1   ETH    (100x)
Tier 3:  1     ETH    (1000x)
```

**Why powers, not arbitrary amounts:** Fixed denominations create a "hide in the crowd" effect. If everyone deposits 0.001 ETH, all tokens look identical on-chain. Variable amounts would be fingerprints.

### Contract Design

**Option A: Per-tier mint key (Privacy Pools model)**

Each denomination tier has its own BLS keypair. The contract stores:
```solidity
mapping(uint8 => uint256[8]) public pkMint;  // tier => G2 pubkey
mapping(uint8 => uint256) public denomination; // tier => wei amount
```

Deposit specifies a tier. Reveal checks the signature against that tier's key. Melt can cross tiers (consume tier-2 token, produce 10x tier-1 tokens).

Pros: Each tier has an independent anonymity set; compromise of one key doesn't affect others.
Cons: Smaller per-tier anonymity sets; more keys to manage.

**Option B: Single mint key, denomination in token metadata**

One mint key signs all denominations. The denomination is encoded in the blinded point's domain separation:
```
Y = H_G1("tier:" || tier_byte || abi.encode(spendPub))
```

The contract stores `revealedAmount[nId]` per nullifier (already in V1/V2).

Pros: One anonymity set; simpler key management.
Cons: All denominations share a key — compromise affects everything.

**Recommendation:** Option A for production (isolates risk), Option B for PoC (simpler).

### Multi-Currency (ERC-20)

Extend the contract to accept ERC-20 tokens:

```solidity
function deposit(
    address token,          // address(0) for ETH, ERC-20 address otherwise
    uint8   tier,
    address depositId,
    uint256[4] calldata B
) external payable {
    if (token == address(0)) {
        require(msg.value == denomination[tier]);
    } else {
        IERC20(token).transferFrom(msg.sender, address(this), denomination[tier]);
    }
    // ... rest of deposit logic
}
```

Each (token, tier) pair is a separate pool with its own anonymity set. Per-tier mint keys are more natural here — the mint can have different signing policies per asset.

**Anonymity consideration:** Splitting across too many (token, tier) combinations fragments the anonymity set. Prioritize popular pairs (ETH 0.1, USDC 100, etc.).

### Melt Across Denominations

Melt enables denomination change without ETH leaving the contract:

```
Melt 1x Tier-2 (0.1 ETH) → 10x Tier-1 (0.01 ETH each)
Melt 10x Tier-0 (0.001 ETH each) → 1x Tier-1 (0.01 ETH)
```

The contract verifies that the total value consumed equals the total value produced:
```solidity
function meltMulti(
    bytes32[] calldata oldNIds,        // tokens to consume
    uint256[4] calldata oldSigma,      // aggregated spend signature
    uint256 deadline,
    address[] calldata newDepositIds,   // new deposit IDs
    uint256[4][] calldata newBs,       // blinded points
    uint8[] calldata newTiers          // denomination tiers
) external {
    // 1. Verify + spend old tokens (aggregated BLS check)
    // 2. Sum old amounts
    // 3. Sum new amounts from tiers
    // 4. Require old_total == new_total
    // 5. Register new deposits
}
```

---

## 3. Batch Reveal and Batch Redeem via BLS12-381 Aggregation

### What Already Exists

The BLS12-381 branch already has aggregation primitives implemented (not yet on `main`):

**Off-chain (`nozk_py/nozk_library.py` on the BLS12-381 branch):**
- `aggregate_reveal_sigma(sigs)` — sum G1 points for batch reveal
- `verify_aggregated_reveal(sigma, spend_pubs, pk_mint)` — single pairing check
- `aggregate_redeem_sigma(sigs)` — sum G1 points for batch redeem
- `verify_aggregated_redeem(sigma, msg_hash, spend_pubs)` — single pairing check

**On-chain (`sol/src/NozkVaultV2.sol` on the BLS12-381 branch):**
- `revealAggregated(spendPubs[], sigma)` — single pairing check for n reveals
- `redeemAggregated(recipient, sigma, nIds[], deadline)` — single pairing check for n redeems

### Gas Savings

The key insight: BLS pairing checks are expensive (~113k gas on BN254 for k=2 pairs, higher on BLS12-381), but only need to be done **once** regardless of batch size. The per-token cost is dominated by storage writes and hash-to-curve, not by pairing.

**Estimated gas per token (BLS12-381, EIP-2537):**

| Operation | Single | Batch of 10 | Savings |
|-----------|--------|-------------|---------|
| reveal | ~180k | ~90k/token (~900k total) | ~50% |
| redeem | ~160k | ~80k/token (~800k total) | ~50% |
| melt | ~200k | ~100k/token (~1M total) | ~50% |

The BLS12-381 pairing precompile is more expensive than BN254 (~103k vs ~113k for k=2 pairs per EIP-2537: `32,600*k + 37,700`), but:
- `MAP_FP_TO_G1` replaces try-and-increment (~14k vs ~30k average on-chain)
- `G1ADD` for aggregation is cheap (~500 gas per addition)
- One pairing check amortized across n tokens makes batch operations significantly cheaper per-token

### Aggregation Algebra

**Batch reveal** (same mint key, different nullifiers):
```
sigma = S_1 + S_2 + ... + S_n          (client-side G1 addition)
Y_agg = H(pub_1) + H(pub_2) + ... + H(pub_n)  (on-chain G1 addition)
Verify: e(sigma, G2_gen) == e(Y_agg, PK_mint)  (single pairing check)
```

This works because BLS signatures are linearly homomorphic:
```
e(S_1 + S_2, G2) = e(S_1, G2) · e(S_2, G2)
                  = e(Y_1, PK) · e(Y_2, PK)
                  = e(Y_1 + Y_2, PK)
```

**Batch redeem** (same message, different spend keys):
```
sigma = sig_1 + sig_2 + ... + sig_n     (client-side G1 addition)
PK_agg = pub_1 + pub_2 + ... + pub_n    (on-chain G2 addition)
Verify: e(sigma, G2_gen) == e(H(msg), PK_agg)  (single pairing check)
```

**Constraint:** Batch redeem requires all tokens to go to the **same recipient** with the **same deadline** (same EIP-712 message hash). This is the natural case for "send 0.05 ETH to Alice" (50 tokens, one recipient).

### Rogue Key Mitigation in Batch Redeem

When aggregating public keys from different spend keypairs, the rogue key attack becomes relevant (see security-research.md). An attacker could craft a rogue spend key that, when aggregated with a victim's key, produces a valid aggregate signature for a message the victim never signed.

**NozKash mitigation:** The spend public keys are stored on-chain at `reveal()` time. The `redeemAggregated()` function loads keys from storage (not from user input), making it impossible for an attacker to inject a rogue key into the aggregation. The on-chain contract is the source of truth for which keys participate.

### Future: Cross-Message Aggregation

BLS also supports aggregating signatures over **different messages** (multi-message aggregation), but this requires n pairing computations on the verifier side (one per distinct message), so the gas savings come only from reduced calldata and storage overhead, not from pairing amortization. This could be useful for batch-redeeming tokens to different recipients in a single tx, but the gas win is smaller.

---

## 4. Epoch-Based Mint Key Rotation

### Concept

The mint periodically rotates its BLS keypair on a fixed schedule (**epochs**). Each epoch has its own key, and tokens signed under epoch k's key are verified against epoch k's public key.

```
Epoch 1 (blocks 0–10000):     key_1, PK_1
Epoch 2 (blocks 10001–20000):  key_2, PK_2
Epoch 3 (blocks 20001–30000):  key_3, PK_3
...
```

### Why Rotate

1. **Forward secrecy.** If key_k is compromised after epoch k ends and the mint has deleted it, the attacker cannot forge tokens for epoch k (the key is gone). Without rotation, a single key compromise allows unlimited forgery for all time.

2. **Bounded anonymity sets with known properties.** Each epoch's anonymity set is bounded and measurable: "this token was minted during epoch k, which had N deposits." Users and auditors can reason about anonymity guarantees per-epoch.

3. **Compliance windows.** Epochs create natural boundaries for compliance policy changes. A mint could apply different screening rules per epoch without affecting existing tokens.

4. **Key compromise recovery.** If a key is compromised mid-epoch, the mint can end the epoch early and rotate. Only tokens from the compromised epoch are at risk, not the entire history.

### Contract Design

```solidity
// Epoch state
struct Epoch {
    uint256[8] pkMint;      // G2 public key for this epoch
    uint64     startBlock;
    uint64     endBlock;     // 0 = current epoch (still active)
    bool       frozen;       // true = no new deposits accepted
}

mapping(uint32 => Epoch) public epochs;
uint32 public currentEpoch;

// Each nullifier records which epoch it was minted in
mapping(bytes32 => uint32) public nullifierEpoch;
```

**Reveal** checks the signature against the epoch's key:
```solidity
function _reveal(uint256[8] calldata spendPub, uint256[4] calldata S, uint32 epoch) internal {
    Epoch storage ep = epochs[epoch];
    // ... hash-to-curve, pairing check against ep.pkMint ...
}
```

**Melt** consumes a token from any epoch and produces a new deposit in the **current** epoch:
```solidity
function melt(..., uint32 oldEpoch) external {
    // Verify old token against oldEpoch's key
    // Spend old nullifier
    // Create new deposit in currentEpoch
}
```

### Impact on Anonymity Sets

Without epochs, NozKash has a single, ever-growing anonymity set (all deposits ever signed by the mint). With epochs, each epoch has its own anonymity set.

**Naive analysis:** Epochs fragment the anonymity set. A token minted in epoch 3 can only hide among other epoch-3 tokens. If epoch 3 had only 20 deposits, the anonymity set is 20 — much worse than the global set of 10,000.

**Melt as the solution:** Melting a token moves it from epoch k's set into the current epoch's set. If users routinely melt old tokens (or the wallet does it automatically), the current epoch's set accumulates tokens from all previous epochs plus new deposits.

```
Epoch 1: 100 deposits
Epoch 2: 150 deposits + 80 melted from epoch 1 = 230 effective set
Epoch 3: 200 deposits + 180 melted from epochs 1-2 = 380 effective set
...
```

**The key insight:** Melting is the anonymity set amplifier. Without it, epochs are strictly worse for privacy. With it, epochs provide forward secrecy AND growing anonymity sets — the best of both worlds.

### Epoch Parameters

| Parameter | Tradeoff |
|-----------|----------|
| **Epoch length** | Short (1 day): better forward secrecy, smaller per-epoch sets, more frequent melts needed. Long (1 month): larger per-epoch sets, weaker forward secrecy. |
| **Grace period** | How long old-epoch tokens remain redeemable without melting. Infinite = no forced migration. Fixed (e.g., 3 epochs) = forces melt, grows current set, but inconveniences users. |
| **Auto-melt** | Wallet automatically melts old-epoch tokens in background. Best UX but costs gas. |
| **Melt incentive** | Fee discount or gas subsidy for melting old tokens. Encourages migration without forcing it. |

**Recommended starting point:** 1-week epochs, infinite grace period (old tokens never expire), wallet auto-melts when gas is cheap.

### Mint Key Rotation Protocol

1. Mint generates new keypair `(sk_{n+1}, PK_{n+1})`
2. Mint calls `rotateKey(PK_{n+1})` on the contract → creates new epoch, stores new PK
3. Previous epoch's `endBlock` is set to current block
4. Mint securely deletes `sk_n` (forward secrecy)
5. New deposits go into the new epoch; old tokens continue working against their epoch's key
6. Users melt old-epoch tokens at their convenience (or wallet does it automatically)

### Aggregated Batch Reveal Across Epochs

Batch aggregation requires all tokens in the batch to share the same mint key (same epoch). Cross-epoch batching is NOT possible with simple aggregation because the keys differ.

**Workaround:** The client groups tokens by epoch, creates one aggregated signature per epoch, and submits multiple `revealAggregated()` calls (or a multicall). The gas savings still apply within each epoch's batch.

---

## 5. Combined Flow: Melt + Epochs + Batching

### User Story: "Send 0.05 ETH to Alice"

```
User's wallet state:
  Epoch 2: 20 tokens (0.001 ETH each) — old epoch
  Epoch 5: 30 tokens (0.001 ETH each) — current epoch

User requests: send 0.05 ETH to Alice (= 50 tokens needed)

Wallet strategy:
  1. Auto-melt 20 epoch-2 tokens into epoch-5:
     - Aggregated spend proof for 20 tokens (single pairing check)
     - meltBatch(oldNIds[20], sigma, newDeposits[20])
     - Wait for mint to sign 20 new deposits
     - Aggregated reveal for 20 new epoch-5 tokens

  2. Select 50 epoch-5 tokens (30 existing + 20 freshly melted):
     - Aggregated redeem to Alice (single pairing check)
     - redeemAggregated(alice, sigma, nIds[50], deadline)

  3. Net on-chain cost:
     - 1 melt tx (~100k per token amortized, ~2M total)
     - 1 reveal tx (~90k per token amortized, ~1.8M total for 20 new tokens)
     - 1 redeem tx (~80k per token amortized, ~4M total for 50 tokens)
     Total: ~7.8M gas (vs ~14M for 50 individual reveal+redeem pairs)
```

In practice the wallet would melt proactively during low-gas periods, so the send itself only requires step 2.

### Optimization: Melt-and-Reveal in One Transaction

A `meltAndReveal()` function could combine the melt and the immediate reveal of the new tokens (since the mint signs them in the same block via `announce()`):

```solidity
function meltAndReveal(
    // Old tokens to consume
    bytes32[] calldata oldNIds,
    uint256[4] calldata oldSigma,
    uint32 oldEpoch,
    uint256 deadline,
    // New tokens to create AND immediately reveal
    uint256[8][] calldata newSpendPubs,
    uint256[4][] calldata newBlindedBs,
    address[] calldata newDepositIds
) external {
    // 1. Verify + spend old tokens (aggregated)
    // 2. Register new deposits
    // 3. Emit events for mint to sign
    // NOTE: reveal must wait for mint's announce(), so this only does deposit
}
```

The full melt-reveal-redeem pipeline needs at least 2 blocks (melt+deposit in block N, mint announce in block N+1, reveal+redeem in block N+2), but the wallet handles this transparently.

---

## 6. Open Research Questions

1. **Melt fee.** Should melting cost a fee (to fund relayer infrastructure)? Or should it be free (to maximize migration and anonymity set growth)? A small fee discourages frivolous melting but also discourages the exact behavior we want.

2. **Forced migration.** Should old-epoch tokens eventually expire, forcing users to melt? This maximizes the current epoch's anonymity set but adds UX friction. Cashu handles this by simply refusing to accept old tokens after a mint key rotation — harsh but effective.

3. **Epoch length discovery.** What's the optimal epoch length? Too short and the anonymity set per epoch is small; too long and forward secrecy is weak. This likely depends on deposit volume — can we make epoch length adaptive (rotate when the set reaches N deposits)?

4. **Cross-denomination melt privacy.** When melting 1x 0.01 ETH into 10x 0.001 ETH, the "1 in, 10 out" pattern is visible on-chain. Can we batch multiple users' melts together to obscure individual patterns? (Similar to CoinJoin for denomination changes.)

5. **Threshold mint key rotation.** With N-of-M threshold blind signatures, key rotation requires distributed key generation (DKG) per epoch. How does this interact with the melt protocol? Can the threshold committee rotate without all members being online simultaneously?

6. **Relayer integration for melt.** Melting is the ideal operation for relayer-subsidized gas — the user isn't moving value to an external address, just refreshing their tokens. The relayer can't steal funds (ETH stays in contract). Consider making melt gas-free via relayer by default.

---

## References

- Cashu NUT-03 (swap/split): <https://github.com/cashubtc/nuts>
- Cashu protocol docs: <https://docs.cashu.space/protocol>
- Fedimint (federated blind signatures): <https://github.com/fedimint/fedimint>
- BLS multi-signatures: <https://crypto.stanford.edu/~dabo/pubs/papers/BLSmultisig.html>
- EIP-7591 (BLS signed transactions): <https://eips.ethereum.org/EIPS/eip-7591>
- BLS Wallet (PSE, signature aggregation): <https://medium.com/privacy-scaling-explorations/bls-wallet-bundling-up-data-fb5424d3bdd3>
- Pragmatic BLS aggregation: <https://ethresear.ch/t/pragmatic-signature-aggregation-with-bls/2105>
- Privacy Pools paper: <https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4563364>
