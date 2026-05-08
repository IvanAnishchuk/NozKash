import pytest

import nozk_library as gl
from bls12_381_crypto import (
    CURVE_ORDER,
    abi_encode_g2,
    hash_to_g1,
    serialize_g1,
    serialize_g2,
)
from nozk_library import (
    CurveError,
    DerivationError,
    NozkError,
    ScalarMultiplicationError,
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
    assert issubclass(ScalarMultiplicationError, CurveError)
    assert issubclass(DerivationError, NozkError)
    assert issubclass(VerificationError, NozkError)


# ==============================================================================
# MINT KEYPAIR
# ==============================================================================


def test_mint_keypair_generation():
    keypair = gl.generate_mint_keypair()
    assert isinstance(keypair.sk, int)
    assert 0 < keypair.sk < CURVE_ORDER


def test_mint_keypairs_are_unique():
    kp1 = gl.generate_mint_keypair()
    kp2 = gl.generate_mint_keypair()
    assert kp1.sk != kp2.sk


# ==============================================================================
# TOKEN DERIVATION — structure
# ==============================================================================


def test_derive_token_secrets_structure(setup_data):
    """spend is BLS12-381 keypair, blind is secp256k1 keypair for deposit ID."""
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)

    # BLS spend key
    assert isinstance(secrets.spend_bls_priv, int)
    assert 0 < secrets.spend_bls_priv < CURVE_ORDER
    assert secrets.spend_bls_pub is not None

    # Nullifier ID = 32 bytes
    assert len(secrets.nullifier_id) == 32
    assert secrets.nullifier_id_hex.startswith("0x")

    # Deposit ID (secp256k1 blind keypair)
    assert secrets.deposit_id.startswith("0x")
    assert len(secrets.deposit_id) == 42

    # Blinding factor
    assert 0 < secrets.r < CURVE_ORDER


def test_deposit_id_is_blind_address(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    assert secrets.deposit_id == secrets.deposit_blind_keypair.address


def test_nullifier_id_matches_g2_pubkey_hash(setup_data):
    """nullifier_id = keccak256(abi.encode(spend_bls_pub))."""
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    from eth_utils import keccak

    expected = keccak(abi_encode_g2(secrets.spend_bls_pub))
    assert secrets.nullifier_id == expected


def test_r_matches_blind_priv_scalar(setup_data):
    """r must equal int(blind_priv) % BLS12_381_ORDER."""
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    expected = int.from_bytes(secrets.deposit_blind_keypair.priv.to_bytes(), "big") % CURVE_ORDER
    assert secrets.r == expected


# ==============================================================================
# TOKEN DERIVATION — determinism and isolation
# ==============================================================================


def test_token_derivation_is_deterministic(setup_data):
    master_seed, token_index, _ = setup_data
    s1 = gl.derive_token_secrets(master_seed, token_index)
    s2 = gl.derive_token_secrets(master_seed, token_index)
    assert s1.spend_bls_priv == s2.spend_bls_priv
    assert s1.nullifier_id == s2.nullifier_id
    assert s1.deposit_id == s2.deposit_id
    assert s1.r == s2.r


def test_different_indices_yield_different_secrets(setup_data):
    master_seed, _, _ = setup_data
    s0 = gl.derive_token_secrets(master_seed, 0)
    s1 = gl.derive_token_secrets(master_seed, 1)
    assert s0.nullifier_id != s1.nullifier_id
    assert s0.deposit_id != s1.deposit_id
    assert s0.r != s1.r


def test_different_seeds_yield_different_secrets():
    s1 = gl.derive_token_secrets(b"seed_a", 0)
    s2 = gl.derive_token_secrets(b"seed_b", 0)
    assert s1.nullifier_id != s2.nullifier_id
    assert s1.deposit_id != s2.deposit_id


def test_index_boundary_256_differs_from_0(setup_data):
    master_seed, _, _ = setup_data
    s0 = gl.derive_token_secrets(master_seed, 0)
    s256 = gl.derive_token_secrets(master_seed, 256)
    assert s0.nullifier_id != s256.nullifier_id
    assert s0.deposit_id != s256.deposit_id
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
# HASH-TO-G1
# ==============================================================================


def test_hash_to_g1_deterministic():
    p1 = hash_to_g1(b"determinism_check")
    p2 = hash_to_g1(b"determinism_check")
    assert serialize_g1(p1) == serialize_g1(p2)


def test_hash_to_g1_different_inputs_differ():
    p1 = hash_to_g1(b"input_a")
    p2 = hash_to_g1(b"input_b")
    assert serialize_g1(p1) != serialize_g1(p2)


def test_hash_to_g1_cofactor_cleared():
    """Hash-to-G1 result must be in the prime-order subgroup."""
    from py_ecc.optimized_bls12_381 import Z1, eq
    from py_ecc.optimized_bls12_381 import multiply as raw_mul

    p = hash_to_g1(b"cofactor test")
    identity = raw_mul(p, CURVE_ORDER)
    assert eq(identity, Z1)


def test_hash_to_g1_matches_blind_token_y(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    direct = hash_to_g1(abi_encode_g2(secrets.spend_bls_pub))
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    assert serialize_g1(direct) == serialize_g1(blinded.Y)


# ==============================================================================
# G1/G2 SERIALIZATION
# ==============================================================================


def test_serialize_g1_round_trip(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    coords = serialize_g1(blinded.Y)
    from bls12_381_crypto import parse_g1

    recovered = parse_g1(*coords)
    assert serialize_g1(recovered) == coords


def test_serialize_g1_returns_plain_ints(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    coords = serialize_g1(blinded.Y)
    assert len(coords) == 4
    assert all(type(c) is int for c in coords)


def test_serialize_g2_round_trip(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    coords = serialize_g2(secrets.spend_bls_pub)
    from bls12_381_crypto import parse_g2

    recovered = parse_g2(*coords)
    assert serialize_g2(recovered) == coords


def test_serialize_g2_returns_8_ints(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    coords = serialize_g2(secrets.spend_bls_pub)
    assert len(coords) == 8
    assert all(type(c) is int for c in coords)


# ==============================================================================
# FULL PROTOCOL LIFECYCLE
# ==============================================================================

# Fixed EIP-712 test parameters
_TEST_CHAIN_ID = 11155111  # Ethereum Sepolia
_TEST_CONTRACT = "0x00000000000000000000000000000000DeaDBeef"
_TEST_DEADLINE = 2**256 - 1


def test_full_protocol_lifecycle(setup_data, live_keypair):
    master_seed, token_index, destination = setup_data
    keypair = live_keypair

    secrets = gl.derive_token_secrets(master_seed, token_index)
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)

    S_prime = gl.mint_blind_sign(blinded.B, keypair.sk)
    S = gl.unblind_signature(S_prime, secrets.r)

    # Verify mint BLS signature
    assert gl.verify_bls_mint_signature(S, blinded.Y, keypair.pk) is True

    # Generate and verify BLS spend signature (replaces ECDSA)
    proof = gl.generate_redemption_proof(
        secrets.spend_bls_priv,
        secrets.spend_bls_pub,
        destination,
        _TEST_CHAIN_ID,
        _TEST_CONTRACT,
        _TEST_DEADLINE,
    )
    assert gl.verify_bls_spend_signature(proof.sigma, proof.msg_hash, secrets.spend_bls_pub) is True


# ==============================================================================
# BLS SPEND SIGNATURE (replaces MEV protection / ECDSA tests)
# ==============================================================================


def test_spend_signature_rejects_tampered_destination(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    alice = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"
    proof = gl.generate_redemption_proof(
        secrets.spend_bls_priv,
        secrets.spend_bls_pub,
        alice,
        _TEST_CHAIN_ID,
        _TEST_CONTRACT,
        _TEST_DEADLINE,
    )

    bob = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB"
    tampered_hash = gl.eip712_redemption_hash(bob, _TEST_DEADLINE, _TEST_CHAIN_ID, _TEST_CONTRACT)
    assert gl.verify_bls_spend_signature(proof.sigma, tampered_hash, secrets.spend_bls_pub) is False


def test_spend_signature_rejects_wrong_key(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    alice = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"
    proof = gl.generate_redemption_proof(
        secrets.spend_bls_priv,
        secrets.spend_bls_pub,
        alice,
        _TEST_CHAIN_ID,
        _TEST_CONTRACT,
        _TEST_DEADLINE,
    )

    # Different token's spend key should not verify
    other_secrets = gl.derive_token_secrets(master_seed, token_index + 1)
    assert gl.verify_bls_spend_signature(proof.sigma, proof.msg_hash, other_secrets.spend_bls_pub) is False


# ==============================================================================
# BLS MINT PAIRING
# ==============================================================================


def test_bls_mint_rejects_wrong_keypair(setup_data):
    master_seed, token_index, _ = setup_data
    kp1 = gl.generate_mint_keypair()
    kp2 = gl.generate_mint_keypair()

    secrets = gl.derive_token_secrets(master_seed, token_index)
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    S_prime = gl.mint_blind_sign(blinded.B, kp1.sk)
    S = gl.unblind_signature(S_prime, secrets.r)

    assert gl.verify_bls_mint_signature(S, blinded.Y, kp1.pk) is True
    assert gl.verify_bls_mint_signature(S, blinded.Y, kp2.pk) is False


def test_bls_mint_rejects_wrong_token(setup_data, live_keypair):
    master_seed, _, _ = setup_data
    keypair = live_keypair

    secrets_a = gl.derive_token_secrets(master_seed, 0)
    secrets_b = gl.derive_token_secrets(master_seed, 1)

    blinded_a = gl.blind_token(secrets_a.spend_bls_pub, secrets_a.r)
    blinded_b = gl.blind_token(secrets_b.spend_bls_pub, secrets_b.r)

    S_prime = gl.mint_blind_sign(blinded_a.B, keypair.sk)
    S = gl.unblind_signature(S_prime, secrets_a.r)

    assert gl.verify_bls_mint_signature(S, blinded_a.Y, keypair.pk) is True
    assert gl.verify_bls_mint_signature(S, blinded_b.Y, keypair.pk) is False


# ==============================================================================
# AGGREGATED REVEAL (same mint key, multiple tokens)
# ==============================================================================


def test_aggregated_reveal_3_tokens(live_keypair):
    keypair = live_keypair
    seed = b"aggregation_test_seed"

    sigs = []
    pubs = []
    for i in range(3):
        secrets = gl.derive_token_secrets(seed, i)
        blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
        s_prime = gl.mint_blind_sign(blinded.B, keypair.sk)
        s = gl.unblind_signature(s_prime, secrets.r)
        sigs.append(s)
        pubs.append(secrets.spend_bls_pub)

    sigma = gl.aggregate_reveal_sigma(sigs)
    assert gl.verify_aggregated_reveal(sigma, pubs, keypair.pk) is True


def test_aggregated_reveal_rejects_extra_nullifier(live_keypair):
    keypair = live_keypair
    seed = b"aggregation_test_seed"

    sigs = []
    pubs = []
    for i in range(2):
        secrets = gl.derive_token_secrets(seed, i)
        blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
        s_prime = gl.mint_blind_sign(blinded.B, keypair.sk)
        s = gl.unblind_signature(s_prime, secrets.r)
        sigs.append(s)
        pubs.append(secrets.spend_bls_pub)

    sigma = gl.aggregate_reveal_sigma(sigs)

    # Add an extra (unsigned) nullifier — should fail
    extra = gl.derive_token_secrets(seed, 99)
    pubs_tampered = pubs + [extra.spend_bls_pub]
    assert gl.verify_aggregated_reveal(sigma, pubs_tampered, keypair.pk) is False


def test_aggregated_reveal_rejects_wrong_mint_key(live_keypair):
    keypair = live_keypair
    wrong_keypair = gl.generate_mint_keypair()
    seed = b"aggregation_test_seed"

    sigs = []
    pubs = []
    for i in range(2):
        secrets = gl.derive_token_secrets(seed, i)
        blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
        s_prime = gl.mint_blind_sign(blinded.B, keypair.sk)
        s = gl.unblind_signature(s_prime, secrets.r)
        sigs.append(s)
        pubs.append(secrets.spend_bls_pub)

    sigma = gl.aggregate_reveal_sigma(sigs)
    assert gl.verify_aggregated_reveal(sigma, pubs, wrong_keypair.pk) is False


# ==============================================================================
# AGGREGATED REDEEM (same message, multiple spend keys)
# ==============================================================================


def test_aggregated_redeem_3_tokens():
    seed = b"redeem_aggregation_test"
    destination = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7"
    msg_hash = gl.eip712_redemption_hash(destination, _TEST_DEADLINE, _TEST_CHAIN_ID, _TEST_CONTRACT)

    spend_sigs = []
    spend_pubs = []
    for i in range(3):
        secrets = gl.derive_token_secrets(seed, i)
        proof = gl.generate_redemption_proof(
            secrets.spend_bls_priv,
            secrets.spend_bls_pub,
            destination,
            _TEST_CHAIN_ID,
            _TEST_CONTRACT,
            _TEST_DEADLINE,
        )
        spend_sigs.append(proof.sigma)
        spend_pubs.append(secrets.spend_bls_pub)

    sigma = gl.aggregate_redeem_sigma(spend_sigs)
    assert gl.verify_aggregated_redeem(sigma, msg_hash, spend_pubs) is True


def test_aggregated_redeem_rejects_wrong_message():
    seed = b"redeem_aggregation_test"
    destination = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7"

    spend_sigs = []
    spend_pubs = []
    for i in range(2):
        secrets = gl.derive_token_secrets(seed, i)
        proof = gl.generate_redemption_proof(
            secrets.spend_bls_priv,
            secrets.spend_bls_pub,
            destination,
            _TEST_CHAIN_ID,
            _TEST_CONTRACT,
            _TEST_DEADLINE,
        )
        spend_sigs.append(proof.sigma)
        spend_pubs.append(secrets.spend_bls_pub)

    sigma = gl.aggregate_redeem_sigma(spend_sigs)

    # Tampered message
    wrong_destination = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB"
    wrong_hash = gl.eip712_redemption_hash(wrong_destination, _TEST_DEADLINE, _TEST_CHAIN_ID, _TEST_CONTRACT)
    assert gl.verify_aggregated_redeem(sigma, wrong_hash, spend_pubs) is False


def test_aggregated_redeem_rejects_extra_key():
    seed = b"redeem_aggregation_test"
    destination = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7"
    msg_hash = gl.eip712_redemption_hash(destination, _TEST_DEADLINE, _TEST_CHAIN_ID, _TEST_CONTRACT)

    spend_sigs = []
    spend_pubs = []
    for i in range(2):
        secrets = gl.derive_token_secrets(seed, i)
        proof = gl.generate_redemption_proof(
            secrets.spend_bls_priv,
            secrets.spend_bls_pub,
            destination,
            _TEST_CHAIN_ID,
            _TEST_CONTRACT,
            _TEST_DEADLINE,
        )
        spend_sigs.append(proof.sigma)
        spend_pubs.append(secrets.spend_bls_pub)

    sigma = gl.aggregate_redeem_sigma(spend_sigs)

    # Add an extra key that didn't sign
    extra = gl.derive_token_secrets(seed, 99)
    pubs_tampered = spend_pubs + [extra.spend_bls_pub]
    assert gl.verify_aggregated_redeem(sigma, msg_hash, pubs_tampered) is False


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


def test_eip712_redemption_hash_changes_with_recipient():
    alice = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"
    bob = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB"
    h1 = gl.eip712_redemption_hash(alice, _TEST_DEADLINE, _TEST_CHAIN_ID, _TEST_CONTRACT)
    h2 = gl.eip712_redemption_hash(bob, _TEST_DEADLINE, _TEST_CHAIN_ID, _TEST_CONTRACT)
    assert h1 != h2
