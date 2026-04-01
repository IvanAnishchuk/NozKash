import pytest
from py_ecc.bn128 import b, b2, curve_order, is_on_curve

import nozk_library as gl
from nozk_library import (
    CurveError,
    DerivationError,
    InvalidPointError,
    NozkError,
    ScalarMultiplicationError,
    TokenKeypair,
    VerificationError,
)

# ==============================================================================
# FIXTURES
# ==============================================================================


@pytest.fixture
def setup_data():
    master_seed = b"pytest_secret_master_seed_2026"
    token_index = 42
    destination = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7"
    return master_seed, token_index, destination


@pytest.fixture
def live_keypair():
    return gl.generate_mint_keypair()


# ==============================================================================
# EXCEPTION HIERARCHY
# ==============================================================================


def test_exception_hierarchy():
    assert issubclass(CurveError, NozkError)
    assert issubclass(InvalidPointError, CurveError)
    assert issubclass(ScalarMultiplicationError, CurveError)
    assert issubclass(DerivationError, NozkError)
    assert issubclass(VerificationError, NozkError)


# ==============================================================================
# MINT KEYPAIR
# ==============================================================================


def test_mint_keypair_generation():
    keypair = gl.generate_mint_keypair()
    assert isinstance(keypair.sk, int)
    assert 0 < keypair.sk < curve_order
    assert is_on_curve(keypair.pk, b2)


def test_mint_keypairs_are_unique():
    kp1 = gl.generate_mint_keypair()
    kp2 = gl.generate_mint_keypair()
    assert kp1.sk != kp2.sk


# ==============================================================================
# TOKEN DERIVATION — structure
# ==============================================================================


def test_derive_token_secrets_returns_two_keypairs(setup_data):
    """Both spend and blind are fully populated TokenKeypair instances."""
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)

    for kp in (secrets.spend, secrets.blind):
        assert isinstance(kp, TokenKeypair)
        assert kp.address.startswith("0x")
        assert len(kp.address) == 42
        assert kp.pub_hex.startswith("0x04")
        assert len(bytes.fromhex(kp.pub_hex[2:])) == 65
        assert len(kp.address_bytes) == 20


def test_spend_and_blind_addresses_are_different(setup_data):
    """The two keypairs must have distinct addresses."""
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    assert secrets.spend.address != secrets.blind.address


def test_deposit_id_is_blind_address(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    assert secrets.deposit_id == secrets.blind.address


def test_r_matches_blind_priv_scalar(setup_data):
    """r must equal int(blind_priv) % curve_order — derivation consistency."""
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    expected = int.from_bytes(secrets.blind.priv.to_bytes(), "big") % curve_order
    assert secrets.r == expected


# ==============================================================================
# TOKEN DERIVATION — determinism and isolation
# ==============================================================================


def test_token_derivation_is_deterministic(setup_data):
    master_seed, token_index, _ = setup_data
    s1 = gl.derive_token_secrets(master_seed, token_index)
    s2 = gl.derive_token_secrets(master_seed, token_index)
    assert s1.spend.address == s2.spend.address
    assert s1.blind.address == s2.blind.address
    assert s1.spend.priv.to_hex() == s2.spend.priv.to_hex()
    assert s1.blind.priv.to_hex() == s2.blind.priv.to_hex()
    assert s1.r == s2.r


def test_different_indices_yield_different_secrets(setup_data):
    master_seed, _, _ = setup_data
    s0 = gl.derive_token_secrets(master_seed, 0)
    s1 = gl.derive_token_secrets(master_seed, 1)
    assert s0.spend.address != s1.spend.address
    assert s0.blind.address != s1.blind.address
    assert s0.r != s1.r


def test_different_seeds_yield_different_secrets():
    s1 = gl.derive_token_secrets(b"seed_a", 0)
    s2 = gl.derive_token_secrets(b"seed_b", 0)
    assert s1.spend.address != s2.spend.address
    assert s1.blind.address != s2.blind.address


def test_index_boundary_256_differs_from_0(setup_data):
    """
    Index 256 must not collide with index 0.
    Catches the DataView/Uint8Array truncation bug where 256 & 0xFF == 0.
    """
    master_seed, _, _ = setup_data
    s0 = gl.derive_token_secrets(master_seed, 0)
    s256 = gl.derive_token_secrets(master_seed, 256)
    assert s0.spend.address != s256.spend.address
    assert s0.blind.address != s256.blind.address
    assert s0.r != s256.r


def test_derive_rejects_empty_seed():
    with pytest.raises(DerivationError, match="non-empty"):
        gl.derive_token_secrets(b"", 0)


def test_derive_rejects_negative_index():
    with pytest.raises(DerivationError, match="non-negative"):
        gl.derive_token_secrets(b"seed", -1)


def test_derive_rejects_oversized_index():
    with pytest.raises(DerivationError, match="32 bits"):
        gl.derive_token_secrets(b"seed", 0x1_0000_0000)


# ==============================================================================
# POINT VALIDATION
# ==============================================================================


def test_parse_g1_valid_point(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    blinded = gl.blind_token(secrets.spend_address_bytes, secrets.r)
    x, y = gl.serialize_g1(blinded.Y)
    recovered = gl.parse_g1(x, y)
    assert recovered[0].n == blinded.Y[0].n
    assert recovered[1].n == blinded.Y[1].n


def test_parse_g1_rejects_invalid_point():
    """(1, 1) is off-curve on BN254: 1^2=1 != 1^3+3=4."""
    with pytest.raises(InvalidPointError) as exc_info:
        gl.parse_g1(1, 1)
    assert isinstance(exc_info.value, CurveError)
    assert isinstance(exc_info.value, NozkError)
    assert exc_info.value.x == 1
    assert exc_info.value.y == 1


def test_mint_blind_sign_rejects_invalid_point():
    from py_ecc.bn128 import FQ

    from nozk_library import G1Point

    bad_point = G1Point((FQ(1), FQ(1)))
    keypair = gl.generate_mint_keypair()
    with pytest.raises(InvalidPointError):
        gl.mint_blind_sign(bad_point, keypair.sk)


# ==============================================================================
# FULL PROTOCOL LIFECYCLE
# ==============================================================================


def test_full_protocol_lifecycle(setup_data, live_keypair):
    master_seed, token_index, destination = setup_data
    keypair = live_keypair

    secrets = gl.derive_token_secrets(master_seed, token_index)
    blinded = gl.blind_token(secrets.spend_address_bytes, secrets.r)

    assert is_on_curve(blinded.Y, b)
    assert is_on_curve(blinded.B, b)

    S_prime = gl.mint_blind_sign(blinded.B, keypair.sk)
    assert is_on_curve(S_prime, b)

    S = gl.unblind_signature(S_prime, secrets.r)
    assert is_on_curve(S, b)

    proof = gl.generate_redemption_proof(
        secrets.spend_priv,
        destination,
        _TEST_CHAIN_ID,
        _TEST_CONTRACT,
        _TEST_DEADLINE,
    )

    assert (
        gl.verify_ecdsa_mev_protection(proof.msg_hash, proof.compact_hex, proof.recovery_bit, secrets.spend_address_hex)
        is True
    )

    assert gl.verify_bls_pairing(S, blinded.Y, keypair.pk) is True


# ==============================================================================
# MEV PROTECTION (EIP-712)
# ==============================================================================

# Fixed EIP-712 test parameters
_TEST_CHAIN_ID = 11155111  # Ethereum Sepolia
_TEST_CONTRACT = "0x00000000000000000000000000000000DeaDBeef"
_TEST_DEADLINE = 2**256 - 1


def test_mev_protection_rejects_tampered_destination(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    alice = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"
    proof = gl.generate_redemption_proof(
        secrets.spend_priv,
        alice,
        _TEST_CHAIN_ID,
        _TEST_CONTRACT,
        _TEST_DEADLINE,
    )

    bob = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB"
    tampered_hash = gl.eip712_redemption_hash(bob, _TEST_DEADLINE, _TEST_CHAIN_ID, _TEST_CONTRACT)
    assert (
        gl.verify_ecdsa_mev_protection(tampered_hash, proof.compact_hex, proof.recovery_bit, secrets.spend_address_hex)
        is False
    )


def test_mev_protection_rejects_wrong_recovery_bit(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    alice = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"
    proof = gl.generate_redemption_proof(
        secrets.spend_priv,
        alice,
        _TEST_CHAIN_ID,
        _TEST_CONTRACT,
        _TEST_DEADLINE,
    )

    wrong_bit = 1 - proof.recovery_bit
    assert (
        gl.verify_ecdsa_mev_protection(proof.msg_hash, proof.compact_hex, wrong_bit, secrets.spend_address_hex) is False
    )


def test_mev_protection_raises_on_bad_compact_hex(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    alice = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"
    proof = gl.generate_redemption_proof(
        secrets.spend_priv,
        alice,
        _TEST_CHAIN_ID,
        _TEST_CONTRACT,
        _TEST_DEADLINE,
    )

    with pytest.raises(VerificationError, match="128 hex chars"):
        gl.verify_ecdsa_mev_protection(proof.msg_hash, "tooshort", proof.recovery_bit, secrets.spend_address_hex)


def test_mev_protection_raises_on_bad_recovery_bit(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    alice = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"
    proof = gl.generate_redemption_proof(
        secrets.spend_priv,
        alice,
        _TEST_CHAIN_ID,
        _TEST_CONTRACT,
        _TEST_DEADLINE,
    )

    with pytest.raises(VerificationError, match="recovery_bit"):
        gl.verify_ecdsa_mev_protection(proof.msg_hash, proof.compact_hex, 5, secrets.spend_address_hex)


# ==============================================================================
# BLS PAIRING
# ==============================================================================


def test_bls_pairing_rejects_wrong_keypair(setup_data):
    master_seed, token_index, _ = setup_data
    kp1 = gl.generate_mint_keypair()
    kp2 = gl.generate_mint_keypair()

    secrets = gl.derive_token_secrets(master_seed, token_index)
    blinded = gl.blind_token(secrets.spend_address_bytes, secrets.r)
    S_prime = gl.mint_blind_sign(blinded.B, kp1.sk)
    S = gl.unblind_signature(S_prime, secrets.r)

    assert gl.verify_bls_pairing(S, blinded.Y, kp1.pk) is True
    assert gl.verify_bls_pairing(S, blinded.Y, kp2.pk) is False


def test_bls_pairing_rejects_wrong_token(setup_data, live_keypair):
    master_seed, _, _ = setup_data
    keypair = live_keypair

    secrets_a = gl.derive_token_secrets(master_seed, 0)
    secrets_b = gl.derive_token_secrets(master_seed, 1)

    blinded_a = gl.blind_token(secrets_a.spend_address_bytes, secrets_a.r)
    blinded_b = gl.blind_token(secrets_b.spend_address_bytes, secrets_b.r)

    S_prime = gl.mint_blind_sign(blinded_a.B, keypair.sk)
    S = gl.unblind_signature(S_prime, secrets_a.r)

    assert gl.verify_bls_pairing(S, blinded_a.Y, keypair.pk) is True
    assert gl.verify_bls_pairing(S, blinded_b.Y, keypair.pk) is False


# ==============================================================================
# HASH TO CURVE
# ==============================================================================


def test_hash_to_curve_returns_on_curve_point():
    point = gl.hash_to_curve(b"test_message")
    assert is_on_curve(point, b)


def test_hash_to_curve_is_deterministic():
    p1 = gl.hash_to_curve(b"determinism_check")
    p2 = gl.hash_to_curve(b"determinism_check")
    assert p1[0].n == p2[0].n
    assert p1[1].n == p2[1].n


def test_hash_to_curve_different_inputs_differ():
    p1 = gl.hash_to_curve(b"input_a")
    p2 = gl.hash_to_curve(b"input_b")
    assert (p1[0].n, p1[1].n) != (p2[0].n, p2[1].n)


def test_hash_to_curve_matches_blind_token_y(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    direct = gl.hash_to_curve(secrets.spend_address_bytes)
    blinded = gl.blind_token(secrets.spend_address_bytes, secrets.r)
    assert direct[0].n == blinded.Y[0].n
    assert direct[1].n == blinded.Y[1].n


# ==============================================================================
# SERIALIZE / PARSE G1
# ==============================================================================


def test_serialize_g1_round_trip(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    blinded = gl.blind_token(secrets.spend_address_bytes, secrets.r)
    x, y = gl.serialize_g1(blinded.Y)
    recovered = gl.parse_g1(x, y)
    assert recovered[0].n == blinded.Y[0].n
    assert recovered[1].n == blinded.Y[1].n


def test_serialize_g1_returns_plain_ints(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    blinded = gl.blind_token(secrets.spend_address_bytes, secrets.r)
    x, y = gl.serialize_g1(blinded.Y)
    assert type(x) is int
    assert type(y) is int


# ==============================================================================
# EIP-712 DIRECT TESTS
# ==============================================================================


def test_eip712_domain_separator_is_deterministic():
    a = gl.eip712_domain_separator(_TEST_CHAIN_ID, _TEST_CONTRACT)
    b = gl.eip712_domain_separator(_TEST_CHAIN_ID, _TEST_CONTRACT)
    assert a == b


def test_eip712_domain_separator_changes_with_chain_id():
    a = gl.eip712_domain_separator(1, _TEST_CONTRACT)
    b = gl.eip712_domain_separator(11155111, _TEST_CONTRACT)
    assert a != b


def test_eip712_redemption_hash_matches_vector():
    import json
    from pathlib import Path

    vec_path = Path(__file__).resolve().parent / ".." / "test_vectors" / "fb609bc5_c7e9cab4" / "token_0.json"
    vec = json.loads(vec_path.read_text())
    h = gl.eip712_redemption_hash(
        vec["REDEEM_TX"]["recipient"],
        int(vec["EIP712"]["deadline"], 16),
        vec["EIP712"]["chain_id"],
        vec["EIP712"]["contract_address"],
    )
    assert h.hex() == vec["REDEEM_TX"]["msg_hash"]


def test_eip712_redemption_hash_changes_with_recipient():
    alice = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"
    bob = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB"
    h1 = gl.eip712_redemption_hash(alice, _TEST_DEADLINE, _TEST_CHAIN_ID, _TEST_CONTRACT)
    h2 = gl.eip712_redemption_hash(bob, _TEST_DEADLINE, _TEST_CHAIN_ID, _TEST_CONTRACT)
    assert h1 != h2
