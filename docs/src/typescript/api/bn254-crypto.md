# bn254-crypto API Reference

<!-- TODO: Auto-generate from nozk_ts/bn254-crypto.ts via typedoc or similar -->

Source: `nozk_ts/bn254-crypto.ts`

BN254 elliptic curve operations for the TypeScript implementation.

## Key Functions

- `hashToG1(message)` -- try-and-increment hash to BN254 G1
- `pointAdd(P, Q)` -- elliptic curve point addition
- `pointMul(scalar, P)` -- scalar multiplication
- `pairingCheck(pairs)` -- bilinear pairing verification

## Dependencies

Uses `@noble/curves` and `viem` for underlying curve arithmetic and hashing.
