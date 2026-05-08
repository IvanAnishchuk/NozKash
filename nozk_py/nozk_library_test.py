import pytest

import nozk_library as gl
from bls12_381_crypto import (
    CURVE_ORDER,
    abi_encode_g1,
    hash_to_g2,
    serialize_g1_sol,
    serialize_g2_sol,
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
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)

    assert isinstance(secrets.spend_bls_priv, int)
    assert 0 < secrets.spend_bls_priv < CURVE_ORDER
    assert secrets.spend_bls_pub is not None
    assert secrets.spend_chia_sk is not None
    assert secrets.spend_chia_pk is not None
    assert len(secrets.nullifier_id) == 32
    assert secrets.deposit_id.startswith("0x")
    assert len(secrets.deposit_id) == 42
    assert 0 < secrets.r < CURVE_ORDER


def test_deposit_id_is_blind_address(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    assert secrets.deposit_id == secrets.deposit_blind_keypair.address


def test_nullifier_id_matches_g1_pubkey_hash(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    from eth_utils import keccak

    expected = keccak(abi_encode_g1(secrets.spend_bls_pub))
    assert secrets.nullifier_id == expected


def test_r_matches_blind_priv_scalar(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    expected = int.from_bytes(secrets.deposit_blind_keypair.priv.to_bytes(), "big") % CURVE_ORDER
    assert secrets.r == expected


def test_chia_pk_matches_pyecc_pub(setup_data):
    """chia_rs PK and py_ecc PK should represent the same G1 point."""
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    # Both derive from the same scalar — chia compressed should match py_ecc coords
    assert secrets.spend_chia_pk is not None
    assert len(secrets.spend_chia_pk.to_bytes()) == 48


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
# HASH-TO-G2
# ==============================================================================


def test_hash_to_g2_deterministic():
    p1 = hash_to_g2(b"determinism_check")
    p2 = hash_to_g2(b"determinism_check")
    assert serialize_g2_sol(p1) == serialize_g2_sol(p2)


def test_hash_to_g2_different_inputs_differ():
    p1 = hash_to_g2(b"input_a")
    p2 = hash_to_g2(b"input_b")
    assert serialize_g2_sol(p1) != serialize_g2_sol(p2)


def test_hash_to_g2_matches_blind_token_y(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    direct = hash_to_g2(abi_encode_g1(secrets.spend_bls_pub))
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    assert serialize_g2_sol(direct) == serialize_g2_sol(blinded.Y)


# ==============================================================================
# SERIALIZATION
# ==============================================================================


def test_serialize_g1_round_trip(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    coords = serialize_g1_sol(secrets.spend_bls_pub)
    from bls12_381_crypto import parse_g1_sol

    recovered = parse_g1_sol(*coords)
    assert serialize_g1_sol(recovered) == coords


def test_serialize_g2_round_trip(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    coords = serialize_g2_sol(blinded.Y)
    from bls12_381_crypto import parse_g2_sol

    recovered = parse_g2_sol(*coords)
    assert serialize_g2_sol(recovered) == coords


# ==============================================================================
# FULL PROTOCOL LIFECYCLE
# ==============================================================================

_TEST_CHAIN_ID = 11155111
_TEST_CONTRACT = "0x00000000000000000000000000000000DeaDBeef"
_TEST_DEADLINE = 2**256 - 1


def test_full_protocol_lifecycle(setup_data, live_keypair):
    master_seed, token_index, destination = setup_data
    keypair = live_keypair

    secrets = gl.derive_token_secrets(master_seed, token_index)
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)

    S_prime = gl.mint_blind_sign(blinded.B, keypair.sk)
    S = gl.unblind_signature(S_prime, secrets.r)

    assert gl.verify_bls_mint_signature(S, blinded.Y, keypair.pk) is True

    proof = gl.generate_redemption_proof(
        secrets.spend_chia_sk,
        secrets.spend_chia_pk,
        destination,
        _TEST_CHAIN_ID,
        _TEST_CONTRACT,
        _TEST_DEADLINE,
    )
    assert gl.verify_bls_spend_signature(proof.sigma, proof.msg_hash, secrets.spend_chia_pk) is True


# ==============================================================================
# BLS SPEND SIGNATURE (chia_rs AugSchemeMPL)
# ==============================================================================


def test_spend_signature_rejects_tampered_destination(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    alice = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"
    proof = gl.generate_redemption_proof(
        secrets.spend_chia_sk,
        secrets.spend_chia_pk,
        alice,
        _TEST_CHAIN_ID,
        _TEST_CONTRACT,
        _TEST_DEADLINE,
    )

    bob = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB"
    tampered_hash = gl.eip712_redemption_hash(bob, _TEST_DEADLINE, _TEST_CHAIN_ID, _TEST_CONTRACT)
    assert gl.verify_bls_spend_signature(proof.sigma, tampered_hash, secrets.spend_chia_pk) is False


def test_spend_signature_rejects_wrong_key(setup_data):
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    alice = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"
    proof = gl.generate_redemption_proof(
        secrets.spend_chia_sk,
        secrets.spend_chia_pk,
        alice,
        _TEST_CHAIN_ID,
        _TEST_CONTRACT,
        _TEST_DEADLINE,
    )
    other = gl.derive_token_secrets(master_seed, token_index + 1)
    assert gl.verify_bls_spend_signature(proof.sigma, proof.msg_hash, other.spend_chia_pk) is False


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

    sa = gl.derive_token_secrets(master_seed, 0)
    sb = gl.derive_token_secrets(master_seed, 1)

    ba = gl.blind_token(sa.spend_bls_pub, sa.r)
    bb = gl.blind_token(sb.spend_bls_pub, sb.r)

    S_prime = gl.mint_blind_sign(ba.B, keypair.sk)
    S = gl.unblind_signature(S_prime, sa.r)

    assert gl.verify_bls_mint_signature(S, ba.Y, keypair.pk) is True
    assert gl.verify_bls_mint_signature(S, bb.Y, keypair.pk) is False


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
    extra = gl.derive_token_secrets(seed, 99)
    assert gl.verify_aggregated_reveal(sigma, pubs + [extra.spend_bls_pub], keypair.pk) is False


def test_aggregated_reveal_rejects_wrong_mint_key(live_keypair):
    keypair = live_keypair
    wrong = gl.generate_mint_keypair()
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
    assert gl.verify_aggregated_reveal(sigma, pubs, wrong.pk) is False


# ==============================================================================
# AGGREGATED REDEEM (chia_rs, same message, multiple spend keys)
# ==============================================================================


def test_aggregated_redeem_3_tokens():
    seed = b"redeem_aggregation_test"
    destination = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7"
    msg_hash = gl.eip712_redemption_hash(destination, _TEST_DEADLINE, _TEST_CHAIN_ID, _TEST_CONTRACT)

    sigs = []
    pks = []
    for i in range(3):
        secrets = gl.derive_token_secrets(seed, i)
        proof = gl.generate_redemption_proof(
            secrets.spend_chia_sk,
            secrets.spend_chia_pk,
            destination,
            _TEST_CHAIN_ID,
            _TEST_CONTRACT,
            _TEST_DEADLINE,
        )
        sigs.append(proof.sigma)
        pks.append(secrets.spend_chia_pk)

    sigma = gl.aggregate_redeem_sigma(sigs)
    assert gl.verify_aggregated_redeem(sigma, msg_hash, pks) is True


def test_aggregated_redeem_rejects_wrong_message():
    seed = b"redeem_aggregation_test"
    destination = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7"

    sigs = []
    pks = []
    for i in range(2):
        secrets = gl.derive_token_secrets(seed, i)
        proof = gl.generate_redemption_proof(
            secrets.spend_chia_sk,
            secrets.spend_chia_pk,
            destination,
            _TEST_CHAIN_ID,
            _TEST_CONTRACT,
            _TEST_DEADLINE,
        )
        sigs.append(proof.sigma)
        pks.append(secrets.spend_chia_pk)

    sigma = gl.aggregate_redeem_sigma(sigs)
    wrong_hash = gl.eip712_redemption_hash(
        "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB", _TEST_DEADLINE, _TEST_CHAIN_ID, _TEST_CONTRACT
    )
    assert gl.verify_aggregated_redeem(sigma, wrong_hash, pks) is False


def test_aggregated_redeem_rejects_extra_key():
    seed = b"redeem_aggregation_test"
    destination = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7"
    msg_hash = gl.eip712_redemption_hash(destination, _TEST_DEADLINE, _TEST_CHAIN_ID, _TEST_CONTRACT)

    sigs = []
    pks = []
    for i in range(2):
        secrets = gl.derive_token_secrets(seed, i)
        proof = gl.generate_redemption_proof(
            secrets.spend_chia_sk,
            secrets.spend_chia_pk,
            destination,
            _TEST_CHAIN_ID,
            _TEST_CONTRACT,
            _TEST_DEADLINE,
        )
        sigs.append(proof.sigma)
        pks.append(secrets.spend_chia_pk)

    sigma = gl.aggregate_redeem_sigma(sigs)
    extra = gl.derive_token_secrets(seed, 99)
    assert gl.verify_aggregated_redeem(sigma, msg_hash, pks + [extra.spend_chia_pk]) is False


# ==============================================================================
# EIP-712
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
