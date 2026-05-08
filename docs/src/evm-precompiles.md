# EVM Precompile EIPs

EIPs defining the elliptic curve precompiles used by NozKash.

---

## EIP-196: Precompiled contracts for addition and scalar multiplication on alt_bn128

- **Authors:** Christian Reitwiessner
- **Status:** Final (Core)
- **Created:** 2017-02-06
- **Link:** <https://eips.ethereum.org/EIPS/eip-196>

Adds two precompiled contracts for BN254 (alt_bn128) point arithmetic:

| Precompile | Address | Gas cost |
|------------|---------|----------|
| ecAdd      | `0x06`  | 150      |
| ecMul      | `0x07`  | 6,000    |

The curve is defined as `Y^2 = X^3 + 3` over `F_p` where
`p = 21888242871839275222246405745257275088696311157297823662689037894645226208583`.

**Used in NozKash:** The contract does not call `ecAdd` or `ecMul` directly. It uses `modexp` at `0x05` for hash-to-curve square root computation and `ecPairing` at `0x08` for BLS verification. These precompiles define the curve NozKash operates on.

**References:** EIP-197 (pairing companion).

---

## EIP-197: Precompiled contracts for optimal ate pairing check on alt_bn128

- **Authors:** Vitalik Buterin, Christian Reitwiessner
- **Status:** Final (Core)
- **Created:** 2017-02-06
- **Link:** <https://eips.ethereum.org/EIPS/eip-197>

Adds a pairing check precompile for BN254:

| Precompile | Address | Gas cost                        |
|------------|---------|----------------------------------|
| ecPairing  | `0x08`  | 34,000 * k + 45,000 (k = pairs) |

Input: k pairs of (G1, G2) points (192 bytes each). Returns 1 if the product of pairings equals the identity in F_q^12, else 0.

**Used in NozKash:** BLS signature verification in `NozkVault.verifyBLS()` — checks `e(S, G2_gen) == e(H(nullifier), PK_mint)` by encoding as `e(S, G2_gen) * e(-H(nullifier), PK_mint) == 1`.

G2 points use **EIP-197 limb order**: `[X_imag, X_real, Y_imag, Y_real]`.

**References:** EIP-196 (point arithmetic companion).

---

## EIP-2537: Precompile for BLS12-381 curve operations

- **Authors:** Alex Vlasov, Kelly Olson, Alex Stokes, Antonio Sanso
- **Status:** Final (Core) — included in Pectra hard fork
- **Created:** 2020-02-21
- **Link:** <https://eips.ethereum.org/EIPS/eip-2537>

Adds nine precompiles for BLS12-381 operations, providing ~117-120 bit security (vs ~100-bit for BN254; the EIP text conservatively states 80-bit, but post-TNFS academic estimates converge on ~100):

| Operation            | Address | Purpose                        |
|----------------------|---------|--------------------------------|
| BLS12_G1ADD          | `0x0b`  | G1 point addition              |
| BLS12_G1MSM          | `0x0c`  | G1 multi-scalar multiplication |
| BLS12_G2ADD          | `0x0d`  | G2 point addition              |
| BLS12_G2MSM          | `0x0e`  | G2 multi-scalar multiplication |
| BLS12_PAIRING_CHECK  | `0x0f`  | Pairing verification           |
| BLS12_MAP_FP_TO_G1   | `0x10`  | Field element to G1 mapping    |
| BLS12_MAP_FP2_TO_G2  | `0x11`  | Fp2 element to G2 mapping      |

Point encoding: 128 bytes for G1 (two 64-byte Fp elements), 256 bytes for G2 (four 64-byte Fp elements). Each Fp element is 48 bytes zero-padded to 64 bytes.

**Used in NozKash:** Target curve for the planned BN254 -> BLS12-381 migration. The Python library (`bls12_381_crypto.py`) already implements the off-chain side using `py_ecc.optimized_bls12_381`, replicating the `MAP_FP_TO_G1` pipeline (SWU map + 11-isogeny + cofactor clearing).

**References:** EIP-196, EIP-197 (BN254 predecessors).
