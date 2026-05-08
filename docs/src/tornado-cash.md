# Tornado Cash

The original fixed-denomination privacy pool for Ethereum, using zk-SNARKs to break the on-chain link between depositors and withdrawers.

---

## Whitepaper

> A. Pertsev, R. Semenov, R. Storm.
> **"Tornado Cash Privacy Solution."** Version 1.4, December 2019.

- **PDF:** <https://berkeley-defi.github.io/assets/material/Tornado%20Cash%20Whitepaper.pdf>
- **Docs (archived):** <https://github.com/tornadocash/docs>

---

## Technical Design

### Commitment Scheme

On deposit, the user generates two random values:
- **secret** (s) — known only to the depositor
- **nullifier** (k) — used to prevent double-spending

The **commitment** is computed as:
```
commitment = PedersenHash(nullifier || secret)
```

The Pedersen hash maps the concatenation to a point on the **Baby JubJub** curve (a twisted Edwards curve over the BN254 scalar field).

### Merkle Tree

Commitments are inserted into a **Merkle tree** of height 20 (2^20 = ~1M leaves):
- Compression function: **MiMC** (Minimal Multi-Round Hash) permutation
- Tree is stored on-chain; each deposit appends a leaf and updates the root
- Old roots are cached so withdrawals can reference recent (not just current) roots

### Nullifier & Double-Spend Prevention

At withdrawal, the user reveals:
- `nullifierHash = Hash(nullifier)` — publicly posted, checked against a spent-nullifiers set
- A **Groth16 zk-SNARK proof** that they know (secret, nullifier) such that:
  1. `PedersenHash(nullifier || secret)` is a leaf in the Merkle tree
  2. `Hash(nullifier)` equals the publicly provided nullifier hash
  3. The Merkle path is valid up to a known root

The proof reveals nothing about *which* deposit corresponds to this withdrawal.

### Proof System: Groth16

- **Constant-size proofs:** 3 group elements (~256 bytes)
- **Fast verification:** Single pairing product equation (~200k gas on-chain)
- **Trusted setup required:** Powers-of-tau ceremony for proving/verification keys
- **Circuit:** Written in circom, compiled to R1CS

### Withdrawal via Relayer

To avoid linking the withdrawer's gas-paying address:
1. User sends proof + recipient to a **relayer** off-chain
2. Relayer submits the on-chain transaction and receives a fee `f`
3. Recipient receives `N - f` ETH (where N is the denomination)

---

## Fixed Denominations

Tornado Cash pools:
- 0.1 ETH, 1 ETH, 10 ETH, 100 ETH
- Plus ERC-20 pools (DAI, cDAI, USDC, USDT, WBTC)

Larger anonymity sets form in popular denominations, providing better privacy.

---

## Gas Costs

| Operation | Gas |
|-----------|-----|
| Deposit   | ~1M (Merkle tree update) |
| Withdrawal | ~300k-500k (zk-SNARK verification) |

---

## Key References

- **Groth16:** J. Groth, "On the Size of Pairing-based Non-interactive Arguments," EUROCRYPT 2016 — see [ZK Primitives](zk-primitives.md)
- **MiMC:** M. Albrecht et al., "MiMC: Efficient Encryption and Cryptographic Hashing with Minimal Multiplicative Complexity," ASIACRYPT 2016
- **Pedersen Hash:** Uses Baby JubJub curve (EIP-2494) with 4-bit window Pedersen commitments
- **circom:** Circuit compiler for R1CS — <https://github.com/iden3/circom>

---

## Comparison with NozKash

| Aspect | Tornado Cash | NozKash |
|--------|-------------|---------|
| Privacy mechanism | zk-SNARK (Groth16) | BLS blind signatures |
| Deposit gas | ~1,000,000 | ~50,000 |
| Redeem gas | ~300,000-500,000 | ~120,000 |
| Trusted setup | Required (ceremony) | Not required |
| Anonymity model | All deposits in pool | All deposits by the mint |
| Trust assumption | Trustless (math only) | Mint trusted for liveness |
| On-chain state | Merkle tree + nullifiers | Mappings + nullifiers |
| Denomination | 0.1/1/10/100 ETH | 0.001 ETH (PoC) |
