"""
Low-level BLS12-381 curve primitives for the Nozk protocol.

This module provides the cryptographic building blocks for NozKash's blind
signature protocol and BLS spend signatures on BLS12-381.

Standard BLS scheme: **PK in G1, Signature in G2** (matches Ethereum consensus).

Two libraries are used, each for a distinct purpose:

- **chia_rs** (blst-based): Standard BLS operations — ``AugSchemeMPL.sign``,
  ``verify``, ``aggregate``, ``aggregate_verify``.  Used for spend signatures
  that are verified on-chain.  chia_rs wraps `blst <https://github.com/supranational/blst>`_,
  the reference C implementation used by Ethereum clients and EIP-2537 precompiles.

- **py_ecc**: Low-level curve arithmetic — scalar multiplication, pairing,
  point addition/negation.  Required for the blind signature protocol (blind,
  mint-sign, unblind) which operates on raw curve points rather than standard
  BLS messages.  Also provides ``hash_to_G2`` (RFC 9380) which produces
  identical output to chia_rs (verified) and the EIP-2537 MAP_FP2_TO_G2
  precompile.

Hash-to-curve DST (domain separation tag)::

    BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_

This is the standard AugSchemeMPL DST from the `BLS signature spec
<https://datatracker.ietf.org/doc/draft-irtf-cfrg-bls-signature/>`_.
Both the on-chain Solidity contract (``BLS12HashToCurve.sol``) and this
module use the same DST, ensuring byte-identical hash-to-curve output.

On-chain equivalence (EIP-2537 precompile addresses, final Pectra spec)::

    0x02  SHA-256           0x0b  G1ADD        0x0f  PAIRING_CHECK
    0x05  MODEXP            0x0c  G1MSM        0x10  MAP_FP_TO_G1
                            0x0d  G2ADD        0x11  MAP_FP2_TO_G2
                            0x0e  G2MSM
"""

from __future__ import annotations

import hashlib
from functools import reduce
from typing import NewType

from chia_rs import AugSchemeMPL, G1Element, G2Element, PrivateKey  # noqa: F401 — re-exported for nozk_library
from py_ecc.bls.hash_to_curve import hash_to_G2 as _py_ecc_hash_to_G2
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
from py_ecc.optimized_bls12_381 import G1 as PY_G1_GEN
from py_ecc.optimized_bls12_381 import G2 as PY_G2_GEN

# ==============================================================================
# Type aliases
# ==============================================================================

G1Point = NewType("G1Point", tuple[FQ, FQ, FQ])
"""A point on BLS12-381 G1 in py_ecc projective coordinates ``(X, Y, Z)``."""

G2Point = NewType("G2Point", tuple[FQ2, FQ2, FQ2])
"""A point on BLS12-381 G2 in py_ecc projective coordinates ``(X, Y, Z)``."""

Scalar = NewType("Scalar", int)
"""An integer in ``[0, CURVE_ORDER)`` used as a BLS12-381 scalar."""

# ==============================================================================
# Constants
# ==============================================================================

CURVE_ORDER: int = curve_order
"""BLS12-381 subgroup order *r* (255 bits)."""

FIELD_MODULUS: int = field_modulus
"""BLS12-381 base field modulus *p* (381 bits)."""

G1_GEN: G1Point = G1Point(PY_G1_GEN)
"""Generator of the G1 subgroup."""

G2_GEN: G2Point = G2Point(PY_G2_GEN)
"""Generator of the G2 subgroup."""

Z1_POINT: G1Point = G1Point(Z1)
"""Identity (point at infinity) for G1."""

Z2_POINT: G2Point = G2Point(Z2)
"""Identity (point at infinity) for G2."""

FP_PADDED_BYTES: int = 64
"""EIP-2537 encodes each Fp element as 64 bytes (zero-padded big-endian)."""

#: AugSchemeMPL DST used for both hash-to-G2 and spend signatures.
H2C_DST: bytes = b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_"

# ==============================================================================
# chia_rs wrappers — standard BLS (AugSchemeMPL)
# ==============================================================================


def chia_keygen(scalar: int) -> tuple[PrivateKey, G1Element]:
    """Create a chia_rs BLS keypair from a raw scalar.

    Args:
        scalar: Integer private key in ``[1, CURVE_ORDER)``.

    Returns:
        ``(sk, pk)`` where *sk* is a :class:`PrivateKey` and *pk* is a
        :class:`G1Element` (compressed 48-byte public key).
    """
    sk = PrivateKey.from_bytes(scalar.to_bytes(32, "big"))
    return sk, sk.get_g1()


def chia_sign(sk: PrivateKey, msg: bytes) -> G2Element:
    """Sign *msg* with AugSchemeMPL.  Returns a compressed G2 signature.

    Internally computes ``sigma = sk * H(pk_compressed || msg)`` where *H* is
    the RFC 9380 hash-to-G2 with DST :data:`H2C_DST`.
    """
    return AugSchemeMPL.sign(sk, msg)


def chia_verify(pk: G1Element, msg: bytes, sig: G2Element) -> bool:
    """Verify an AugSchemeMPL signature."""
    return AugSchemeMPL.verify(pk, msg, sig)


def chia_aggregate_sigs(sigs: list[G2Element]) -> G2Element:
    """Aggregate multiple AugSchemeMPL G2 signatures into one."""
    return AugSchemeMPL.aggregate(sigs)


def chia_aggregate_verify(pks: list[G1Element], msgs: list[bytes], agg_sig: G2Element) -> bool:
    """Verify an aggregated AugSchemeMPL signature against ``(pk, msg)`` pairs."""
    return AugSchemeMPL.aggregate_verify(pks, msgs, agg_sig)


# ==============================================================================
# Serialization — chia_rs compressed (48 / 96 bytes)
# ==============================================================================


def g1_to_bytes(point: G1Element) -> bytes:
    """Serialize a chia_rs G1 point to 48-byte BLS compressed form."""
    return point.to_bytes()


def g1_from_bytes(data: bytes) -> G1Element:
    """Deserialize a chia_rs G1 point from 48-byte BLS compressed form."""
    return G1Element.from_bytes(data)


def g2_to_bytes(point: G2Element) -> bytes:
    """Serialize a chia_rs G2 point to 96-byte BLS compressed form."""
    return point.to_bytes()


def g2_from_bytes(data: bytes) -> G2Element:
    """Deserialize a chia_rs G2 point from 96-byte BLS compressed form."""
    return G2Element.from_bytes(data)


# ==============================================================================
# Serialization — EIP-2537 uncompressed (uint256 tuples for Solidity)
# ==============================================================================


def _fp_to_uint256_pair(val: int) -> tuple[int, int]:
    """Encode an Fp element as ``(hi, lo)`` uint256 pair (EIP-2537 64-byte encoding)."""
    buf = val.to_bytes(FP_PADDED_BYTES, "big")
    return (int.from_bytes(buf[:32], "big"), int.from_bytes(buf[32:], "big"))


def _uint256_pair_to_fp(hi: int, lo: int) -> int:
    """Reconstruct an Fp element from ``(hi, lo)`` uint256 pair."""
    return int.from_bytes(hi.to_bytes(32, "big") + lo.to_bytes(32, "big"), "big")


def serialize_g1_sol(point: G1Point) -> tuple[int, int, int, int]:
    """Serialize a py_ecc G1 point to 4 uint256 in EIP-2537 uncompressed format.

    Returns:
        ``(x_hi, x_lo, y_hi, y_lo)`` — each coordinate zero-padded to 64 bytes,
        then split into two 32-byte (uint256) words.
    """
    if eq(point, Z1):
        return (0, 0, 0, 0)
    norm = normalize(point)
    x_hi, x_lo = _fp_to_uint256_pair(norm[0].n)
    y_hi, y_lo = _fp_to_uint256_pair(norm[1].n)
    return (x_hi, x_lo, y_hi, y_lo)


def parse_g1_sol(x_hi: int, x_lo: int, y_hi: int, y_lo: int) -> G1Point:
    """Reconstruct a py_ecc G1 point from 4 uint256 (EIP-2537 uncompressed)."""
    x = _uint256_pair_to_fp(x_hi, x_lo)
    y = _uint256_pair_to_fp(y_hi, y_lo)
    if x == 0 and y == 0:
        return Z1_POINT
    return G1Point((FQ(x), FQ(y), FQ(1)))


def serialize_g2_sol(point: G2Point) -> tuple[int, int, int, int, int, int, int, int]:
    """Serialize a py_ecc G2 point to 8 uint256 in EIP-2537 uncompressed format.

    Returns:
        ``(x_c0_hi, x_c0_lo, x_c1_hi, x_c1_lo, y_c0_hi, y_c0_lo, y_c1_hi, y_c1_lo)``
        where ``c0, c1`` are the Fp2 coefficients (``c0 + c1 * u``).
    """
    if eq(point, Z2):
        return (0, 0, 0, 0, 0, 0, 0, 0)
    norm = normalize(point)
    x_c0_hi, x_c0_lo = _fp_to_uint256_pair(norm[0].coeffs[0])
    x_c1_hi, x_c1_lo = _fp_to_uint256_pair(norm[0].coeffs[1])
    y_c0_hi, y_c0_lo = _fp_to_uint256_pair(norm[1].coeffs[0])
    y_c1_hi, y_c1_lo = _fp_to_uint256_pair(norm[1].coeffs[1])
    return (x_c0_hi, x_c0_lo, x_c1_hi, x_c1_lo, y_c0_hi, y_c0_lo, y_c1_hi, y_c1_lo)


def parse_g2_sol(
    x_c0_hi: int,
    x_c0_lo: int,
    x_c1_hi: int,
    x_c1_lo: int,
    y_c0_hi: int,
    y_c0_lo: int,
    y_c1_hi: int,
    y_c1_lo: int,
) -> G2Point:
    """Reconstruct a py_ecc G2 point from 8 uint256 (EIP-2537 uncompressed)."""
    x_c0 = _uint256_pair_to_fp(x_c0_hi, x_c0_lo)
    x_c1 = _uint256_pair_to_fp(x_c1_hi, x_c1_lo)
    y_c0 = _uint256_pair_to_fp(y_c0_hi, y_c0_lo)
    y_c1 = _uint256_pair_to_fp(y_c1_hi, y_c1_lo)
    if x_c0 == 0 and x_c1 == 0 and y_c0 == 0 and y_c1 == 0:
        return Z2_POINT
    return G2Point((FQ2([x_c0, x_c1]), FQ2([y_c0, y_c1]), FQ2([1, 0])))


# ==============================================================================
# ABI encoding (for nullifier ID computation)
# ==============================================================================


def abi_encode_g1(point: G1Point) -> bytes:
    """ABI-encode a G1 point as ``abi.encode(uint256[4])`` (128 bytes).

    This is the encoding used on-chain for nullifier ID computation:
    ``nullifier_id = keccak256(abi_encode_g1(spend_pub))``.
    """
    coords = serialize_g1_sol(point)
    return b"".join(c.to_bytes(32, "big") for c in coords)


# ==============================================================================
# py_ecc curve operations (for blind signature protocol)
# ==============================================================================


def g1_scalar_mul(point: G1Point, scalar: Scalar) -> G1Point:
    """Multiply a G1 point by a scalar.  Returns ``Z1_POINT`` if the result is the identity."""
    result = multiply(point, scalar)
    if result is None:
        return Z1_POINT
    return G1Point(result)


def g2_scalar_mul(point: G2Point, scalar: Scalar) -> G2Point:
    """Multiply a G2 point by a scalar.  Returns ``Z2_POINT`` if the result is the identity."""
    result = multiply(point, scalar)
    if result is None:
        return Z2_POINT
    return G2Point(result)


def g1_add(a: G1Point, b: G1Point) -> G1Point:
    """Add two G1 points."""
    return G1Point(add(a, b))


def g2_add(a: G2Point, b: G2Point) -> G2Point:
    """Add two G2 points."""
    return G2Point(add(a, b))


def g1_neg(point: G1Point) -> G1Point:
    """Negate a G1 point: ``-P``."""
    return G1Point(neg(point))


def aggregate_g1(points: list[G1Point]) -> G1Point:
    """Sum a list of G1 points.  Returns ``Z1_POINT`` for an empty list."""
    return reduce(g1_add, points, Z1_POINT)


def aggregate_g2(points: list[G2Point]) -> G2Point:
    """Sum a list of G2 points.  Returns ``Z2_POINT`` for an empty list."""
    return reduce(g2_add, points, Z2_POINT)


# ==============================================================================
# Hash-to-curve (RFC 9380)
# ==============================================================================


def hash_to_g2(message: bytes) -> G2Point:
    """Hash arbitrary bytes to a BLS12-381 G2 point per `RFC 9380`_.

    Uses py_ecc's ``hash_to_G2`` which implements the full pipeline:
    ``expand_message_xmd`` (SHA-256) → ``hash_to_field`` → ``map_to_curve``
    (Simplified SWU + 3-isogeny) → cofactor clearing.

    The DST is :data:`H2C_DST` (AugSchemeMPL standard).

    This function produces **byte-identical** output to:

    - ``chia_rs.AugSchemeMPL.g2_from_message(message)`` (verified)
    - The on-chain ``BLS12HashToCurve.hashToCurveG2`` (SHA-256 precompile +
      MAP_FP2_TO_G2, verified via e2e test on anvil)

    Args:
        message: Arbitrary-length byte string to hash.

    Returns:
        A py_ecc G2 point suitable for scalar multiplication and pairing.

    .. _RFC 9380: https://datatracker.ietf.org/doc/rfc9380/
    """
    return G2Point(_py_ecc_hash_to_G2(message, H2C_DST, hashlib.sha256))


# ==============================================================================
# Pairing verification (py_ecc)
# ==============================================================================


def verify_mint_pairing(sig_g2: G2Point, msg_g2: G2Point, pk_g1: G1Point) -> bool:
    """Verify a BLS blind signature using the pairing check.

    Checks the equation::

        e(PK_mint, Y) == e(G1_gen, S)

    where *Y* = ``hash_to_g2(nullifier)`` and *S* is the unblinded mint signature.

    .. note::
        py_ecc's ``pairing(Q, P)`` takes (G2, G1) and computes ``e(P, Q)``.
        So ``pairing(msg_g2, pk_g1)`` computes ``e(pk_g1, msg_g2)`` — correct.
    """
    lhs = pairing(msg_g2, pk_g1)  # e(pk_g1, msg_g2) = e(PK, Y)
    rhs = pairing(sig_g2, G1_GEN)  # e(G1_GEN, sig_g2) = e(G1_gen, S)
    return lhs == rhs


def is_g1_identity(point: G1Point) -> bool:
    """Check whether a G1 point is the identity (point at infinity)."""
    return eq(point, Z1)


def is_g2_identity(point: G2Point) -> bool:
    """Check whether a G2 point is the identity (point at infinity)."""
    return eq(point, Z2)
