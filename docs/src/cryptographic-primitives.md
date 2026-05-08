# Cryptographic Primitives

Research papers and standards underlying the NozKash protocol.

---

## BLS Signatures

> D. Boneh, B. Lynn, H. Shacham. **"Short Signatures from the Weil Pairing."**
> ASIACRYPT 2001, LNCS vol. 2248, pp. 514-532. Springer, 2001.

- **IACR archive:** <https://www.iacr.org/archive/asiacrypt2001/22480516.pdf>
- **Springer:** <https://link.springer.com/chapter/10.1007/3-540-45682-1_30>
- **Author's copy:** <https://hovav.net/ucsd/dist/sigs.pdf>

The foundational paper for BLS (Boneh-Lynn-Shacham) signatures. Leverages bilinear pairings on elliptic curves to produce very short signatures (~160 bits at the time) based on the Computational Diffie-Hellman assumption.

**Used in NozKash:** The core signature scheme. The mint blind-signs tokens using BLS, and verification uses the pairing equation `e(S, G2) == e(H(msg), PK)`.

---

## Blind Signatures

> D. Chaum. **"Blind Signatures for Untraceable Payments."**
> Advances in Cryptology — CRYPTO '82, pp. 199-203. Plenum (Springer-Verlag), 1983.

- **Springer:** <https://link.springer.com/chapter/10.1007/978-1-4757-0602-4_18>
- **Semantic Scholar:** <https://www.semanticscholar.org/paper/Blind-Signatures-for-Untraceable-Payments-Chaum/dc821ab3a1a3b49661639da37e980bfd21d3746a>
- **Author's website:** <https://chaum.com/ecash/>

The original paper introducing blind signatures and their application to untraceable electronic cash (eCash). A blind signature lets a signer sign a message without learning its content; the resulting signature is publicly verifiable against the original message.

**Used in NozKash:** The protocol follows Chaum's eCash design — the mint blind-signs deposit tokens so it cannot link deposits to redemptions. NozKash uses multiplicative blinding in the BN254/BLS12-381 scalar field: `B = r * H(msg)`, `S' = sk * B`, `S = S' * r^{-1} = sk * H(msg)`.

---

## BN254 (alt_bn128) Curve

> P. S. L. M. Barreto, M. Naehrig. **"Pairing-Friendly Elliptic Curves of Prime Order."**
> Selected Areas in Cryptography — SAC 2005, LNCS vol. 3897, pp. 319-331. Springer, 2006.

- **PDF:** <https://www.cryptojedi.org/papers/pfcpo.pdf>
- **Primer:** <https://hackmd.io/@jpw/bn254>

Describes the construction of Barreto-Naehrig (BN) curves — pairing-friendly elliptic curves of prime order with embedding degree 12. BN254 is a specific instantiation with a 254-bit field modulus.

Parameters used in NozKash (`NozkVault.sol`):
- Field modulus `p = 21888242871839275222246405745257275088696311157297823662689037894645226208583`
- Curve order `q = 21888242871839275222246405745257275088548364400416034343698204186575808495617`
- Curve equation: `Y^2 = X^3 + 3`

**Security note:** BN254 provides ~100-bit security (not the originally estimated 128-bit) due to advances in discrete log algorithms (Kim-Barbulescu 2016). This motivates the planned migration to BLS12-381.

---

## BLS12-381 Curve

> S. Bowe. **"BLS12-381: New zk-SNARK Elliptic Curve Construction."**
> Electric Coin Company (Zcash), 2017.

- **Blog post:** <https://electriccoin.co/blog/new-snark-curve/>
- **Primer:** <https://hackmd.io/@benjaminion/bls12-381>
- **Standard curve database:** <https://std.neuromancer.sk/bls/BLS12-381/>

Designed by Sean Bowe for the Zcash Sapling upgrade. Part of the Barreto-Lynn-Scott (BLS) family of curves with embedding degree 12 and a 381-bit field modulus. Provides ~117-120 bit security.

Widely adopted: Ethereum Beacon Chain, Zcash, Filecoin, Algorand, Dfinity, Chia, and others.

**Used in NozKash:** Target curve for the BN254 migration. The Python library (`bls12_381_crypto.py`) already implements off-chain BLS12-381 operations using `py_ecc.optimized_bls12_381`. On-chain verification will use EIP-2537 precompiles (available post-Pectra).

---

## ECDSA and secp256k1

NozKash uses standard Ethereum ECDSA (secp256k1) for:
- **Nullifier binding:** The spend keypair signs an EIP-712 message binding the nullifier to a recipient address, verified on-chain via `ecrecover`
- **Deposit ID derivation:** The blind keypair's Ethereum address serves as the deposit identifier
- **Seed derivation (frontend):** `personal_sign` → `keccak256(signature)` = master seed

The secp256k1 curve is defined in SEC 2: **"Recommended Elliptic Curve Domain Parameters"** by Certicom Research.

- **Standard:** <https://www.secg.org/sec2-v2.pdf>
