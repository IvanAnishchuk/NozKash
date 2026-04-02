"""Unit tests for MockMint (mint_mock.py) and MockRedeemer (redeem_mock.py)."""

import pytest
from py_ecc.bn128 import b, curve_order, is_on_curve

import nozk_library as gl
from mint_mock import MockMint, MockMintError
from redeem_mock import MockRedeemer

# ==============================================================================
# FIXTURES
# ==============================================================================

_TEST_CHAIN_ID = 11155111
_TEST_CONTRACT = "0x00000000000000000000000000000000DeaDBeef"
_TEST_DEADLINE = 2**256 - 1


@pytest.fixture
def mint():
    return MockMint.from_sk(42)


@pytest.fixture
def keypair():
    return gl.generate_mint_keypair()


@pytest.fixture
def lifecycle(keypair):
    """Full lifecycle: derive secrets, blind, sign, unblind, generate proof."""
    seed = b"mock_test_lifecycle_seed"
    secrets = gl.derive_token_secrets(seed, 0)
    blinded = gl.blind_token(secrets.spend_address_bytes, secrets.r)
    S_prime = gl.mint_blind_sign(blinded.B, keypair.sk)
    S = gl.unblind_signature(S_prime, secrets.r)
    sx, sy = gl.serialize_g1(S)
    recipient = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"
    proof = gl.generate_redemption_proof(
        secrets.spend_priv,
        recipient,
        _TEST_CHAIN_ID,
        _TEST_CONTRACT,
        _TEST_DEADLINE,
    )
    # Build 65-byte spend signature
    r_bytes = bytes.fromhex(proof.compact_hex[:64])
    s_bytes = bytes.fromhex(proof.compact_hex[64:])
    v_byte = bytes([proof.recovery_bit + 27])
    sig_65 = r_bytes + s_bytes + v_byte
    return {
        "keypair": keypair,
        "secrets": secrets,
        "recipient": recipient,
        "sig_65": sig_65,
        "sx": sx,
        "sy": sy,
    }


# ==============================================================================
# MockMint CONSTRUCTORS
# ==============================================================================


def test_mock_mint_from_sk_valid():
    m = MockMint.from_sk(42)
    assert m.sk == 42


def test_mock_mint_from_sk_zero_raises():
    with pytest.raises(MockMintError):
        MockMint.from_sk(0)


def test_mock_mint_from_sk_too_large_raises():
    with pytest.raises(MockMintError):
        MockMint.from_sk(curve_order)


def test_mock_mint_from_hex_with_prefix():
    m = MockMint.from_hex("0x2a")
    assert m.sk == 42


def test_mock_mint_from_hex_invalid_raises():
    with pytest.raises(MockMintError):
        MockMint.from_hex("not_hex")


# ==============================================================================
# MockMint SIGNING
# ==============================================================================


def test_mock_mint_sign_returns_on_curve(mint):
    secrets = gl.derive_token_secrets(b"sign_test", 0)
    blinded = gl.blind_token(secrets.spend_address_bytes, secrets.r)
    S_prime = mint.sign(blinded.B)
    assert is_on_curve(S_prime, b)


def test_mock_mint_sign_and_serialize_returns_int_tuple(mint):
    secrets = gl.derive_token_secrets(b"serialize_test", 0)
    blinded = gl.blind_token(secrets.spend_address_bytes, secrets.r)
    sx, sy = mint.sign_and_serialize(blinded.B)
    assert isinstance(sx, int)
    assert isinstance(sy, int)


def test_mock_mint_sign_from_coords(mint):
    secrets = gl.derive_token_secrets(b"coords_test", 0)
    blinded = gl.blind_token(secrets.spend_address_bytes, secrets.r)
    bx, by = gl.serialize_g1(blinded.B)
    sx, sy = mint.sign_from_coords(bx, by)
    assert isinstance(sx, int) and sx > 0
    assert isinstance(sy, int) and sy > 0


# ==============================================================================
# MockRedeemer
# ==============================================================================


def test_redeemer_valid_lifecycle(lifecycle):
    redeemer = MockRedeemer.from_sk(lifecycle["keypair"].sk)
    result = redeemer.redeem(
        lifecycle["recipient"],
        lifecycle["sig_65"],
        lifecycle["sx"],
        lifecycle["sy"],
        chain_id=_TEST_CHAIN_ID,
        contract_address=_TEST_CONTRACT,
        deadline=_TEST_DEADLINE,
    )
    assert result.success is True
    assert result.ecdsa_ok is True
    assert result.bls_pairing_ok is True


def test_redeemer_bad_signature_length(lifecycle):
    redeemer = MockRedeemer.from_sk(lifecycle["keypair"].sk)
    result = redeemer.redeem(
        lifecycle["recipient"],
        b"\x00" * 10,  # wrong length
        lifecycle["sx"],
        lifecycle["sy"],
    )
    assert result.success is False
    assert "65 bytes" in (result.reason or "")


def test_redeemer_invalid_v_byte(lifecycle):
    redeemer = MockRedeemer.from_sk(lifecycle["keypair"].sk)
    bad_sig = lifecycle["sig_65"][:64] + bytes([99])  # invalid v
    result = redeemer.redeem(
        lifecycle["recipient"],
        bad_sig,
        lifecycle["sx"],
        lifecycle["sy"],
        chain_id=_TEST_CHAIN_ID,
        contract_address=_TEST_CONTRACT,
        deadline=_TEST_DEADLINE,
    )
    assert result.success is False
    assert "v byte" in (result.reason or "").lower() or "Invalid" in (result.reason or "")


def test_redeemer_double_spend(lifecycle):
    redeemer = MockRedeemer.from_sk(lifecycle["keypair"].sk)
    r1 = redeemer.redeem(
        lifecycle["recipient"],
        lifecycle["sig_65"],
        lifecycle["sx"],
        lifecycle["sy"],
        chain_id=_TEST_CHAIN_ID,
        contract_address=_TEST_CONTRACT,
        deadline=_TEST_DEADLINE,
    )
    assert r1.success is True

    r2 = redeemer.redeem(
        lifecycle["recipient"],
        lifecycle["sig_65"],
        lifecycle["sx"],
        lifecycle["sy"],
        chain_id=_TEST_CHAIN_ID,
        contract_address=_TEST_CONTRACT,
        deadline=_TEST_DEADLINE,
    )
    assert r2.success is False
    assert r2.nullifier_spent is True


def test_redeemer_wrong_mint_key(lifecycle):
    wrong_kp = gl.generate_mint_keypair()
    redeemer = MockRedeemer.from_sk(wrong_kp.sk)
    result = redeemer.redeem(
        lifecycle["recipient"],
        lifecycle["sig_65"],
        lifecycle["sx"],
        lifecycle["sy"],
        chain_id=_TEST_CHAIN_ID,
        contract_address=_TEST_CONTRACT,
        deadline=_TEST_DEADLINE,
    )
    assert result.success is False
    assert result.bls_pairing_ok is False


def test_redeemer_is_spent_and_reset(lifecycle):
    redeemer = MockRedeemer.from_sk(lifecycle["keypair"].sk)
    result = redeemer.redeem(
        lifecycle["recipient"],
        lifecycle["sig_65"],
        lifecycle["sx"],
        lifecycle["sy"],
        chain_id=_TEST_CHAIN_ID,
        contract_address=_TEST_CONTRACT,
        deadline=_TEST_DEADLINE,
    )
    assert result.success is True
    assert result.nullifier is not None
    assert redeemer.is_spent(result.nullifier)

    redeemer.reset()
    assert not redeemer.is_spent(result.nullifier)
