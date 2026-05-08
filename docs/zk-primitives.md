# ZK Primitives & Theory

Foundational zero-knowledge proof systems, hash functions, and algebraic structures used by Ethereum privacy protocols. NozKash does not use zk-SNARKs, but these are the theoretical underpinnings of the broader privacy ecosystem it exists alongside.

---

## Groth16

> J. Groth. **"On the Size of Pairing-based Non-interactive Arguments."**
> EUROCRYPT 2016, LNCS vol. 9666, pp. 305-326.

- **ePrint:** <https://eprint.iacr.org/2016/260.pdf>
- **Springer:** <https://link.springer.com/chapter/10.1007/978-3-662-49896-5_11>

The most widely deployed zk-SNARK scheme. Properties:

| Property | Value |
|----------|-------|
| Proof size | 3 group elements (~256 bytes) |
| Verification | 1 pairing product equation |
| On-chain gas | ~200,000 (BN254 pairing check) |
| Trusted setup | Required (per-circuit) |
| Prover time | O(n log n) for n constraints |

**Used by:** Tornado Cash, RAILGUN, Privacy Pools, Zcash Sapling.

The trusted setup produces toxic waste (trapdoor) that must be destroyed — if retained, fake proofs can be generated. Multi-party computation (MPC) ceremonies (Powers of Tau) distribute trust across many participants.

---

## Semaphore

A zero-knowledge protocol for anonymous group membership and signaling.

- **Website:** <https://semaphore.pse.dev/>
- **GitHub:** <https://github.com/semaphore-protocol/semaphore>
- **Docs:** <https://docs.semaphore.pse.dev/>
- **Specification:** <https://docs.zkproof.org/pages/standards/accepted-workshop3/proposal-semaphore.pdf>

**How it works:**
1. User generates an identity (private secret + random nullifier)
2. Identity commitment = Hash(identity) is added to an on-chain Merkle tree (identity group)
3. To signal, user generates a zk-SNARK proving they know a secret corresponding to some leaf in the tree, without revealing which one
4. An external nullifier scopes signals (e.g., one vote per election)
5. Double-signaling is prevented by the nullifier hash

**Applications:** Private voting (Aragon), anonymous attestations, World ID (Worldcoin), credential systems.

Developed by PSE (Privacy & Scaling Explorations), the same team behind Kohaku.

---

## Poseidon Hash

> L. Grassi, D. Kales, R. Khovratovich, A. Roy, C. Rechberger, M. Schofnegger.
> **"Poseidon: A New Hash Function for Zero-Knowledge Proof Systems."**
> USENIX Security 2021.

- **ePrint:** <https://eprint.iacr.org/2019/458.pdf>

An algebraic hash function designed specifically for zk-SNARK circuits:

| Property | Poseidon | SHA-256 (in circuit) | Pedersen |
|----------|----------|---------------------|----------|
| R1CS constraints | ~300 | ~25,000 | ~750 |
| Proof generation | Fast | Very slow | Medium |
| Native field | Any prime field | Bit-oriented | Curve-specific |

Poseidon operates natively over prime fields (matching zk-SNARK arithmetic), making it ~8x cheaper than SHA-256 and ~2.5x cheaper than Pedersen hashes inside circuits.

**Used by:** RAILGUN (Merkle tree, note commitments), Zcash Orchard, Privacy Pools, Semaphore v3+.

---

## Pedersen Hash & Commitments

Pedersen commitments: `C = v * G + r * H` where `v` is the value, `r` is a random blinding factor, and `G`, `H` are independent generator points.

Pedersen hashing maps data to curve points using windowed scalar multiplication — efficient inside zk-SNARK circuits when the curve matches the proof system's scalar field.

**Baby JubJub curve (EIP-2494):**
- A twisted Edwards curve defined over the BN254 scalar field
- Equation: `ax^2 + y^2 = 1 + dx^2y^2`
- Specifically designed for in-circuit use with BN254-based Groth16 proofs
- **EIP:** <https://eips.ethereum.org/EIPS/eip-2494>

**Used by:** Tornado Cash (deposit commitments), Zcash Sapling (note commitments), iden3 (identity).

---

## MiMC Hash

> M. Albrecht, L. Grassi, C. Rechberger, A. Roy, T. Tiessen.
> **"MiMC: Efficient Encryption and Cryptographic Hashing with Minimal Multiplicative Complexity."**
> ASIACRYPT 2016.

A block cipher / hash function with minimal multiplicative complexity, designed for zk-SNARK-friendly Merkle trees. Uses iterated cubing (x^3) or x^7 over a prime field.

**Used by:** Tornado Cash (Merkle tree internal nodes).

---

## Zcash Protocol (Context)

Zcash pioneered production zk-SNARK privacy on a blockchain. Its protocol evolution illustrates the progression of privacy primitives:

| Generation | Zcash Version | Proof System | Curve | Hash Function | Commitment |
|-----------|---------------|-------------|-------|---------------|------------|
| 1 | Sprout (2016) | PGHR13 | BN254 | SHA-256 | SHA-256 |
| 2 | Sapling (2018) | Groth16 | BLS12-381 | Jubjub/Pedersen | Windowed Pedersen |
| 3 | Orchard (2022) | Halo 2 | Pallas/Vesta | Sinsemilla/Poseidon | Sinsemilla |

- **Sapling spec:** <https://zips.z.cash/protocol/sapling.pdf>
- **Full spec:** <https://zips.z.cash/protocol/protocol.pdf>

Key innovations from Zcash adopted by Ethereum privacy protocols:
- **Jubjub curve:** Twisted Edwards curve over BLS12-381 scalar field (analogous to Baby JubJub over BN254)
- **Spend/view key separation:** Basis for stealth address dual-key schemes
- **Nullifier design:** Hash-based double-spend prevention, adopted by Tornado Cash and RAILGUN
- **Note commitments:** Homomorphic commitments enabling range proofs and balance verification

---

## How NozKash Avoids zk-SNARKs

NozKash achieves transaction unlinkability through **algebraic blinding** (BLS blind signatures) rather than zk-SNARKs:

| Property | zk-SNARK approach | NozKash approach |
|----------|-------------------|------------------|
| Unlinkability | Proof that some commitment exists in a Merkle tree | Blind signature: mint signs without seeing the message |
| Nullifier | Hash of secret, revealed at withdrawal | Spend address (secp256k1), revealed at redeem |
| Verification cost | ~200k-500k gas (pairing + circuit) | ~45k gas (single BN254 pairing) |
| Trusted setup | Required (MPC ceremony) | Not required |
| Client complexity | Circuit compilation, witness generation | Scalar multiplication |
| Trust model | Trustless | Mint trusted for liveness |

The tradeoff: NozKash requires trust in the mint's liveness (not privacy — the mint cannot link deposits to redemptions), while zk-SNARK protocols are fully trustless but far more expensive.
