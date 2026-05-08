"""Unit tests for MockMint (mint_mock.py) and MockRedeemer (redeem_mock.py).

BLS12-381 standard scheme: PK=G1, Sig=G2.
"""

import pytest

import nozk_library as gl
from bls12_381_crypto import CURVE_ORDER, serialize_g2_sol
from mint_mock import MockMint, MockMintError
from redeem_mock import MockRedeemer, NullifierState

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
    """Full lifecycle: derive secrets, blind, sign, unblind, generate redemption proof."""
    seed = b"mock_test_lifecycle_seed"
    secrets = gl.derive_token_secrets(seed, 0)
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    S_prime = gl.mint_blind_sign(blinded.B, keypair.sk)
    S = gl.unblind_signature(S_prime, secrets.r)
    recipient = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"
    proof = gl.generate_redemption_proof(
        secrets.spend_chia_sk,
        secrets.spend_chia_pk,
        recipient,
        _TEST_CHAIN_ID,
        _TEST_CONTRACT,
        _TEST_DEADLINE,
    )
    return {
        "keypair": keypair,
        "secrets": secrets,
        "blinded": blinded,
        "S": S,
        "recipient": recipient,
        "proof": proof,
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
        MockMint.from_sk(CURVE_ORDER)


def test_mock_mint_from_hex_with_prefix():
    m = MockMint.from_hex("0x2a")
    assert m.sk == 42


def test_mock_mint_from_hex_invalid_raises():
    with pytest.raises(MockMintError):
        MockMint.from_hex("not_hex")


# ==============================================================================
# MockMint SIGNING
# ==============================================================================


def test_mock_mint_sign_returns_g2_point(mint):
    secrets = gl.derive_token_secrets(b"sign_test", 0)
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    S_prime = mint.sign(blinded.B)
    coords = serialize_g2_sol(S_prime)
    assert len(coords) == 8
    assert any(c != 0 for c in coords)


def test_mock_mint_sign_and_serialize_returns_int_tuple(mint):
    secrets = gl.derive_token_secrets(b"serialize_test", 0)
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    coords = mint.sign_and_serialize(blinded.B)
    assert len(coords) == 8
    assert all(isinstance(c, int) for c in coords)


# ==============================================================================
# MockRedeemer — Reveal
# ==============================================================================


def test_reveal_valid_bls(lifecycle):
    redeemer = MockRedeemer.from_sk(lifecycle["keypair"].sk)
    secrets = lifecycle["secrets"]
    result = redeemer.reveal(secrets.spend_bls_pub, lifecycle["S"])
    assert result.success is True
    assert result.bls_pairing_ok is True
    nid = secrets.nullifier_id.hex()
    assert redeemer.get_state(nid) == NullifierState.REVEALED


def test_reveal_already_revealed(lifecycle):
    redeemer = MockRedeemer.from_sk(lifecycle["keypair"].sk)
    secrets = lifecycle["secrets"]
    redeemer.reveal(secrets.spend_bls_pub, lifecycle["S"])
    result = redeemer.reveal(secrets.spend_bls_pub, lifecycle["S"])
    assert result.success is False
    assert "already" in (result.reason or "").lower()


def test_reveal_wrong_mint_key(lifecycle):
    wrong_kp = gl.generate_mint_keypair()
    redeemer = MockRedeemer.from_sk(wrong_kp.sk)
    secrets = lifecycle["secrets"]
    result = redeemer.reveal(secrets.spend_bls_pub, lifecycle["S"])
    assert result.success is False
    assert result.bls_pairing_ok is False


# ==============================================================================
# MockRedeemer — Redeem (requires prior reveal)
# ==============================================================================


def test_redeem_after_reveal(lifecycle):
    redeemer = MockRedeemer.from_sk(lifecycle["keypair"].sk)
    secrets = lifecycle["secrets"]

    rev = redeemer.reveal(secrets.spend_bls_pub, lifecycle["S"])
    assert rev.success is True

    nid = secrets.nullifier_id.hex()
    result = redeemer.redeem(
        recipient=lifecycle["recipient"],
        sigma=lifecycle["proof"].sigma,
        spend_pk=lifecycle["proof"].spend_pk,
        nullifier_id=nid,
        chain_id=_TEST_CHAIN_ID,
        contract_address=_TEST_CONTRACT,
        deadline=_TEST_DEADLINE,
    )
    assert result.success is True
    assert result.bls_spend_ok is True
    assert redeemer.get_state(nid) == NullifierState.SPENT


def test_redeem_without_reveal_fails(lifecycle):
    redeemer = MockRedeemer.from_sk(lifecycle["keypair"].sk)
    nid = lifecycle["secrets"].nullifier_id.hex()
    result = redeemer.redeem(
        recipient=lifecycle["recipient"],
        sigma=lifecycle["proof"].sigma,
        spend_pk=lifecycle["proof"].spend_pk,
        nullifier_id=nid,
        chain_id=_TEST_CHAIN_ID,
        contract_address=_TEST_CONTRACT,
        deadline=_TEST_DEADLINE,
    )
    assert result.success is False
    assert "not revealed" in (result.reason or "").lower()


def test_double_spend(lifecycle):
    redeemer = MockRedeemer.from_sk(lifecycle["keypair"].sk)
    secrets = lifecycle["secrets"]
    nid = secrets.nullifier_id.hex()

    redeemer.reveal(secrets.spend_bls_pub, lifecycle["S"])

    r1 = redeemer.redeem(
        recipient=lifecycle["recipient"],
        sigma=lifecycle["proof"].sigma,
        spend_pk=lifecycle["proof"].spend_pk,
        nullifier_id=nid,
        chain_id=_TEST_CHAIN_ID,
        contract_address=_TEST_CONTRACT,
        deadline=_TEST_DEADLINE,
    )
    assert r1.success is True

    r2 = redeemer.redeem(
        recipient=lifecycle["recipient"],
        sigma=lifecycle["proof"].sigma,
        spend_pk=lifecycle["proof"].spend_pk,
        nullifier_id=nid,
        chain_id=_TEST_CHAIN_ID,
        contract_address=_TEST_CONTRACT,
        deadline=_TEST_DEADLINE,
    )
    assert r2.success is False
    assert r2.nullifier_spent is True


def test_is_spent_and_reset(lifecycle):
    redeemer = MockRedeemer.from_sk(lifecycle["keypair"].sk)
    secrets = lifecycle["secrets"]
    nid = secrets.nullifier_id.hex()

    redeemer.reveal(secrets.spend_bls_pub, lifecycle["S"])
    result = redeemer.redeem(
        recipient=lifecycle["recipient"],
        sigma=lifecycle["proof"].sigma,
        spend_pk=lifecycle["proof"].spend_pk,
        nullifier_id=nid,
        chain_id=_TEST_CHAIN_ID,
        contract_address=_TEST_CONTRACT,
        deadline=_TEST_DEADLINE,
    )
    assert result.success is True
    assert redeemer.is_spent(nid)

    redeemer.reset()
    assert not redeemer.is_spent(nid)
