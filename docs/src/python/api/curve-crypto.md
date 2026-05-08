# Curve Crypto API Reference

<!-- TODO: Auto-generate from bn254_crypto.py and bls12_381_crypto.py docstrings -->

## BN254 (`bn254_crypto.py`)

Source: `nozk_py/bn254_crypto.py`

Uses `py_ecc` for curve operations.

### Key Functions

- `hash_to_G1(message)` -- try-and-increment hash to BN254 G1
- `point_add(P, Q)` -- elliptic curve point addition
- `point_mul(scalar, P)` -- scalar multiplication
- `pairing_check(pairs)` -- bilinear pairing verification

## BLS12-381 (`bls12_381_crypto.py`)

Source: `nozk_py/bls12_381_crypto.py`

Uses `chia_rs` (blst-based) for curve operations.

### Key Functions

- `hash_to_G1(message)` -- hash to BLS12-381 G1
- `sign(private_key, message)` -- BLS signature (PK=G1, Sig=G2 scheme)
- `verify(public_key, message, signature)` -- BLS verification
- `aggregate_signatures(sigs)` -- BLS signature aggregation
