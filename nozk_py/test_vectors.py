"""
Nozk Protocol: Parametrized Vector Tests (BLS12-381, standard scheme: PK=G1, Sig=G2)
"""

import json
from pathlib import Path

import pytest
from chia_rs import G1Element, G2Element

import nozk_library as gl
from bls12_381_crypto import (
    G1_GEN,
    Scalar,
    g1_scalar_mul,
    parse_g1_sol,
    parse_g2_sol,
    serialize_g1_sol,
    serialize_g2_sol,
)

VECTORS_DIR = Path(__file__).resolve().parent.parent / "test_vectors"


def load_all_vectors() -> list[tuple[str, dict]]:
    if not VECTORS_DIR.exists():
        pytest.skip("test_vectors/ not found")
        return []
    files = sorted(f for f in VECTORS_DIR.rglob("token_*.json") if f.parent != VECTORS_DIR)
    if not files:
        pytest.skip("test_vectors/ is empty")
    return [(f"{f.parent.name}/{f.stem}", json.loads(f.read_text())) for f in files]


def load_aggregation_vectors() -> list[tuple[str, dict]]:
    if not VECTORS_DIR.exists():
        return []
    files = sorted(VECTORS_DIR.rglob("aggregation.json"))
    return [(f.parent.name, json.loads(f.read_text())) for f in files] if files else []


ALL_VECTORS = load_all_vectors()
IDS = [v[0] for v in ALL_VECTORS]
PARAMS = [v[1] for v in ALL_VECTORS]

AGG_VECTORS = load_aggregation_vectors()
AGG_IDS = [v[0] for v in AGG_VECTORS]
AGG_PARAMS = [v[1] for v in AGG_VECTORS]


def _g1_from_dict(d: dict) -> tuple[int, int, int, int]:
    return (int(d["x_hi"], 16), int(d["x_lo"], 16), int(d["y_hi"], 16), int(d["y_lo"], 16))


def _g2_from_dict(d: dict) -> tuple[int, int, int, int, int, int, int, int]:
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
# PER-TOKEN TESTS
# ==============================================================================


@pytest.mark.parametrize("v", PARAMS, ids=IDS)
def test_mint_pk_vector(v):
    sk = Scalar(int(v["MINT_BLS_PRIVKEY"], 16))
    pk = g1_scalar_mul(G1_GEN, sk)
    assert serialize_g1_sol(pk) == _g1_from_dict(v["PK_MINT"])


@pytest.mark.parametrize("v", PARAMS, ids=IDS)
def test_derive_token_secrets_vector(v):
    master_seed = v["MASTER_SEED"].encode("utf-8")
    secrets = gl.derive_token_secrets(master_seed, v["TOKEN_INDEX"])
    assert secrets.nullifier_id.hex() == v["SPEND_BLS"]["nullifier_id"]
    assert f"0x{secrets.r:064x}" == v["BLIND_KEYPAIR"]["r"]
    assert secrets.deposit_id == v["DEPOSIT_ID"]


@pytest.mark.parametrize("v", PARAMS, ids=IDS)
def test_spend_bls_pub_vector(v):
    master_seed = v["MASTER_SEED"].encode("utf-8")
    secrets = gl.derive_token_secrets(master_seed, v["TOKEN_INDEX"])
    assert serialize_g1_sol(secrets.spend_bls_pub) == _g1_from_dict(v["SPEND_BLS"]["pub_G1"])
    assert secrets.spend_chia_pk.to_bytes().hex() == v["SPEND_BLS"]["pub_compressed"]


@pytest.mark.parametrize("v", PARAMS, ids=IDS)
def test_blind_token_vector(v):
    master_seed = v["MASTER_SEED"].encode("utf-8")
    secrets = gl.derive_token_secrets(master_seed, v["TOKEN_INDEX"])
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    assert serialize_g2_sol(blinded.Y) == _g2_from_dict(v["Y_HASH_TO_CURVE"])
    assert serialize_g2_sol(blinded.B) == _g2_from_dict(v["B_BLINDED"])


@pytest.mark.parametrize("v", PARAMS, ids=IDS)
def test_mint_blind_sign_vector(v):
    master_seed = v["MASTER_SEED"].encode("utf-8")
    secrets = gl.derive_token_secrets(master_seed, v["TOKEN_INDEX"])
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    sk = Scalar(int(v["MINT_BLS_PRIVKEY"], 16))
    S_prime = gl.mint_blind_sign(blinded.B, sk)
    assert serialize_g2_sol(S_prime) == _g2_from_dict(v["S_PRIME"])


@pytest.mark.parametrize("v", PARAMS, ids=IDS)
def test_unblind_signature_vector(v):
    master_seed = v["MASTER_SEED"].encode("utf-8")
    secrets = gl.derive_token_secrets(master_seed, v["TOKEN_INDEX"])
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    sk = Scalar(int(v["MINT_BLS_PRIVKEY"], 16))
    S_prime = gl.mint_blind_sign(blinded.B, sk)
    S = gl.unblind_signature(S_prime, secrets.r)
    assert serialize_g2_sol(S) == _g2_from_dict(v["S_UNBLINDED"])


@pytest.mark.parametrize("v", PARAMS, ids=IDS)
def test_full_lifecycle_vector(v):
    master_seed = v["MASTER_SEED"].encode("utf-8")
    sk = Scalar(int(v["MINT_BLS_PRIVKEY"], 16))
    pk = g1_scalar_mul(G1_GEN, sk)
    secrets = gl.derive_token_secrets(master_seed, v["TOKEN_INDEX"])
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    S_prime = gl.mint_blind_sign(blinded.B, sk)
    S = gl.unblind_signature(S_prime, secrets.r)
    assert gl.verify_bls_mint_signature(S, blinded.Y, pk) is True


@pytest.mark.parametrize("v", PARAMS, ids=IDS)
def test_redemption_proof_vector(v):
    master_seed = v["MASTER_SEED"].encode("utf-8")
    secrets = gl.derive_token_secrets(master_seed, v["TOKEN_INDEX"])
    redeem = v["REDEEM_TX"]
    eip712 = v["EIP712"]

    proof = gl.generate_redemption_proof(
        secrets.spend_chia_sk,
        secrets.spend_chia_pk,
        redeem["recipient"],
        eip712["chain_id"],
        eip712["contract_address"],
        int(eip712["deadline"], 16),
    )

    assert proof.msg_hash.hex() == redeem["msg_hash"]
    assert proof.sigma.to_bytes().hex() == redeem["sigma_compressed"]
    assert proof.spend_pk.to_bytes().hex() == redeem["spend_pub_compressed"]
    assert gl.verify_bls_spend_signature(proof.sigma, proof.msg_hash, secrets.spend_chia_pk) is True


# ==============================================================================
# AGGREGATION TESTS
# ==============================================================================


@pytest.mark.parametrize("v", AGG_PARAMS, ids=AGG_IDS)
def test_aggregated_reveal_vector(v):
    """Verify aggregated reveal pairing check against recorded sigma + pubkeys."""
    agg = v["AGGREGATED_REVEAL"]
    sigma = parse_g2_sol(*_g2_from_dict(agg["sigma_G2"]))
    spend_pubs = [parse_g1_sol(*_g1_from_dict(p)) for p in agg["spend_pubs_G1"]]
    pk_mint = parse_g1_sol(*_g1_from_dict(agg["pk_mint_G1"]))
    assert gl.verify_aggregated_reveal(sigma, spend_pubs, pk_mint) is True


@pytest.mark.parametrize("v", AGG_PARAMS, ids=AGG_IDS)
def test_aggregated_redeem_vector(v):
    """Verify aggregated redeem signature against recorded msg_hash + spend pubkeys."""
    agg = v["AGGREGATED_REDEEM"]
    sigma = G2Element.from_bytes(bytes.fromhex(agg["sigma_compressed"]))
    spend_pks = [G1Element.from_bytes(bytes.fromhex(pk)) for pk in agg["spend_pubs_compressed"]]
    msg_hash = bytes.fromhex(agg["msg_hash"])
    assert gl.verify_aggregated_redeem(sigma, msg_hash, spend_pks) is True
