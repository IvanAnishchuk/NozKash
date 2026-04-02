"""
Nozk Protocol: Test Vector Generator

Generates cryptographic test vectors covering the full protocol lifecycle
for multiple (mint keypair, token index) combinations. Each vector file is
a self-contained JSON snapshot of every intermediate value produced during
one run of the protocol, suitable for cross-language parity testing.

Output layout (writes to repo-root ``test_vectors/`` by default):
    test_vectors/
        manifest.json                          — lists keypair dirs + indices
        <seed_prefix>_<sk_prefix>/
            token_<index>.json                 — one file per token index tested

Usage:
    uv run generate_vectors.py                   # default: 3 keypairs × 6 indices
    uv run generate_vectors.py --keypairs 5 --indices 0 1 2 100 255 256 1000
"""

import argparse
import json
import os
from pathlib import Path

from py_ecc.bn128 import G2, curve_order

import nozk_library as gl
from nozk_library import G2Point, Scalar, _mul_g2

VECTORS_DIR = Path(__file__).resolve().parent.parent / "test_vectors"


def compute_vector(master_seed_hex: str, sk_int: int, token_index: int) -> dict:
    """
    Runs the full protocol for one (seed, keypair, token_index) combination
    and returns a dict containing every intermediate value.

    Vector format:

    Inputs:
        MASTER_SEED         hex seed string
        TOKEN_INDEX         integer
        MINT_BLS_PRIVKEY    hex BLS scalar

    Mint public key (G2, py_ecc FQ2 coordinate order):
        PK_MINT.{X_real, X_imag, Y_real, Y_imag}

    Spend keypair (nullifier identity):
        SPEND_KEYPAIR.priv      hex private key bytes
        SPEND_KEYPAIR.pub       hex uncompressed public key (0x04...)
        SPEND_KEYPAIR.address   0x-prefixed Ethereum address (the nullifier)

    Blind keypair (deposit identity + BLS blinding factor):
        BLIND_KEYPAIR.priv      hex private key bytes
        BLIND_KEYPAIR.pub       hex uncompressed public key (0x04...)
        BLIND_KEYPAIR.address   0x-prefixed Ethereum address (the deposit ID)
        BLIND_KEYPAIR.r         hex BLS scalar = int(priv) % curve_order

    BLS protocol intermediates:
        Y_HASH_TO_CURVE.{X, Y}  H(spend_address) on BN254 G1
        B_BLINDED.{X, Y}        r·Y — sent to mint
        S_PRIME.{X, Y}          sk·B — mint's blind signature
        S_UNBLINDED.{X, Y}      S'·r⁻¹ — the final token signature
    """
    master_seed_bytes = master_seed_hex.encode("utf-8")

    # --- Mint public key ---
    sk = Scalar(sk_int)
    pk_g2 = _mul_g2(G2Point(G2), sk)

    # --- Client secrets (both keypairs) ---
    secrets = gl.derive_token_secrets(master_seed_bytes, token_index)

    # --- BLS protocol ---
    blinded = gl.blind_token(secrets.spend_address_bytes, secrets.r)
    S_prime = gl.mint_blind_sign(blinded.B, sk)
    S = gl.unblind_signature(S_prime, secrets.r)

    # ── MEV protection proof (EIP-712) ────────────────────────────────────────
    # The redemption proof binds the token to a fixed test recipient address.
    # In production any recipient address can be used; the test address is fixed
    # so vectors are deterministic and cross-language comparable.
    # EIP-712 domain params are also fixed for reproducible vectors.
    test_recipient = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7"
    test_chain_id = 11155111  # Ethereum Sepolia
    test_contract = "0x00000000000000000000000000000000DeaDBeef"
    test_deadline = 2**256 - 1
    proof = gl.generate_redemption_proof(
        secrets.spend_priv,
        test_recipient,
        test_chain_id,
        test_contract,
        test_deadline,
    )

    s_x, s_y = gl.serialize_g1(S)

    return {
        # ── Inputs ────────────────────────────────────────────────────────────
        "MASTER_SEED": master_seed_hex,
        "TOKEN_INDEX": token_index,
        "MINT_BLS_PRIVKEY": hex(sk_int),
        "RECIPIENT": test_recipient,
        # ── Mint public key (G2) ──────────────────────────────────────────────
        "PK_MINT": {
            "X_real": hex(pk_g2[0].coeffs[0].n)[2:],
            "X_imag": hex(pk_g2[0].coeffs[1].n)[2:],
            "Y_real": hex(pk_g2[1].coeffs[0].n)[2:],
            "Y_imag": hex(pk_g2[1].coeffs[1].n)[2:],
        },
        # ── Spend keypair (nullifier) ─────────────────────────────────────────
        # The spend address is the nullifier — revealed at redemption.
        # The private key signs the anti-MEV payload.
        "SPEND_KEYPAIR": {
            "priv": secrets.spend.priv.to_bytes().hex(),
            "pub": secrets.spend.pub_hex,
            "address": secrets.spend.address,
        },
        # ── Blind keypair (deposit ID + blinding factor) ──────────────────────
        # The blind address is the deposit ID — submitted with the deposit tx.
        # The private key as a BN254 scalar is the blinding factor r.
        "BLIND_KEYPAIR": {
            "priv": secrets.blind.priv.to_bytes().hex(),
            "pub": secrets.blind.pub_hex,
            "address": secrets.blind.address,
            "r": hex(secrets.r),
        },
        # ── BLS protocol intermediates ────────────────────────────────────────
        "Y_HASH_TO_CURVE": {
            "X": hex(blinded.Y[0].n)[2:],
            "Y": hex(blinded.Y[1].n)[2:],
        },
        "B_BLINDED": {
            "X": hex(blinded.B[0].n)[2:],
            "Y": hex(blinded.B[1].n)[2:],
        },
        "S_PRIME": {
            "X": hex(S_prime[0].n)[2:],
            "Y": hex(S_prime[1].n)[2:],
        },
        "S_UNBLINDED": {
            "X": hex(S[0].n)[2:],
            "Y": hex(S[1].n)[2:],
        },
        # ── EIP-712 domain parameters (fixed for deterministic vectors) ──────
        "EIP712": {
            "domain_name": "NozkVault",
            "domain_version": "1",
            "chain_id": test_chain_id,
            "contract_address": test_contract,
            "deadline": hex(test_deadline),
        },
        # ── Redemption transaction (what the client submits on-chain) ─────────
        # redeem(recipient, spendSignature, nullifier, deadline, unblindedSignatureS)
        # spendSignature = r(32) || s(32) || v(1) where v = recovery_bit + 27
        "REDEEM_TX": {
            # Arguments to NozkVault.redeem()
            "recipient": test_recipient,
            "deadline": hex(test_deadline),
            "S_x": hex(s_x),  # uint256 — 0x-prefixed hex
            "S_y": hex(s_y),  # uint256
            # MEV protection signature — EIP-712 typed data hash
            "msg_hash": proof.msg_hash.hex(),
            "compact_hex": proof.compact_hex,  # 128 hex chars: r(32) + s(32)
            "recovery_bit": proof.recovery_bit,  # 0 or 1; v = recovery_bit + 27
            # Full 65-byte spend signature as submitted to the contract
            "spend_signature": (
                proof.compact_hex[:64]  # r (32 bytes)
                + proof.compact_hex[64:]  # s (32 bytes)
                + format(proof.recovery_bit + 27, "02x")  # v (1 byte)
            ),
        },
    }


def generate_keypair() -> tuple[str, int]:
    """Returns (master_seed_hex, sk_int) as fresh random material."""
    master_seed_hex = os.urandom(32).hex()
    sk_int = int.from_bytes(os.urandom(32), "big") % curve_order
    return master_seed_hex, sk_int


def write_vector(vector: dict, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"token_{vector['TOKEN_INDEX']}.json"
    path.write_text(json.dumps(vector, indent=2))
    return path


def main():
    parser = argparse.ArgumentParser(description="Generate Nozk protocol test vectors")
    parser.add_argument(
        "--keypairs",
        type=int,
        default=3,
        help="Number of random (seed, mint keypair) combinations to generate (default: 3)",
    )
    parser.add_argument(
        "--indices",
        type=int,
        nargs="+",
        default=[0, 1, 42, 255, 256, 1000],
        help="Token indices to generate per keypair (default: 0 1 42 255 256 1000)",
    )
    parser.add_argument("--out", type=Path, default=VECTORS_DIR, help=f"Output directory (default: {VECTORS_DIR})")
    args = parser.parse_args()

    indices = sorted(set(args.indices))
    out_dir = args.out

    # Clean stale keypair directories (but not manifest.json or other non-dir entries)
    if out_dir.exists():
        for child in list(out_dir.iterdir()):
            if child.is_dir():
                import shutil

                shutil.rmtree(child)

    print(
        f"Generating {args.keypairs} keypair(s) × {len(indices)} index/indices "
        f"= {args.keypairs * len(indices)} vector files\n"
    )

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

    # Write manifest so consumers (e.g. Foundry tests) can discover all keypair suites.
    manifest = {
        "eip712_domain_name": "NozkVault",
        "eip712_domain_version": "1",
        "chain_id": 11155111,
        "contract_address": "0x00000000000000000000000000000000DeaDBeef",
        "recipient": "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7",
        "deadline": hex(2**256 - 1),
        "keypairs": keypair_dirs,
        "indices": indices,
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))

    print(f"\n✅ {total} vector files written to {out_dir}/")
    print(f"   manifest: {manifest_path}")


if __name__ == "__main__":
    main()
