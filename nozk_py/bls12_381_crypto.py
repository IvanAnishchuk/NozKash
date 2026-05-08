"""
Low-level BLS12-381 curve primitives for the Nozk protocol.

Wraps py_ecc.optimized_bls12_381 and provides:
  - hash_to_g1():      MAP_FP_TO_G1-compatible mapping (SWU + isogeny + cofactor clear)
  - G1/G2 serialization in EIP-2537 encoding (uint256[4] / uint256[8])
  - Point addition, scalar multiplication, pairing verification
"""

from __future__ import annotations

from typing import NewType

from eth_utils import keccak
from py_ecc.optimized_bls12_381 import (
    FQ,
    FQ2,
    G1,
    G2,
    Z1,
    Z2,
    add,
    curve_order,
    eq,
    field_modulus,
    iso_map_G1,
    multiply,
    neg,
    normalize,
    optimized_swu_G1,
    pairing,
)

# ==============================================================================
# TYPE ALIASES
# ==============================================================================

# py_ecc optimized_bls12_381 uses tuple[FQ, FQ, FQ] (Jacobian projective)
G1Point = NewType("G1Point", tuple[FQ, FQ, FQ])
G2Point = NewType("G2Point", tuple[FQ2, FQ2, FQ2])
Scalar = NewType("Scalar", int)

# ==============================================================================
# CONSTANTS
# ==============================================================================

CURVE_ORDER = curve_order  # subgroup order r
FIELD_MODULUS = field_modulus  # Fp modulus p

# G1 cofactor h₁ = (x - 1)² / 3 where x is the BLS parameter
G1_COFACTOR = 0x396C8C005555E1568C00AAAB0000AAAB

# G1 and G2 generators (projective coordinates)
G1_GEN = G1Point(G1)
G2_GEN = G2Point(G2)

# Identity points
Z1_POINT = G1Point(Z1)
Z2_POINT = G2Point(Z2)

# Fp byte length in EIP-2537 encoding: 48 bytes value, zero-padded to 64 bytes
FP_PADDED_BYTES = 64
FP_VALUE_BYTES = 48

# ==============================================================================
# HASH-TO-CURVE (MAP_FP_TO_G1 compatible)
# ==============================================================================


def hash_to_g1(message: bytes) -> G1Point:
    """
    Maps arbitrary bytes to a BLS12-381 G1 point in the prime-order subgroup.

    Replicates the EIP-2537 MAP_FP_TO_G1 precompile (address 0x12) pipeline:
      1. keccak256(message) → 32 bytes
      2. Interpret as Fp element (always < p since 2^256 < p)
      3. Simplified SWU map → isogeny curve point
      4. 11-isogeny map → BLS12-381 G1 point
      5. Cofactor clearing → prime-order subgroup

    The on-chain contract does steps 1-2 then calls the precompile for 3-5.
    """
    h = keccak(message)
    fp_element = FQ(int.from_bytes(h, "big"))
    # Step 3: simplified SWU → projective coords on isogeny curve
    iso_x, iso_y, iso_z = optimized_swu_G1(fp_element)
    # Step 4: 11-isogeny → BLS12-381 G1 (still projective)
    g1_x, g1_y, g1_z = iso_map_G1(iso_x, iso_y, iso_z)
    point = G1Point((g1_x, g1_y, g1_z))
    # Step 5: cofactor clearing → prime-order subgroup
    return g1_scalar_mul(point, Scalar(G1_COFACTOR))


# ==============================================================================
# SERIALIZATION (EIP-2537 encoding)
# ==============================================================================


def _fp_to_uint256_pair(val: int) -> tuple[int, int]:
    """
    Encode an Fp element as two uint256 values matching EIP-2537 64-byte encoding.
    The Fp element (up to 48 bytes) is placed big-endian in a 64-byte buffer,
    then split into high 32 bytes (uint256) and low 32 bytes (uint256).
    """
    buf = val.to_bytes(FP_PADDED_BYTES, "big")
    hi = int.from_bytes(buf[:32], "big")
    lo = int.from_bytes(buf[32:], "big")
    return (hi, lo)


def _uint256_pair_to_fp(hi: int, lo: int) -> int:
    """Reconstruct an Fp element from two uint256 values (EIP-2537 encoding)."""
    buf = hi.to_bytes(32, "big") + lo.to_bytes(32, "big")
    return int.from_bytes(buf, "big")


def serialize_g1(point: G1Point) -> tuple[int, int, int, int]:
    """
    Serialize a G1 point to 4 uint256 values in EIP-2537 encoding.
    Returns (x_hi, x_lo, y_hi, y_lo).
    """
    if eq(point, Z1):
        return (0, 0, 0, 0)
    norm = normalize(point)
    x_hi, x_lo = _fp_to_uint256_pair(norm[0].n)
    y_hi, y_lo = _fp_to_uint256_pair(norm[1].n)
    return (x_hi, x_lo, y_hi, y_lo)


def parse_g1(x_hi: int, x_lo: int, y_hi: int, y_lo: int) -> G1Point:
    """Reconstruct a G1 point from 4 uint256 values (EIP-2537 encoding)."""
    x = _uint256_pair_to_fp(x_hi, x_lo)
    y = _uint256_pair_to_fp(y_hi, y_lo)
    if x == 0 and y == 0:
        return Z1_POINT
    return G1Point((FQ(x), FQ(y), FQ(1)))


def serialize_g2(point: G2Point) -> tuple[int, int, int, int, int, int, int, int]:
    """
    Serialize a G2 point to 8 uint256 values in EIP-2537 encoding.

    G2 coordinates are Fp2 elements (c0 + c1*u). EIP-2537 layout per coordinate:
      c0 (64 bytes) || c1 (64 bytes)
    Full point: x_c0 || x_c1 || y_c0 || y_c1

    Returns (x_c0_hi, x_c0_lo, x_c1_hi, x_c1_lo, y_c0_hi, y_c0_lo, y_c1_hi, y_c1_lo).
    """
    if eq(point, Z2):
        return (0, 0, 0, 0, 0, 0, 0, 0)
    norm = normalize(point)
    x_fq2 = norm[0]  # FQ2
    y_fq2 = norm[1]  # FQ2
    # FQ2 has .coeffs = (c0, c1) where element = c0 + c1*u
    # In optimized_bls12_381, coeffs are plain ints (not FQ objects)
    x_c0_hi, x_c0_lo = _fp_to_uint256_pair(x_fq2.coeffs[0])
    x_c1_hi, x_c1_lo = _fp_to_uint256_pair(x_fq2.coeffs[1])
    y_c0_hi, y_c0_lo = _fp_to_uint256_pair(y_fq2.coeffs[0])
    y_c1_hi, y_c1_lo = _fp_to_uint256_pair(y_fq2.coeffs[1])
    return (x_c0_hi, x_c0_lo, x_c1_hi, x_c1_lo, y_c0_hi, y_c0_lo, y_c1_hi, y_c1_lo)


def parse_g2(
    x_c0_hi: int,
    x_c0_lo: int,
    x_c1_hi: int,
    x_c1_lo: int,
    y_c0_hi: int,
    y_c0_lo: int,
    y_c1_hi: int,
    y_c1_lo: int,
) -> G2Point:
    """Reconstruct a G2 point from 8 uint256 values (EIP-2537 encoding)."""
    x_c0 = _uint256_pair_to_fp(x_c0_hi, x_c0_lo)
    x_c1 = _uint256_pair_to_fp(x_c1_hi, x_c1_lo)
    y_c0 = _uint256_pair_to_fp(y_c0_hi, y_c0_lo)
    y_c1 = _uint256_pair_to_fp(y_c1_hi, y_c1_lo)
    if x_c0 == 0 and x_c1 == 0 and y_c0 == 0 and y_c1 == 0:
        return Z2_POINT
    x = FQ2([x_c0, x_c1])
    y = FQ2([y_c0, y_c1])
    return G2Point((x, y, FQ2([1, 0])))


# ==============================================================================
# ABI ENCODING (for nullifier ID derivation)
# ==============================================================================


def abi_encode_g2(point: G2Point) -> bytes:
    """
    ABI-encode a G2 point as 8 uint256 values (256 bytes).
    Used to compute nullifier_id = keccak256(abi_encode_g2(spend_pub)).
    """
    coords = serialize_g2(point)
    return b"".join(c.to_bytes(32, "big") for c in coords)


# ==============================================================================
# POINT ARITHMETIC
# ==============================================================================


def g1_add(a: G1Point, b: G1Point) -> G1Point:
    """G1 point addition."""
    return G1Point(add(a, b))


def g2_add(a: G2Point, b: G2Point) -> G2Point:
    """G2 point addition."""
    return G2Point(add(a, b))


def g1_scalar_mul(point: G1Point, scalar: Scalar) -> G1Point:
    """G1 scalar multiplication. Returns point at infinity for scalar=0."""
    result = multiply(point, scalar)
    if result is None:
        return Z1_POINT
    return G1Point(result)


def g2_scalar_mul(point: G2Point, scalar: Scalar) -> G2Point:
    """G2 scalar multiplication."""
    result = multiply(point, scalar)
    if result is None:
        return Z2_POINT
    return G2Point(result)


def g1_neg(point: G1Point) -> G1Point:
    """Negate a G1 point."""
    return G1Point(neg(point))


def g2_neg(point: G2Point) -> G2Point:
    """Negate a G2 point."""
    return G2Point(neg(point))


# ==============================================================================
# AGGREGATION
# ==============================================================================


def aggregate_g1(points: list[G1Point]) -> G1Point:
    """Sum a list of G1 points."""
    if not points:
        return Z1_POINT
    result = points[0]
    for p in points[1:]:
        result = g1_add(result, p)
    return result


def aggregate_g2(points: list[G2Point]) -> G2Point:
    """Sum a list of G2 points."""
    if not points:
        return Z2_POINT
    result = points[0]
    for p in points[1:]:
        result = g2_add(result, p)
    return result


# ==============================================================================
# PAIRING VERIFICATION
# ==============================================================================


def verify_pairing(sigma: G1Point, msg_point: G1Point, pk: G2Point) -> bool:
    """
    BLS signature verification via pairing check:
      e(sigma, G2_gen) == e(msg_point, pk)

    Where sigma = sk * msg_point and pk = sk * G2_gen.

    py_ecc pairing signature: pairing(G2_point, G1_point).
    """
    lhs = pairing(G2_GEN, sigma)
    rhs = pairing(pk, msg_point)
    return lhs == rhs


def is_g1_identity(point: G1Point) -> bool:
    """Check if a G1 point is the identity (point at infinity)."""
    return eq(point, Z1)


def is_g2_identity(point: G2Point) -> bool:
    """Check if a G2 point is the identity."""
    return eq(point, Z2)
