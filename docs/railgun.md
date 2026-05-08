# RAILGUN

A shielded DeFi ecosystem that enables private token transfers, swaps, and smart contract interactions on Ethereum and EVM chains using zk-SNARKs.

---

## Overview

- **Website:** <https://www.railgun.org/>
- **Documentation:** <https://docs.railgun.org/>
- **ZK Cryptography:** <https://docs.railgun.org/wiki/learn/privacy-system/zero-knowledge-cryptography>
- **Kohaku integration:** `@kohaku-eth/railgun`

Unlike Tornado Cash (fixed denomination, deposit/withdraw only), RAILGUN maintains a full **shielded balance** system supporting arbitrary token amounts, private transfers between shielded addresses, and private DeFi interactions (swaps, lending, etc.).

---

## Technical Architecture

### UTXO Model

RAILGUN uses an **Unspent Transaction Output (UTXO)** model (like Bitcoin) but with all values hidden by zk-SNARKs:

```
Shield (deposit)
  └─ Creates encrypted UTXO(s) in the Merkle tree
       └─ Private Transfer / DeFi interaction
            └─ Consumes input UTXOs (reveals nullifiers)
            └─ Creates new output UTXOs (new commitments)
                 └─ Unshield (withdraw to public address)
```

### Proof System

- **Groth16 zk-SNARKs** — same proving system as Zcash Sapling and Tornado Cash
- **54 circuits** — differentiated by input/output count to support various transaction types
- Uses **EIP-197** (BN254 pairing) and **EIP-198** (modexp) precompiles for on-chain verification

### Hash Functions

- **Poseidon hash** — SNARK-friendly hash function for Merkle tree nodes and note commitments
  - Algebraic structure enables efficient in-circuit computation
  - ~8x fewer constraints than SHA-256 or Pedersen inside a zk-SNARK
- Merkle tree height: 16 levels (requires 16 Poseidon hashes per proof)

### Nullifiers & Double-Spend Prevention

Each UTXO has a deterministic **nullifier** derived from the owner's private key:
- Nullifier = Hash(private_key, utxo_index)
- Cannot be linked to the UTXO by external observers
- Published on-chain when the UTXO is spent
- Checked against a spent-nullifier set to prevent double-spending

### Shielding / Unshielding

- **Shield:** Transfer tokens from public address (0x) into private balance (0zk)
- **Unshield:** Transfer tokens from private balance back to a public address
- Private-to-private transfers never touch public addresses

---

## Private Proofs of Innocence (PPOI)

RAILGUN's compliance layer, developed independently by ZK cryptography researchers:

- **Documentation:** <https://docs.railgun.org/wiki/assurance/private-proofs-of-innocence>
- **Privacy Pools integration:** <https://docs.railgun.org/wiki/assurance/privacy-pools-private-proofs-of-innocence>

Each private transaction generates a zk-SNARK proof that the user's UTXOs do not originate from flagged addresses/transactions, without revealing which specific UTXOs are being spent.

---

## Gas Costs

On-chain verification of a Groth16 proof with RAILGUN's circuit sizes:

| Operation | Approximate Gas |
|-----------|----------------|
| Shield    | ~500,000-800,000 |
| Transfer  | ~800,000-1,200,000 |
| Unshield  | ~500,000-800,000 |

(Varies with circuit complexity and number of inputs/outputs.)

---

## Key Differences from Tornado Cash

| Aspect | Tornado Cash | RAILGUN |
|--------|-------------|---------|
| Model | Fixed-denomination pool | Arbitrary-amount UTXO |
| Token support | Separate pools per denomination | Any ERC-20 in one system |
| DeFi | Deposit/withdraw only | Full DeFi interaction while shielded |
| Compliance | None | Private Proofs of Innocence |
| Circuits | 1 circuit | 54 circuits |
| Hash function | Pedersen (Baby JubJub) + MiMC | Poseidon |

---

## Comparison with NozKash

| Aspect | RAILGUN | NozKash |
|--------|---------|---------|
| Privacy mechanism | zk-SNARK (Groth16) | BLS blind signatures |
| Anonymity model | UTXO set | Deposit/redeem pool |
| Gas per operation | ~500k-1.2M | ~50k-120k |
| Trusted setup | Required | Not required |
| DeFi composability | Full (private swaps, etc.) | Transfer only (PoC) |
| Trust model | Trustless | Mint trusted for liveness |
| Denomination | Arbitrary amounts | Fixed (0.001 ETH PoC) |
| Complexity | 54 circuits, heavy client | Simple scalar math |
