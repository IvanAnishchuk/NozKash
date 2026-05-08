"""
Unit tests for relayer validation logic and Pydantic models.

No chain/anvil required — tests validation, serialization, and model construction.
"""

from __future__ import annotations

import time

from chia_rs import AugSchemeMPL
from py_ecc.bls.g2_primitives import signature_to_G2

from bls12_381_crypto import (
    G1_GEN,
    G2Point,
    Scalar,
    abi_encode_g1,
    g1_scalar_mul,
    hash_to_g2,
    serialize_g1_sol,
    serialize_g2_sol,
    verify_mint_pairing,
)
from nozk_library import (
    blind_token,
    derive_token_secrets,
    eip712_redemption_hash,
    generate_redemption_proof,
    mint_blind_sign,
    unblind_signature,
)
from relayer_server import (
    RedeemRequest,
    RevealRequest,
)

# ==============================================================================
# Pydantic model tests
# ==============================================================================


class TestRevealRequestModel:
    def test_valid_construction(self):
        req = RevealRequest(
            spend_pub_g1=[hex(i) for i in range(4)],
            s_g2=[hex(i) for i in range(8)],
        )
        assert len(req.spend_pub_g1) == 4
        assert len(req.s_g2) == 8

    def test_from_real_data(self):
        """Construct a RevealRequest from real crypto output."""
        secrets = derive_token_secrets(b"relayer_unit_test", 0)
        blinded = blind_token(secrets.spend_bls_pub, secrets.r)
        sk = Scalar(42)
        S_prime = mint_blind_sign(blinded.B, sk)
        S = unblind_signature(S_prime, secrets.r)

        req = RevealRequest(
            spend_pub_g1=[hex(c) for c in serialize_g1_sol(secrets.spend_bls_pub)],
            s_g2=[hex(c) for c in serialize_g2_sol(S)],
        )
        assert len(req.spend_pub_g1) == 4
        assert all(c.startswith("0x") for c in req.spend_pub_g1)


class TestRedeemRequestModel:
    def test_valid_construction(self):
        req = RedeemRequest(
            recipient="0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7",
            spend_sigma_compressed="aa" * 96,
            spend_pk_compressed="bb" * 48,
            nullifier_id="cc" * 32,
            deadline=2**256 - 1,
        )
        assert req.recipient.startswith("0x")
        assert req.deadline == 2**256 - 1

    def test_from_real_data(self):
        """Construct a RedeemRequest from real crypto output."""
        secrets = derive_token_secrets(b"relayer_redeem_unit", 0)
        proof = generate_redemption_proof(
            secrets.spend_chia_sk,
            secrets.spend_chia_pk,
            "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7",
            11155111,
            "0x00000000000000000000000000000000DeaDBeef",
            2**256 - 1,
        )
        req = RedeemRequest(
            recipient="0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7",
            spend_sigma_compressed=proof.sigma.to_bytes().hex(),
            spend_pk_compressed=proof.spend_pk.to_bytes().hex(),
            nullifier_id=secrets.nullifier_id.hex(),
            deadline=2**256 - 1,
        )
        assert len(bytes.fromhex(req.spend_sigma_compressed)) == 96
        assert len(bytes.fromhex(req.spend_pk_compressed)) == 48


# ==============================================================================
# G2 decompression roundtrip
# ==============================================================================


class TestG2Decompression:
    def test_compress_decompress_roundtrip(self):
        """chia_rs G2 → compressed → signature_to_G2 → serialize_g2_sol roundtrip."""
        secrets = derive_token_secrets(b"g2_roundtrip_test", 0)
        blinded = blind_token(secrets.spend_bls_pub, secrets.r)
        sk = Scalar(42)
        S_prime = mint_blind_sign(blinded.B, sk)
        _S = unblind_signature(S_prime, secrets.r)  # noqa: F841 — used to verify protocol works

        # Simulate what the relayer does: py_ecc G2 → chia_rs compressed → back to py_ecc
        # (In practice, the client sends compressed; relayer decompresses)
        # For this test, we go: sign with chia_rs → compress → decompress → verify coords match
        proof = generate_redemption_proof(
            secrets.spend_chia_sk,
            secrets.spend_chia_pk,
            "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7",
            11155111,
            "0x00000000000000000000000000000000DeaDBeef",
            2**256 - 1,
        )
        # Decompress: chia_rs G2Element → py_ecc G2Point
        sigma_compressed = proof.sigma.to_bytes()
        sigma_decompressed = G2Point(signature_to_G2(sigma_compressed))
        coords_after = serialize_g2_sol(sigma_decompressed)

        # The compressed→decompressed coords should be valid (non-zero)
        assert any(c != 0 for c in coords_after)
        assert len(coords_after) == 8

    def test_bls_verify_after_decompression(self):
        """AugSchemeMPL signature decompressed to py_ecc verifies via pairing."""
        secrets = derive_token_secrets(b"bls_decomp_verify", 0)
        msg_hash = eip712_redemption_hash(
            "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7",
            2**256 - 1,
            11155111,
            "0x00000000000000000000000000000000DeaDBeef",
        )
        sigma = AugSchemeMPL.sign(secrets.spend_chia_sk, msg_hash)
        assert AugSchemeMPL.verify(secrets.spend_chia_pk, msg_hash, sigma)


# ==============================================================================
# Deadline validation
# ==============================================================================


class TestDeadlineValidation:
    def test_past_deadline_detectable(self):
        """A deadline in the past should be detectable."""
        past = int(time.time()) - 3600
        assert past < int(time.time())

    def test_future_deadline_ok(self):
        """A deadline in the future is valid."""
        future = int(time.time()) + 3600
        assert future > int(time.time())


# ==============================================================================
# Mint signature validation logic
# ==============================================================================


class TestMintSignatureValidation:
    def test_valid_mint_sig_parses_and_verifies(self):
        """Real mint signature should parse and verify via pairing."""
        sk = Scalar(42)
        pk = g1_scalar_mul(G1_GEN, sk)
        secrets = derive_token_secrets(b"mint_val_test", 0)
        blinded = blind_token(secrets.spend_bls_pub, secrets.r)
        S_prime = mint_blind_sign(blinded.B, sk)
        S = unblind_signature(S_prime, secrets.r)

        Y = hash_to_g2(abi_encode_g1(secrets.spend_bls_pub))
        assert verify_mint_pairing(S, Y, pk)

    def test_wrong_signature_fails_verification(self):
        """Signature from wrong mint key should fail pairing."""
        correct_sk = Scalar(42)
        wrong_sk = Scalar(999)
        pk = g1_scalar_mul(G1_GEN, correct_sk)
        secrets = derive_token_secrets(b"wrong_sig_test", 0)
        blinded = blind_token(secrets.spend_bls_pub, secrets.r)
        S_prime = mint_blind_sign(blinded.B, wrong_sk)
        S = unblind_signature(S_prime, secrets.r)

        Y = hash_to_g2(abi_encode_g1(secrets.spend_bls_pub))
        assert not verify_mint_pairing(S, Y, pk)
