"""
Cryptographic parity tests — Python vs RFC 9380 vs Solidity.

Mirrors the Solidity test structure:
  - sol/test/ExpandMsgXmd.t.sol  → test_expand_*
  - sol/test/HashToField.t.sol   → test_hash_to_field_*
  - sol/test/HashToCurve.t.sol   → test_hash_to_curve_*

Test vectors come from RFC 9380 section 10:
  https://datatracker.ietf.org/doc/html/rfc9380#section-10

Cross-library verification: chia_rs (blst) vs py_ecc for hash-to-G2.
"""

import hashlib

from chia_rs import AugSchemeMPL
from py_ecc.bls.g2_primitives import signature_to_G2
from py_ecc.bls.hash_to_curve import hash_to_G2 as py_ecc_hash_to_G2
from py_ecc.optimized_bls12_381 import eq, normalize

from bls12_381_crypto import (
    CURVE_ORDER,
    FIELD_MODULUS,
    G1_GEN,
    H2C_DST,
    Scalar,
    abi_encode_g1,
    g1_scalar_mul,
    g2_scalar_mul,
    hash_to_g2,
    serialize_g2_sol,
    verify_mint_pairing,
)
from nozk_library import derive_token_secrets

# ==============================================================================
# expand_message_xmd — RFC 9380 section 5.3.1
# (matches sol/test/ExpandMsgXmd.t.sol)
# ==============================================================================

# Reference implementation for comparison
_EXPAND_DST = b"QUUX-V01-CS02-with-expander-SHA256-128"


def _expand_message_xmd(msg: bytes, dst: bytes, len_in_bytes: int) -> bytes:
    """Pure-Python reference implementation of RFC 9380 expand_message_xmd."""
    b_in_bytes = 32  # SHA-256 output
    ell = (len_in_bytes + b_in_bytes - 1) // b_in_bytes
    dst_prime = dst + bytes([len(dst)])
    z_pad = b"\x00" * 64
    msg_prime = z_pad + msg + len_in_bytes.to_bytes(2, "big") + b"\x00" + dst_prime
    b_0 = hashlib.sha256(msg_prime).digest()
    b_prev = hashlib.sha256(b_0 + b"\x01" + dst_prime).digest()
    uniform = b_prev
    for i in range(2, ell + 1):
        xored = bytes(a ^ b for a, b in zip(b_0, b_prev))
        b_prev = hashlib.sha256(xored + bytes([i]) + dst_prime).digest()
        uniform += b_prev
    return uniform[:len_in_bytes]


class TestExpandMsgXmd:
    """RFC 9380 section 10.1 — expand_message_xmd(SHA-256) test vectors."""

    def test_empty_msg_32bytes(self):
        result = _expand_message_xmd(b"", _EXPAND_DST, 32)
        assert result == bytes.fromhex("68a985b87eb6b46952128911f2a4412bbc302a9d759667f87f7a21d803f07235")

    def test_abc_32bytes(self):
        result = _expand_message_xmd(b"abc", _EXPAND_DST, 32)
        assert result == bytes.fromhex("d8ccab23b5985ccea865c6c97b6e5b8350e794e603b4b97902f53a8a0d605615")

    def test_abcdef0123456789_32bytes(self):
        result = _expand_message_xmd(b"abcdef0123456789", _EXPAND_DST, 32)
        assert result == bytes.fromhex("eff31487c770a893cfb36f912fbfcbff40d5661771ca4b2cb4eafe524333f5c1")

    def test_q128_32bytes(self):
        """RFC 9380 vector: q128 message (133 bytes), 32-byte output.

        Note: 'q128' is a label, not the byte length. The actual message is
        'q128_' followed by 128 'q' characters = 133 bytes total.
        """
        msg = b"q128_" + b"q" * 128  # noqa: E501 — exact RFC test input: 133 bytes
        result = _expand_message_xmd(msg, _EXPAND_DST, 32)
        expected = bytes.fromhex("b23a1d2b4d97b2ef7785562a7e8bac7eed54ed6e97e29aa51bfe3f12ddad1ff9")
        assert result == expected, "RFC 9380 expand_xmd q128/32 mismatch"

    def test_a512_32bytes(self):
        """RFC 9380 vector: a512 message (517 bytes), 32-byte output.

        Note: 'a512' is a label, not the byte length. The actual message is
        'a512_' followed by 512 'a' characters = 517 bytes total.
        """
        msg = b"a512_" + b"a" * 512  # exact RFC test input: 517 bytes
        result = _expand_message_xmd(msg, _EXPAND_DST, 32)
        expected = bytes.fromhex("4623227bcc01293b8c130bf771da8c298dede7383243dc0993d2d94823958c4c")
        assert result == expected, "RFC 9380 expand_xmd a512/32 mismatch"

    def test_empty_msg_128bytes(self):
        result = _expand_message_xmd(b"", _EXPAND_DST, 128)
        expected = bytes.fromhex(
            "af84c27ccfd45d41914fdff5df25293e221afc53d8ad2ac06d5e3e29485dadbe"
            "e0d121587713a3e0dd4d5e69e93eb7cd4f5df4cd103e188cf60cb02edc3edf18"
            "eda8576c412b18ffb658e3dd6ec849469b979d444cf7b26911a08e63cf31f9dc"
            "c541708d3491184472c2c29bb749d4286b004ceb5ee6b9a7fa5b646c993f0ced"
        )
        assert result == expected

    def test_abc_128bytes(self):
        result = _expand_message_xmd(b"abc", _EXPAND_DST, 128)
        expected = bytes.fromhex(
            "abba86a6129e366fc877aab32fc4ffc70120d8996c88aee2fe4b32d6c7b6437a"
            "647e6c3163d40b76a73cf6a5674ef1d890f95b664ee0afa5359a5c4e07985635"
            "bbecbac65d747d3d2da7ec2b8221b17b0ca9dc8a1ac1c07ea6a1e60583e2cb00"
            "058e77b7b72a298425cd1b941ad4ec65e8afc50303a22c0f99b0509b4c895f40"
        )
        assert result == expected


# ==============================================================================
# hash_to_field — RFC 9380 section 5.2
# (matches sol/test/HashToField.t.sol)
# ==============================================================================

_G2_HASH_DST = b"QUUX-V01-CS02-with-BLS12381G2_XMD:SHA-256_SSWU_RO_"


def _hash_to_field_fp2(msg: bytes, dst: bytes) -> list[tuple[int, int]]:
    """Compute hash_to_field for Fp2 (count=2, m=2) per RFC 9380 section 5.2."""
    uniform = _expand_message_xmd(msg, dst, 256)
    p = FIELD_MODULUS
    elements = []
    for i in range(4):
        chunk = uniform[i * 64 : (i + 1) * 64]
        elements.append(int.from_bytes(chunk, "big") % p)
    return [(elements[0], elements[1]), (elements[2], elements[3])]


class TestHashToField:
    """RFC 9380 section 10.4 — BLS12381G2_XMD:SHA-256_SSWU_RO_ hash_to_field vectors."""

    def test_empty_msg(self):
        u = _hash_to_field_fp2(b"", _G2_HASH_DST)
        # u[0][0] from RFC 9380
        assert (
            u[0][0]
            == 0x03DBC2CCE174E91BA93CBB08F26B917F98194A2EA08D1CCE75B2B9CC9F21689D80BD79B594A613D0A68EB807DFDC1CF8
        )  # noqa: E501
        # u[0][1]
        assert (
            u[0][1]
            == 0x05A2ACEC64114845711A54199EA339ABD125BA38253B70A92C876DF10598BD1986B739CAD67961EB94F7076511B3B39A
        )  # noqa: E501
        # u[1][0]
        assert (
            u[1][0]
            == 0x02F99798E8A5ACDEED60D7E18E9120521BA1F47EC090984662846BC825DE191B5B7641148C0DBC237726A334473EEE94
        )  # noqa: E501
        # u[1][1]
        assert (
            u[1][1]
            == 0x145A81E418D4010CC027A68F14391B30074E89E60EE7A22F87217B2F6EB0C4B94C9115B436E6FA4607E95A98DE30A435
        )  # noqa: E501


# ==============================================================================
# hash_to_curve — RFC 9380 full pipeline
# (matches sol/test/HashToCurve.t.sol)
# ==============================================================================


class TestHashToCurve:
    """RFC 9380 section 10.4 — full hash_to_curve_G2 + cross-library parity."""

    def test_rfc9380_empty_msg(self):
        """hash_to_curve_G2 for empty message with RFC test DST."""
        P = py_ecc_hash_to_G2(b"", _G2_HASH_DST, hashlib.sha256)
        norm = normalize(P)
        x_c0 = int(norm[0].coeffs[0])
        # Expected from RFC 9380 appendix J.10.1
        assert (
            x_c0 == 0x0141EBFBDCA40EB85B87142E130AB689C673CF60F1A3E98D69335266F30D9B8D4AC44C1038E9DCDD5393FAF5C41FB78A
        )  # noqa: E501

    def test_rfc9380_abc(self):
        """hash_to_curve_G2 for 'abc' with RFC test DST."""
        P = py_ecc_hash_to_G2(b"abc", _G2_HASH_DST, hashlib.sha256)
        norm = normalize(P)
        x_c0 = int(norm[0].coeffs[0])
        assert (
            x_c0 == 0x02C2D18E033B960562AAE3CAB37A27CE00D80CCD5BA4B7FE0E7A210245129DBEC7780CCC7954725F4168AFF2787776E6
        )  # noqa: E501

    def test_chia_rs_matches_py_ecc(self):
        """AugSchemeMPL.g2_from_message() matches py_ecc hash_to_G2 for AUG DST."""
        msg = b"cross-library parity test"
        # py_ecc
        py_result = py_ecc_hash_to_G2(msg, H2C_DST, hashlib.sha256)
        # chia_rs
        chia_g2 = AugSchemeMPL.g2_from_message(msg)
        chia_result = signature_to_G2(chia_g2.to_bytes())
        assert eq(py_result, chia_result), "py_ecc and chia_rs hash_to_G2 must match"

    def test_hash_to_g2_matches_py_ecc(self):
        """Our hash_to_g2() wrapper matches raw py_ecc call."""
        msg = b"wrapper consistency"
        our_result = hash_to_g2(msg)
        raw_result = py_ecc_hash_to_G2(msg, H2C_DST, hashlib.sha256)
        assert eq(our_result, raw_result)

    def test_hash_to_g2_reveal_matches_solidity(self):
        """hash_to_g2 for reveal message matches Solidity test vector.

        This is the same input used in sol/test/HashToCurve.t.sol::test_hashToG2_reveal_message.
        """
        # abi.encode(spendPub_G1) — 128 bytes
        spend_pub = bytes.fromhex(
            "00000000000000000000000000000000092d1175d20d73a88173bac37af89c7b"
            "3f82e4a50a75308b5091cc2ef5b6e6a36edb1d202eea559c0a87f4a0fbb1f973"
            "00000000000000000000000000000000066a676d8b1245010e5e8501679c8443"
            "a7f8e6d01e5749a35a61a0bb0a7c15b45bc9a09d18a509635716921dec975289"
        )
        Y = hash_to_g2(spend_pub)
        coords = serialize_g2_sol(Y)
        # Expected from Solidity test
        assert coords[0] == 0x000000000000000000000000000000000188A060D71CAD5A4F2C5A40A812ABC3

    def test_hash_to_g2_redeem_matches_solidity(self):
        """hash_to_g2 for augmented message matches Solidity test vector.

        This is the same input used in sol/test/HashToCurve.t.sol::test_hashToG2_augMessage.
        """
        aug_msg = bytes.fromhex(
            "892d1175d20d73a88173bac37af89c7b3f82e4a50a75308b5091cc2ef5b6e6a3"
            "6edb1d202eea559c0a87f4a0fbb1f973"
            "0000000000000000000000000000000000000000000000000000000000000000"
        )
        Y = hash_to_g2(aug_msg)
        coords = serialize_g2_sol(Y)
        assert coords[0] == 0x00000000000000000000000000000000107580DBB90C030656FEE43B54764906
        assert coords[1] == 0xE608A26514C18FC0CD65DD813C37DCFDD37B44EA82018AF718C78D11230D2040


# ==============================================================================
# Blind signature protocol — end-to-end correctness
# ==============================================================================


class TestBlindSignatureProtocol:
    """Verify the full blind signature protocol is internally consistent."""

    def test_blind_sign_verify_roundtrip(self):
        """derive → blind → mint_sign → unblind → verify_pairing."""
        sk = Scalar(42)
        pk = g1_scalar_mul(G1_GEN, sk)
        r = 12345

        Y = hash_to_g2(abi_encode_g1(pk))
        B = g2_scalar_mul(Y, Scalar(r))
        S_prime = g2_scalar_mul(B, sk)
        r_inv = pow(r, -1, CURVE_ORDER)
        S = g2_scalar_mul(S_prime, Scalar(r_inv))

        assert verify_mint_pairing(S, Y, pk)

    def test_wrong_mint_key_rejects(self):
        """Pairing must fail with a different mint key."""
        sk = Scalar(42)
        pk = g1_scalar_mul(G1_GEN, sk)
        wrong_pk = g1_scalar_mul(G1_GEN, Scalar(99))
        r = 12345

        Y = hash_to_g2(abi_encode_g1(pk))
        B = g2_scalar_mul(Y, Scalar(r))
        S_prime = g2_scalar_mul(B, sk)
        r_inv = pow(r, -1, CURVE_ORDER)
        S = g2_scalar_mul(S_prime, Scalar(r_inv))

        assert not verify_mint_pairing(S, Y, wrong_pk)

    def test_different_messages_produce_different_points(self):
        """hash_to_g2 must be collision-resistant."""
        Y1 = hash_to_g2(b"message_a")
        Y2 = hash_to_g2(b"message_b")
        assert not eq(Y1, Y2)

    def test_blind_with_r_equals_1(self):
        """r=1 means B=Y (trivial blinding). Protocol still works."""
        sk = Scalar(7)
        pk = g1_scalar_mul(G1_GEN, sk)
        r = 1

        Y = hash_to_g2(abi_encode_g1(pk))
        B = g2_scalar_mul(Y, Scalar(r))
        assert eq(B, Y), "r=1 should give B=Y"

        S_prime = g2_scalar_mul(B, sk)
        r_inv = pow(r, -1, CURVE_ORDER)
        S = g2_scalar_mul(S_prime, Scalar(r_inv))
        assert verify_mint_pairing(S, Y, pk)

    def test_blind_with_large_r(self):
        """r near CURVE_ORDER-1 (edge case for modular inverse)."""
        sk = Scalar(42)
        pk = g1_scalar_mul(G1_GEN, sk)
        r = CURVE_ORDER - 2  # large r

        Y = hash_to_g2(abi_encode_g1(pk))
        B = g2_scalar_mul(Y, Scalar(r))
        S_prime = g2_scalar_mul(B, sk)
        r_inv = pow(r, -1, CURVE_ORDER)
        S = g2_scalar_mul(S_prime, Scalar(r_inv))
        assert verify_mint_pairing(S, Y, pk)

    def test_unblind_inverse_algebraic(self):
        """Verify S = sk * Y algebraically: unblinding recovers the raw signature."""
        from py_ecc.optimized_bls12_381 import eq as pt_eq

        sk = Scalar(13)
        pk = g1_scalar_mul(G1_GEN, sk)
        Y = hash_to_g2(abi_encode_g1(pk))

        # Direct: S_expected = sk * Y
        S_expected = g2_scalar_mul(Y, sk)

        # Via blinding: B = r*Y, S' = sk*B = sk*r*Y, S = S' * r^{-1} = sk*Y
        r = 9999
        B = g2_scalar_mul(Y, Scalar(r))
        S_prime = g2_scalar_mul(B, sk)
        S = g2_scalar_mul(S_prime, Scalar(pow(r, -1, CURVE_ORDER)))

        assert pt_eq(S, S_expected), "Blinding roundtrip must recover sk*Y"

    def test_nullifier_id_deterministic(self):
        """Same spend_pub always produces the same nullifier_id."""
        from eth_utils import keccak

        secrets1 = derive_token_secrets(b"det_seed", 5)
        secrets2 = derive_token_secrets(b"det_seed", 5)

        nid1 = keccak(abi_encode_g1(secrets1.spend_bls_pub))
        nid2 = keccak(abi_encode_g1(secrets2.spend_bls_pub))
        assert nid1 == nid2
        assert nid1 == secrets1.nullifier_id

    def test_different_indices_different_nullifiers(self):
        """Different token indices must produce different nullifiers."""
        s0 = derive_token_secrets(b"idx_seed", 0)
        s1 = derive_token_secrets(b"idx_seed", 1)
        assert s0.nullifier_id != s1.nullifier_id
        assert not eq(s0.spend_bls_pub, s1.spend_bls_pub)

    def test_aggregate_reveal_matches_individual(self):
        """Aggregated reveal verification matches individual checks."""
        from bls12_381_crypto import aggregate_g2

        sk = Scalar(42)
        pk = g1_scalar_mul(G1_GEN, sk)

        # 3 independent tokens
        ys = []
        ss = []
        for i in range(3):
            secrets = derive_token_secrets(b"agg_seed", i)
            Y = hash_to_g2(abi_encode_g1(secrets.spend_bls_pub))
            S = g2_scalar_mul(Y, sk)
            ys.append(Y)
            ss.append(S)

            # Individual verification must pass
            assert verify_mint_pairing(S, Y, pk), f"Individual verify failed for {i}"

        # Aggregate: sigma_agg = sum(S_i), Y_agg = sum(Y_i)
        sigma_agg = aggregate_g2(ss)
        y_agg = aggregate_g2(ys)
        assert verify_mint_pairing(sigma_agg, y_agg, pk), "Aggregated verify failed"
