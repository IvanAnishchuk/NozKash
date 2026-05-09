"""
Nozk Protocol: Test Vector Generator (BLS12-381, standard scheme: PK=G1, Sig=G2)

Usage:
    uv run generate_vectors.py
    uv run generate_vectors.py --keypairs 5 --indices 0 1 2 100 255 256 1000
"""

import argparse
import json
import os
from pathlib import Path

import nozk_library as gl
from bls12_381_crypto import (
    CURVE_ORDER,
    G1_GEN,
    Scalar,
    g1_scalar_mul,
    serialize_g1_sol,
    serialize_g2_sol,
)
from py_ecc.bls.g2_primitives import signature_to_G2

VECTORS_DIR = Path(__file__).resolve().parent.parent / "test_vectors"

TEST_RECIPIENT = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7"
TEST_CHAIN_ID = 11155111
TEST_CONTRACT = "0x00000000000000000000000000000000DeaDBeef"
TEST_DEADLINE = 2**256 - 1


def _g1_to_dict(coords: tuple[int, int, int, int]) -> dict:
    return {
        "x_hi": f"0x{coords[0]:032x}",
        "x_lo": f"0x{coords[1]:064x}",
        "y_hi": f"0x{coords[2]:032x}",
        "y_lo": f"0x{coords[3]:064x}",
    }


def _g2_to_dict(coords: tuple[int, int, int, int, int, int, int, int]) -> dict:
    return {
        "x_c0_hi": f"0x{coords[0]:032x}",
        "x_c0_lo": f"0x{coords[1]:064x}",
        "x_c1_hi": f"0x{coords[2]:032x}",
        "x_c1_lo": f"0x{coords[3]:064x}",
        "y_c0_hi": f"0x{coords[4]:032x}",
        "y_c0_lo": f"0x{coords[5]:064x}",
        "y_c1_hi": f"0x{coords[6]:032x}",
        "y_c1_lo": f"0x{coords[7]:064x}",
    }


def compute_vector(master_seed_hex: str, sk_int: int, token_index: int) -> dict:
    master_seed_bytes = master_seed_hex.encode("utf-8")
    sk = Scalar(sk_int)
    pk_g1 = g1_scalar_mul(G1_GEN, sk)

    secrets = gl.derive_token_secrets(master_seed_bytes, token_index)
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
    S_prime = gl.mint_blind_sign(blinded.B, sk)
    S = gl.unblind_signature(S_prime, secrets.r)

    proof = gl.generate_redemption_proof(
        secrets.spend_chia_sk,
        secrets.spend_chia_pk,
        TEST_RECIPIENT,
        TEST_CHAIN_ID,
        TEST_CONTRACT,
        TEST_DEADLINE,
    )

    return {
        "MASTER_SEED": master_seed_hex,
        "TOKEN_INDEX": token_index,
        "MINT_BLS_PRIVKEY": hex(sk_int),
        "RECIPIENT": TEST_RECIPIENT,
        # Mint PK is now G1 (4 uint256)
        "PK_MINT": _g1_to_dict(serialize_g1_sol(pk_g1)),
        # Spend key: G1 pubkey (nullifier) + chia compressed
        "SPEND_BLS": {
            "priv": hex(secrets.spend_bls_priv),
            "pub_G1": _g1_to_dict(serialize_g1_sol(secrets.spend_bls_pub)),
            "pub_compressed": secrets.spend_chia_pk.to_bytes().hex(),
            "nullifier_id": secrets.nullifier_id.hex(),
        },
        "BLIND_KEYPAIR": {
            "priv": secrets.deposit_blind_keypair.priv.to_bytes().hex(),
            "pub": secrets.deposit_blind_keypair.pub_hex,
            "address": secrets.deposit_blind_keypair.address,
            "r": hex(secrets.r),
        },
        "DEPOSIT_ID": secrets.deposit_id,
        # Protocol intermediates: Y and B are G2 (8 uint256), S' and S are G2
        "Y_HASH_TO_CURVE": _g2_to_dict(serialize_g2_sol(blinded.Y)),
        "B_BLINDED": _g2_to_dict(serialize_g2_sol(blinded.B)),
        "S_PRIME": _g2_to_dict(serialize_g2_sol(S_prime)),
        "S_UNBLINDED": _g2_to_dict(serialize_g2_sol(S)),
        "EIP712": {
            "domain_name": "NozkVault",
            "domain_version": "1",
            "chain_id": TEST_CHAIN_ID,
            "contract_address": TEST_CONTRACT,
            "deadline": hex(TEST_DEADLINE),
        },
        # Spend signature: compressed + uncompressed G2 for Solidity
        "REDEEM_TX": {
            "recipient": TEST_RECIPIENT,
            "deadline": hex(TEST_DEADLINE),
            "msg_hash": proof.msg_hash.hex(),
            "sigma_compressed": proof.sigma.to_bytes().hex(),
            "sigma_G2": _g2_to_dict(serialize_g2_sol(signature_to_G2(proof.sigma.to_bytes()))),
            "spend_pub_compressed": proof.spend_pk.to_bytes().hex(),
        },
        "REVEAL_TX": {
            "spend_pub_G1": _g1_to_dict(serialize_g1_sol(secrets.spend_bls_pub)),
            "S_G2": _g2_to_dict(serialize_g2_sol(S)),
            "nullifier_id": secrets.nullifier_id.hex(),
        },
    }


def compute_aggregation_vectors(master_seed_hex: str, sk_int: int, indices: list[int]) -> dict:
    master_seed_bytes = master_seed_hex.encode("utf-8")
    sk = Scalar(sk_int)
    pk_mint = g1_scalar_mul(G1_GEN, sk)

    unblinded_sigs = []
    spend_pubs_g1 = []
    nullifier_ids = []
    spend_sigs_chia = []
    spend_pks_chia = []

    msg_hash = gl.eip712_redemption_hash(TEST_RECIPIENT, TEST_DEADLINE, TEST_CHAIN_ID, TEST_CONTRACT)

    for idx in indices:
        secrets = gl.derive_token_secrets(master_seed_bytes, idx)
        blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)
        s_prime = gl.mint_blind_sign(blinded.B, sk)
        s = gl.unblind_signature(s_prime, secrets.r)
        unblinded_sigs.append(s)
        spend_pubs_g1.append(secrets.spend_bls_pub)
        nullifier_ids.append(secrets.nullifier_id.hex())

        proof = gl.generate_redemption_proof(
            secrets.spend_chia_sk,
            secrets.spend_chia_pk,
            TEST_RECIPIENT,
            TEST_CHAIN_ID,
            TEST_CONTRACT,
            TEST_DEADLINE,
        )
        spend_sigs_chia.append(proof.sigma)
        spend_pks_chia.append(secrets.spend_chia_pk)

    reveal_sigma = gl.aggregate_reveal_sigma(unblinded_sigs)
    redeem_sigma = gl.aggregate_redeem_sigma(spend_sigs_chia)

    return {
        "token_indices": indices,
        "AGGREGATED_REVEAL": {
            "sigma_G2": _g2_to_dict(serialize_g2_sol(reveal_sigma)),
            "nullifier_ids": nullifier_ids,
            "spend_pubs_G1": [_g1_to_dict(serialize_g1_sol(p)) for p in spend_pubs_g1],
            "pk_mint_G1": _g1_to_dict(serialize_g1_sol(pk_mint)),
        },
        "AGGREGATED_REDEEM": {
            "sigma_compressed": redeem_sigma.to_bytes().hex(),
            "sigma_G2": _g2_to_dict(serialize_g2_sol(signature_to_G2(redeem_sigma.to_bytes()))),
            "nullifier_ids": nullifier_ids,
            "spend_pubs_compressed": [pk.to_bytes().hex() for pk in spend_pks_chia],
            "spend_pubs_G1": [_g1_to_dict(serialize_g1_sol(p)) for p in spend_pubs_g1],
            "msg_hash": msg_hash.hex(),
            "recipient": TEST_RECIPIENT,
            "deadline": hex(TEST_DEADLINE),
        },
    }


def generate_keypair() -> tuple[str, int]:
    master_seed_hex = os.urandom(32).hex()
    sk_int = int.from_bytes(os.urandom(32), "big") % CURVE_ORDER
    return master_seed_hex, sk_int


def write_vector(vector: dict, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"token_{vector['TOKEN_INDEX']}.json"
    path.write_text(json.dumps(vector, indent=2))
    return path


def main():
    parser = argparse.ArgumentParser(description="Generate Nozk test vectors (BLS12-381)")
    parser.add_argument("--keypairs", type=int, default=3)
    parser.add_argument("--indices", type=int, nargs="+", default=[0, 1, 42, 255, 256, 1000])
    parser.add_argument("--out", type=Path, default=VECTORS_DIR)
    args = parser.parse_args()

    indices = sorted(set(args.indices))
    out_dir = args.out

    if out_dir.exists():
        for child in list(out_dir.iterdir()):
            if child.is_dir():
                import shutil

                shutil.rmtree(child)

    print(f"Generating {args.keypairs} keypair(s) × {len(indices)} indices = {args.keypairs * len(indices)} vectors\n")

    keypair_dirs: list[str] = []
    total = 0
    for kp_num in range(1, args.keypairs + 1):
        master_seed_hex, sk_int = generate_keypair()
        seed_prefix = master_seed_hex[:8]
        sk_prefix = hex(sk_int)[-8:]
        kp_name = f"{seed_prefix}_{sk_prefix}"
        kp_dir = out_dir / kp_name
        keypair_dirs.append(kp_name)

        print(f"[{kp_num}/{args.keypairs}] seed={seed_prefix}...  sk=...{sk_prefix}")

        for idx in indices:
            vector = compute_vector(master_seed_hex, sk_int, idx)
            path = write_vector(vector, kp_dir)
            print(f"    token_{idx:>5}  →  {path}")
            total += 1

        agg_indices = indices[:3] if len(indices) >= 3 else indices
        agg = compute_aggregation_vectors(master_seed_hex, sk_int, agg_indices)
        agg_path = kp_dir / "aggregation.json"
        agg_path.write_text(json.dumps(agg, indent=2))
        print(f"    aggregation  →  {agg_path}")

    manifest = {
        "curve": "BLS12-381",
        "scheme": "standard (PK=G1, Sig=G2)",
        "eip712_domain_name": "NozkVault",
        "eip712_domain_version": "1",
        "chain_id": TEST_CHAIN_ID,
        "contract_address": TEST_CONTRACT,
        "recipient": TEST_RECIPIENT,
        "deadline": hex(TEST_DEADLINE),
        "keypairs": keypair_dirs,
        "indices": indices,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\n✅ {total} vectors written to {out_dir}/")


if __name__ == "__main__":
    main()
