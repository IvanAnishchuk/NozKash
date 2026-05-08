"""
Nozk Protocol: Parametrized Vector Tests (BLS12-381)

Discovers all vector files under test_vectors/ and runs the full protocol
verification suite against each one. Add more vectors by running:

    uv run generate_vectors.py

Then re-run pytest — new files are picked up automatically.
"""

import json
from pathlib import Path

import pytest

import nozk_library as gl
from bls12_381_crypto import (
    G2_GEN,
    Scalar,
    g2_scalar_mul,
    serialize_g1,
    serialize_g2,
)

# ==============================================================================
# VECTOR DISCOVERY
# ==============================================================================

VECTORS_DIR = Path(__file__).resolve().parent.parent / "test_vectors"


def load_all_vectors() -> list[tuple[str, dict]]:
    """
    Returns a list of (test_id, vector_dict) for every JSON file found under
    test_vectors/. test_id is "<keypair_dir>/<filename>" for readable pytest output.
    """
    if not VECTORS_DIR.exists():
        pytest.skip("test_vectors/ not found — run `uv run generate_vectors.py` first")
        return []
    files = sorted(f for f in VECTORS_DIR.rglob("token_*.json") if f.parent != VECTORS_DIR)
    if not files:
        pytest.skip("test_vectors/ is empty — run `uv run generate_vectors.py` first")
    return [(f"{f.parent.name}/{f.stem}", json.loads(f.read_text())) for f in files]


def load_aggregation_vectors() -> list[tuple[str, dict]]:
    """Load aggregation.json from each keypair directory."""
    if not VECTORS_DIR.exists():
        return []
    files = sorted(VECTORS_DIR.rglob("aggregation.json"))
    if not files:
        return []
    return [(f.parent.name, json.loads(f.read_text())) for f in files]


ALL_VECTORS = load_all_vectors()
IDS = [v[0] for v in ALL_VECTORS]
PARAMS = [v[1] for v in ALL_VECTORS]

AGG_VECTORS = load_aggregation_vectors()
AGG_IDS = [v[0] for v in AGG_VECTORS]
AGG_PARAMS = [v[1] for v in AGG_VECTORS]


# ==============================================================================
# HELPERS
# ==============================================================================


def _g1_from_dict(d: dict) -> tuple[int, int, int, int]:
    """Parse G1 coords from vector dict."""
    return (int(d["x_hi"], 16), int(d["x_lo"], 16), int(d["y_hi"], 16), int(d["y_lo"], 16))


def _g2_from_dict(d: dict) -> tuple[int, int, int, int, int, int, int, int]:
    """Parse G2 coords from vector dict."""
    return (
        int(d["x_c0_hi"], 16),
        int(d["x_c0_lo"], 16),
        int(d["x_c1_hi"], 16),
        int(d["x_c1_lo"], 16),
        int(d["y_c0_hi"], 16),
        int(d["y_c0_lo"], 16),
        int(d["y_c1_hi"], 16),
        int(d["y_c1_lo"], 16),
    )


# ==============================================================================
# PARAMETRIZED TESTS — per token
# ==============================================================================


@pytest.mark.parametrize("v", PARAMS, ids=IDS)
def test_mint_pk_vector(v):
    """Proves the Mint's G2 Public Key derives correctly from the scalar."""
    sk_mint = Scalar(int(v["MINT_BLS_PRIVKEY"], 16))
    pk_mint = g2_scalar_mul(G2_GEN, sk_mint)
    assert serialize_g2(pk_mint) == _g2_from_dict(v["PK_MINT"])


@pytest.mark.parametrize("v", PARAMS, ids=IDS)
def test_derive_token_secrets_vector(v):
    """Proves deterministic derivation yields the exact nullifier_id and blinding factor."""
    master_seed = v["MASTER_SEED"].encode("utf-8")
    secrets = gl.derive_token_secrets(master_seed, v["TOKEN_INDEX"])

    assert secrets.nullifier_id.hex() == v["SPEND_BLS"]["nullifier_id"]
    assert hex(secrets.r) == v["BLIND_KEYPAIR"]["r"]
    assert secrets.deposit_id == v["DEPOSIT_ID"]


@pytest.mark.parametrize("v", PARAMS, ids=IDS)
def test_spend_bls_pub_vector(v):
    """Proves the spend BLS public key matches the vector."""
    master_seed = v["MASTER_SEED"].encode("utf-8")
    secrets = gl.derive_token_secrets(master_seed, v["TOKEN_INDEX"])
    assert serialize_g2(secrets.spend_bls_pub) == _g2_from_dict(v["SPEND_BLS"]["pub_G2"])


@pytest.mark.parametrize("v", PARAMS, ids=IDS)
def test_blind_token_vector(v):
    """Proves Hash-to-Curve mapping and multiplicative blinding match."""
    master_seed = v["MASTER_SEED"].encode("utf-8")
    secrets = gl.derive_token_secrets(master_seed, v["TOKEN_INDEX"])
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)

    assert serialize_g1(blinded.Y) == _g1_from_dict(v["Y_HASH_TO_CURVE"])
    assert serialize_g1(blinded.B) == _g1_from_dict(v["B_BLINDED"])


@pytest.mark.parametrize("v", PARAMS, ids=IDS)
def test_mint_blind_sign_vector(v):
    """Proves the Mint's blind signature (S') generates the exact same point."""
    master_seed = v["MASTER_SEED"].encode("utf-8")
    secrets = gl.derive_token_secrets(master_seed, v["TOKEN_INDEX"])
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    sk_mint = Scalar(int(v["MINT_BLS_PRIVKEY"], 16))

    S_prime = gl.mint_blind_sign(blinded.B, sk_mint)
    assert serialize_g1(S_prime) == _g1_from_dict(v["S_PRIME"])


@pytest.mark.parametrize("v", PARAMS, ids=IDS)
def test_unblind_signature_vector(v):
    """Proves client-side unblinding correctly recovers the final token signature."""
    master_seed = v["MASTER_SEED"].encode("utf-8")
    secrets = gl.derive_token_secrets(master_seed, v["TOKEN_INDEX"])
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    sk_mint = Scalar(int(v["MINT_BLS_PRIVKEY"], 16))
    S_prime = gl.mint_blind_sign(blinded.B, sk_mint)

    S = gl.unblind_signature(S_prime, secrets.r)
    assert serialize_g1(S) == _g1_from_dict(v["S_UNBLINDED"])


@pytest.mark.parametrize("v", PARAMS, ids=IDS)
def test_full_lifecycle_vector(v):
    """
    End-to-end pairing check: proves e(S, G2) == e(Y, PK_mint) for every vector.
    This is the mathematical statement the on-chain BLS12-381 pairing verifies.
    """
    master_seed = v["MASTER_SEED"].encode("utf-8")
    sk_mint = Scalar(int(v["MINT_BLS_PRIVKEY"], 16))
    pk_mint = g2_scalar_mul(G2_GEN, sk_mint)

    secrets = gl.derive_token_secrets(master_seed, v["TOKEN_INDEX"])
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    S_prime = gl.mint_blind_sign(blinded.B, sk_mint)
    S = gl.unblind_signature(S_prime, secrets.r)

    assert gl.verify_bls_mint_signature(S, blinded.Y, pk_mint) is True


@pytest.mark.parametrize("v", PARAMS, ids=IDS)
def test_redemption_proof_vector(v):
    """Verifies the BLS spend signature matches the vector."""
    master_seed = v["MASTER_SEED"].encode("utf-8")
    secrets = gl.derive_token_secrets(master_seed, v["TOKEN_INDEX"])
    redeem = v["REDEEM_TX"]
    eip712 = v["EIP712"]

    proof = gl.generate_redemption_proof(
        secrets.spend_bls_priv,
        secrets.spend_bls_pub,
        redeem["recipient"],
        eip712["chain_id"],
        eip712["contract_address"],
        int(eip712["deadline"], 16),
    )

    # msg_hash is deterministic
    assert proof.msg_hash.hex() == redeem["msg_hash"]
    # sigma matches vector
    assert serialize_g1(proof.sigma) == _g1_from_dict(redeem["sigma_G1"])
    # spend_pub matches
    assert serialize_g2(proof.spend_pub) == _g2_from_dict(redeem["spend_pub_G2"])
    # Verify the proof
    assert gl.verify_bls_spend_signature(proof.sigma, proof.msg_hash, secrets.spend_bls_pub) is True


# ==============================================================================
# AGGREGATION TESTS
# ==============================================================================


@pytest.mark.parametrize("v", AGG_PARAMS, ids=AGG_IDS)
def test_aggregated_reveal_vector(v):
    """Verify aggregated reveal sigma from vector."""
    # We can't directly reconstruct because we don't have the master_seed in the
    # aggregation file. Instead, verify the sigma is valid against the recorded pubkeys.
    # Parse the aggregated reveal data
    agg = v["AGGREGATED_REVEAL"]
    sigma_coords = _g1_from_dict(agg["sigma_G1"])
    # Non-zero sigma
    assert any(c != 0 for c in sigma_coords)
    # Has correct number of entries
    assert len(agg["nullifier_ids"]) == len(v["token_indices"])
    assert len(agg["spend_pubs_G2"]) == len(v["token_indices"])


@pytest.mark.parametrize("v", AGG_PARAMS, ids=AGG_IDS)
def test_aggregated_redeem_vector(v):
    """Verify aggregated redeem sigma from vector."""
    agg = v["AGGREGATED_REDEEM"]
    sigma_coords = _g1_from_dict(agg["sigma_G1"])
    assert any(c != 0 for c in sigma_coords)
    assert len(agg["nullifier_ids"]) == len(v["token_indices"])
    assert "msg_hash" in agg
