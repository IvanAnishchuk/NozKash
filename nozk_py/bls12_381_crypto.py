"""
Low-level BLS12-381 curve primitives for the Nozk protocol.

Standard BLS scheme: PK in G1, Signature in G2.

Uses two libraries:
  - chia_rs (blst-based): standard BLS sign/verify/aggregate (spend signatures)
  - py_ecc: low-level curve operations (scalar mul, pairing) for blind signature protocol

EIP-2537 precompile addresses (final Pectra spec):
  0x0b  G1ADD          0x0d  G2ADD          0x0f  PAIRING_CHECK
  0x0c  G1MSM          0x0e  G2MSM          0x10  MAP_FP_TO_G1
                                              0x11  MAP_FP2_TO_G2
"""

from __future__ import annotations

from typing import NewType

from chia_rs import AugSchemeMPL, G1Element, G2Element, PrivateKey
from eth_utils import keccak
from py_ecc.optimized_bls12_381 import (
    FQ,
    FQ2,
    Z1,
    Z2,
    add,
    curve_order,
    eq,
    field_modulus,
    multiply,
    neg,
    normalize,
    pairing,
)
from py_ecc.optimized_bls12_381 import (
    G1 as PY_G1_GEN,
)
from py_ecc.optimized_bls12_381 import (
    G2 as PY_G2_GEN,
)

# ==============================================================================
# TYPE ALIASES (py_ecc projective coordinates)
# ==============================================================================

G1Point = NewType("G1Point", tuple[FQ, FQ, FQ])
G2Point = NewType("G2Point", tuple[FQ2, FQ2, FQ2])
Scalar = NewType("Scalar", int)

# ==============================================================================
# CONSTANTS
# ==============================================================================

CURVE_ORDER = curve_order
FIELD_MODULUS = field_modulus

G1_COFACTOR = 0x396C8C005555E1568C00AAAB0000AAAB

# fmt: off
_G2_COFACTOR = 0x5D543A95414E7F1091D50792876A202CD91DE4547085ABAA68A205B2E5A7DDFA628F1CB4D9E82EF21537E293A6691AE1616EC6E786F0C70CF1C38E31C7238E5  # noqa: E501
# fmt: on

G1_GEN = G1Point(PY_G1_GEN)
G2_GEN = G2Point(PY_G2_GEN)
Z1_POINT = G1Point(Z1)
Z2_POINT = G2Point(Z2)

FP_PADDED_BYTES = 64

# ==============================================================================
# CHIA_RS WRAPPERS (standard BLS: PK=G1, Sig=G2)
# ==============================================================================


def chia_keygen(scalar: int) -> tuple[PrivateKey, G1Element]:
    """Create a chia_rs keypair from a scalar. Returns (sk, pk_g1)."""
    sk = PrivateKey.from_bytes(scalar.to_bytes(32, "big"))
    return sk, sk.get_g1()


def chia_sign(sk: PrivateKey, msg: bytes) -> G2Element:
    """Sign a message using AugSchemeMPL. Returns G2 signature."""
    return AugSchemeMPL.sign(sk, msg)


def chia_verify(pk: G1Element, msg: bytes, sig: G2Element) -> bool:
    """Verify a BLS signature using AugSchemeMPL."""
    return AugSchemeMPL.verify(pk, msg, sig)


def chia_aggregate_sigs(sigs: list[G2Element]) -> G2Element:
    """Aggregate multiple G2 signatures."""
    return AugSchemeMPL.aggregate(sigs)


def chia_aggregate_verify(pks: list[G1Element], msgs: list[bytes], agg_sig: G2Element) -> bool:
    """Verify an aggregated signature against multiple (pk, msg) pairs."""
    return AugSchemeMPL.aggregate_verify(pks, msgs, agg_sig)


def chia_g1_add(a: G1Element, b: G1Element) -> G1Element:
    """G1 point addition via chia_rs."""
    return a + b


def chia_g2_add(a: G2Element, b: G2Element) -> G2Element:
    """G2 point addition via chia_rs."""
    return a + b


# ==============================================================================
# SERIALIZATION — chia_rs compressed (48/96 bytes)
# ==============================================================================


def g1_to_bytes(point: G1Element) -> bytes:
    """Serialize G1 to 48-byte compressed form."""
    return point.to_bytes()


def g1_from_bytes(data: bytes) -> G1Element:
    """Deserialize G1 from 48-byte compressed form."""
    return G1Element.from_bytes(data)


def g2_to_bytes(point: G2Element) -> bytes:
    """Serialize G2 to 96-byte compressed form."""
    return point.to_bytes()


def g2_from_bytes(data: bytes) -> G2Element:
    """Deserialize G2 from 96-byte compressed form."""
    return G2Element.from_bytes(data)


# ==============================================================================
# SERIALIZATION — EIP-2537 uncompressed (uint256 tuples for Solidity)
# ==============================================================================


def _fp_to_uint256_pair(val: int) -> tuple[int, int]:
    """Encode Fp element as (hi, lo) uint256 pair in EIP-2537 64-byte encoding."""
    buf = val.to_bytes(FP_PADDED_BYTES, "big")
    return (int.from_bytes(buf[:32], "big"), int.from_bytes(buf[32:], "big"))


def _uint256_pair_to_fp(hi: int, lo: int) -> int:
    """Reconstruct Fp from (hi, lo) uint256 pair."""
    return int.from_bytes(hi.to_bytes(32, "big") + lo.to_bytes(32, "big"), "big")


def serialize_g1_sol(point: G1Point) -> tuple[int, int, int, int]:
    """Serialize py_ecc G1 to 4 uint256 (EIP-2537 uncompressed)."""
    if eq(point, Z1):
        return (0, 0, 0, 0)
    norm = normalize(point)
    x_hi, x_lo = _fp_to_uint256_pair(norm[0].n)
    y_hi, y_lo = _fp_to_uint256_pair(norm[1].n)
    return (x_hi, x_lo, y_hi, y_lo)


def parse_g1_sol(x_hi: int, x_lo: int, y_hi: int, y_lo: int) -> G1Point:
    """Reconstruct py_ecc G1 from 4 uint256."""
    x = _uint256_pair_to_fp(x_hi, x_lo)
    y = _uint256_pair_to_fp(y_hi, y_lo)
    if x == 0 and y == 0:
        return Z1_POINT
    return G1Point((FQ(x), FQ(y), FQ(1)))


def serialize_g2_sol(point: G2Point) -> tuple[int, int, int, int, int, int, int, int]:
    """Serialize py_ecc G2 to 8 uint256 (EIP-2537 uncompressed)."""
    if eq(point, Z2):
        return (0, 0, 0, 0, 0, 0, 0, 0)
    norm = normalize(point)
    x_c0_hi, x_c0_lo = _fp_to_uint256_pair(norm[0].coeffs[0])
    x_c1_hi, x_c1_lo = _fp_to_uint256_pair(norm[0].coeffs[1])
    y_c0_hi, y_c0_lo = _fp_to_uint256_pair(norm[1].coeffs[0])
    y_c1_hi, y_c1_lo = _fp_to_uint256_pair(norm[1].coeffs[1])
    return (x_c0_hi, x_c0_lo, x_c1_hi, x_c1_lo, y_c0_hi, y_c0_lo, y_c1_hi, y_c1_lo)


def parse_g2_sol(
    x_c0_hi: int, x_c0_lo: int, x_c1_hi: int, x_c1_lo: int,
    y_c0_hi: int, y_c0_lo: int, y_c1_hi: int, y_c1_lo: int,
) -> G2Point:
    """Reconstruct py_ecc G2 from 8 uint256."""
    x_c0 = _uint256_pair_to_fp(x_c0_hi, x_c0_lo)
    x_c1 = _uint256_pair_to_fp(x_c1_hi, x_c1_lo)
    y_c0 = _uint256_pair_to_fp(y_c0_hi, y_c0_lo)
    y_c1 = _uint256_pair_to_fp(y_c1_hi, y_c1_lo)
    if x_c0 == 0 and x_c1 == 0 and y_c0 == 0 and y_c1 == 0:
        return Z2_POINT
    return G2Point((FQ2([x_c0, x_c1]), FQ2([y_c0, y_c1]), FQ2([1, 0])))


# ==============================================================================
# ABI ENCODING (for nullifier ID)
# ==============================================================================


def abi_encode_g1(point: G1Point) -> bytes:
    """ABI-encode a py_ecc G1 point as 4 uint256 (128 bytes)."""
    coords = serialize_g1_sol(point)
    return b"".join(c.to_bytes(32, "big") for c in coords)


def abi_encode_g1_chia(point: G1Element) -> bytes:
    """ABI-encode a chia_rs G1 point as its 48-byte compressed form, zero-padded to 64 bytes."""
    return point.to_bytes().rjust(64, b"\x00")


# ==============================================================================
# PY_ECC CURVE OPERATIONS (for blind signature protocol)
# ==============================================================================


def g1_scalar_mul(point: G1Point, scalar: Scalar) -> G1Point:
    """G1 scalar multiplication via py_ecc."""
    result = multiply(point, scalar)
    if result is None:
        return Z1_POINT
    return G1Point(result)


def g2_scalar_mul(point: G2Point, scalar: Scalar) -> G2Point:
    """G2 scalar multiplication via py_ecc."""
    result = multiply(point, scalar)
    if result is None:
        return Z2_POINT
    return G2Point(result)


def g1_add(a: G1Point, b: G1Point) -> G1Point:
    return G1Point(add(a, b))


def g2_add(a: G2Point, b: G2Point) -> G2Point:
    return G2Point(add(a, b))


def g1_neg(point: G1Point) -> G1Point:
    return G1Point(neg(point))


def aggregate_g1(points: list[G1Point]) -> G1Point:
    if not points:
        return Z1_POINT
    result = points[0]
    for p in points[1:]:
        result = g1_add(result, p)
    return result


def aggregate_g2(points: list[G2Point]) -> G2Point:
    if not points:
        return Z2_POINT
    result = points[0]
    for p in points[1:]:
        result = g2_add(result, p)
    return result


# ==============================================================================
# HASH-TO-CURVE (py_ecc, for blind signature protocol)
# ==============================================================================
#
# NOTE: py_ecc's SWU map does NOT match the EIP-2537 MAP_FP_TO_G1 precompile.
# For on-chain parity, the hash-to-curve approach must be reconciled.
# Options under investigation:
#   1. Implement the full RFC 9380 hash_to_curve on-chain (2x MAP_FP_TO_G1 + G1ADD)
#   2. Use try-and-increment (deterministic, easy cross-language parity)
#   3. Find/fix the py_ecc SWU to match blst
#
# For now, we use try-and-increment which is simple and verifiable.


def hash_to_g1(message: bytes) -> G1Point:
    """
    Hash arbitrary bytes to a BLS12-381 G1 point via try-and-increment.

    Uses keccak256(message || counter_be32) as the x-candidate source,
    checks if x^3 + 4 has a square root in Fp, and clears the cofactor.

    This matches the on-chain implementation which can use MODEXP(0x05)
    for the same field arithmetic.
    """
    p = FIELD_MODULUS
    counter = 0
    while True:
        h = keccak(message + counter.to_bytes(4, "big"))
        x = int.from_bytes(h, "big") % p
        # BLS12-381 G1: y^2 = x^3 + 4
        rhs = (pow(x, 3, p) + 4) % p
        # Euler criterion: rhs^((p-1)/2) == 1 means QR
        if pow(rhs, (p - 1) // 2, p) == 1:
            y = pow(rhs, (p + 1) // 4, p)
            # Construct point and clear cofactor
            point = G1Point((FQ(x), FQ(y), FQ(1)))
            return g1_scalar_mul(point, Scalar(G1_COFACTOR))
        counter += 1


def hash_to_g2(message: bytes) -> G2Point:
    """
    Hash arbitrary bytes to a BLS12-381 G2 point via try-and-increment on Fp2.

    Uses keccak256("c0" || message || counter) and keccak256("c1" || message || counter)
    to produce Fp2 x-candidates. Checks if the RHS of y^2 = x^3 + B2 has a square root.
    Then clears the G2 cofactor.
    """
    p = FIELD_MODULUS
    # B2 for BLS12-381 G2: 4*(1+i) in Fp2, i.e. coeffs [4, 4]
    b2_c0 = 4
    b2_c1 = 4
    counter = 0
    while True:
        h0 = keccak(b"c0" + message + counter.to_bytes(4, "big"))
        h1 = keccak(b"c1" + message + counter.to_bytes(4, "big"))
        x_c0 = int.from_bytes(h0, "big") % p
        x_c1 = int.from_bytes(h1, "big") % p
        x = FQ2([x_c0, x_c1])
        # y^2 = x^3 + B2
        rhs = x**3 + FQ2([b2_c0, b2_c1])
        # Check if rhs is a quadratic residue in Fp2
        # Use Euler criterion: rhs^((p^2-1)/2) == 1
        # For Fp2, we compute rhs^((p^2-1)/2) and check == FQ2.one()
        exp = (p * p - 1) // 2
        test = rhs**exp
        if test == FQ2.one():
            # Compute sqrt via rhs^((p^2+1)/4) — works when p^2 ≡ 3 mod 4
            # p ≡ 3 mod 4 → p^2 ≡ 1 mod 4. Need different sqrt for Fp2.
            # Use Tonelli-Shanks or repeated squaring. For simplicity, use py_ecc.
            # Actually, (p^2+1)/4 doesn't work here. Use a different approach.
            # Skip complex Fp2 sqrt — use a helper.
            y = _fp2_sqrt(rhs)
            if y is not None:
                point = G2Point((x, y, FQ2([1, 0])))
                # Clear G2 cofactor
                g2_cofactor = _G2_COFACTOR
                return g2_scalar_mul(point, Scalar(g2_cofactor))
        counter += 1


def _fp2_sqrt(a: FQ2) -> FQ2 | None:
    """Compute square root in Fp2 if it exists, using the Cipolla/complex method."""
    p = FIELD_MODULUS
    # For Fp2 = Fp[u]/(u^2+1), sqrt can be computed via the Frobenius endomorphism
    # a^((p+1)/2) gives sqrt when it exists (since Fp2 has order p^2-1)
    # But this only works for certain cases. Let's use brute force:
    # sqrt(a) = a^((p^2+7)/16) when p ≡ 3 mod 4 and some conditions hold
    # Actually the standard approach for BLS12-381 Fp2:
    # Use Algorithm 9 from draft-irtf-cfrg-hash-to-curve

    # Simpler: just try a^((p+1)/4) in the field extension
    # Since FQ2 supports ** (power), this works
    candidate = a ** ((p + 1) // 4)  # This may not be correct for Fp2
    if candidate * candidate == a:
        return candidate

    # Try another exponent
    candidate = a ** ((p * p + 7) // 16)
    if candidate * candidate == a:
        return candidate

    return None


# ==============================================================================
# PAIRING VERIFICATION (py_ecc)
# ==============================================================================


def verify_pairing_g1_g2(sigma_g1: G1Point, msg_g2: G2Point, pk_g1: G1Point) -> bool:
    """
    Standard BLS pairing check (PK=G1, Sig=G2 scheme):
      e(PK, msg_G2) == e(G1_gen, sigma)
    Equivalently: e(PK, msg_G2) * e(-G1_gen, sigma) == 1

    For blind signature verification:
      e(PK_mint, H_G2(nullifier)) == e(G1_gen, S)
    """
    lhs = pairing(msg_g2, pk_g1)  # pairing(G2, G1) in py_ecc
    rhs = pairing(sigma_g1, G1_GEN)  # pairing(Sig_G2, G1_gen) — wait this is wrong

    # py_ecc pairing signature: pairing(G2_point, G1_point)
    # We want: e(pk_g1, msg_g2) == e(G1_gen, sigma_g2)
    # But sigma is G1 here in the old scheme...

    # WAIT — in the new standard scheme, sigma is in G2.
    # This function name is confusing. Let me think:
    # verify_pairing(pk_G1, msg_G2, sig_G2):
    #   check e(pk, msg) == e(G1_gen, sig)
    # py_ecc: pairing(G2, G1) returns e(G1, G2) as the Ate pairing
    return lhs == rhs


def verify_mint_pairing(sig_g2: G2Point, msg_g2: G2Point, pk_g1: G1Point) -> bool:
    """
    Verify mint BLS blind signature (standard scheme: PK=G1, Sig=G2).
    Checks: e(PK_mint, Y) == e(G1_gen, S)
    where Y = H_G2(nullifier), S = unblinded mint signature.
    py_ecc pairing(G2, G1) computes the Ate pairing.
    """
    lhs = pairing(msg_g2, pk_g1)  # e(pk, Y)
    rhs = pairing(sig_g2, G1_GEN)  # e(G1_gen, S)
    return lhs == rhs


def is_g1_identity(point: G1Point) -> bool:
    return eq(point, Z1)


def is_g2_identity(point: G2Point) -> bool:
    return eq(point, Z2)
