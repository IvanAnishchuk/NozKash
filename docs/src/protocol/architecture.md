# Protocol Architecture

## Token Lifecycle

```
FRESH -> AWAITING_MINT -> READY_TO_REDEEM -> SPENT
```

## Flow

```
CLIENT: derive token secrets from (masterSeed, index)
  +-- spend_priv -> spend_addr (nullifier at redeem)
  +-- blind_priv -> deposit_id + blinding factor r

CLIENT: blind_token() -> B = r * H_G1(spend_addr)
CONTRACT: deposit(depositId, B) -> emits DepositLocked {locks 0.001 ETH}
MINT: announce(depositId, S') where S' = sk * B
CLIENT: unblind_signature() -> S = S' * r^-1 = sk * H(spend_addr)
CLIENT: generate_redemption_proof() -> ECDSA binding token to recipient
CONTRACT: reveal() + redeem() -> verifies ecPairing + ecrecover, transfers 0.001 ETH
```

## Verification (on-chain)

1. `ecrecover` -- confirm signer == nullifier
2. Check nullifier not already spent -- prevent double-spend
3. Hash-to-curve on nullifier
4. `ecPairing(S, G2) == ecPairing(H(nullifier), pkMint)` -- BLS verification

## Design Constraints

- **Fixed denomination:** 0.001 ETH per token (hardcoded in contract)
- **Limited refund:** Depositors can reclaim ETH only before `announce()`. Once announced, redemption is the only exit
- **Stateless mint:** The mint daemon stores nothing -- all state is on-chain
- **Stateless recovery:** Every wallet secret is re-derivable from `(masterSeed, index)` via scan
- **MEV protection:** ECDSA in `redeem()` binds the nullifier to a specific recipient

## Cross-Language Cryptographic Parity

`nozk_py/nozk_library.py` is the **source of truth**. `nozk_ts/nozk-library.ts` is a byte-for-byte port. Both must produce identical output, enforced by shared JSON test vectors in `test_vectors/`.

See [Python API](../python/api/nozk-library.md) and [TypeScript API](../typescript/api/nozk-library.md) for implementation details.
