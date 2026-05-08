# NozkVault (v1)

<!-- TODO: Auto-generate from Solidity NatSpec comments via forge doc -->

Source: `sol/src/NozkVault.sol`

BN254-based vault using EIP-196/197 precompiles (`ecAdd`, `ecMul`, `ecPairing`).

## Entry Points

### `deposit(address depositId, uint256[2] B)`

Lock 0.001 ETH and register a blinded point.

### `announce(address depositId, uint256[2] S_prime)`

Mint authority posts the blind signature for a deposit.

### `reveal(nullifier, S, spend_pub_G2)`

Reveal nullifier and BLS signature (first step of two-step egress).

### `redeem(address recipient, bytes sig, address nullifier, uint256 deadline)`

Verify ECDSA proof and transfer 0.001 ETH to recipient.

### `refund(address depositId)`

Reclaim ETH if mint never fulfilled (only before `announce()`).

## On-Chain Verification

1. `ecrecover` -- confirm signer == nullifier
2. Nullifier uniqueness check -- prevent double-spend
3. Hash-to-curve on nullifier
4. `ecPairing(S, G2) == ecPairing(H(nullifier), pkMint)` -- BLS verification

## ABI

The canonical ABI is at `abi/nozk_vault_abi.json`. After interface changes, run:

```bash
cd sol && python sync_abi.py
```
