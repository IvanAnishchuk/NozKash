# Hash-to-Curve

Methods for mapping arbitrary data to elliptic curve points, as used in NozKash.

---

## RFC 9380: Hashing to Elliptic Curves

- **Authors:** A. Faz-Hernandez, S. Scott, N. Sullivan, R. S. Wahby, C. A. Wood
- **Published:** August 2023 (IRTF Crypto Forum Research Group)
- **Link:** <https://www.rfc-editor.org/rfc/rfc9380.html>
- **Datatracker:** <https://datatracker.ietf.org/doc/rfc9380/>

The IETF standard for hashing arbitrary byte strings to elliptic curve points. Defines multiple algorithms including:
- **Simplified SWU (Shallue-van de Woestijne-Ulas)** — for curves where `ab != 0`
- **SWU with isogeny** — for curves like BLS12-381 where direct SWU doesn't apply
- **Icart, Elligator 2** — for other curve forms

Each algorithm provides indifferentiability from a random oracle when used with a suitable hash function and domain separation.

### Usage in NozKash

**BN254 (current on-chain):** NozKash does **NOT** use RFC 9380. Instead it uses **try-and-increment**:

```
for counter in 0, 1, 2, ...:
    x = keccak256(message || counter_be32) mod p
    rhs = x^3 + 3
    if rhs is a quadratic residue:
        y = rhs^((p+1)/4) mod p    # valid because p ≡ 3 (mod 4)
        return (x, y)
```

This is simpler but not constant-time. Acceptable for NozKash because the hash input (nullifier address) is public at verification time.

**BLS12-381 (off-chain, migration target):** The Python library (`bls12_381_crypto.py`) implements the RFC 9380-compatible pipeline matching the EIP-2537 `MAP_FP_TO_G1` precompile:

1. `keccak256(message)` -> 32 bytes
2. Interpret as Fp element
3. Simplified SWU map (`optimized_swu_G1`)
4. 11-isogeny map to BLS12-381 G1 (`iso_map_G1`)
5. Cofactor clearing (multiply by `h_1`)

This matches what the on-chain `MAP_FP_TO_G1` precompile (address `0x10`) does at steps 3-5.
