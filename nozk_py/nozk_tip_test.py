"""
Nozk Protocol: Full Lifecycle Smoke Test (.env enabled)

BLS12-381 standard scheme: PK=G1, Sig=G2.

Runs the complete protocol end-to-end using keys from .env, printing every
intermediate cryptographic value for cross-language comparison and debugging.

Modes:
    --mock      Run entirely off-chain using MockMint + MockRedeemer.
                No RPC, no gas, no contract — pure cryptographic verification.
                Tests the full lifecycle: derive -> blind -> sign -> unblind -> redeem.
                Also verifies double-spend rejection.

    (default)   Library-level verification only (verify_bls_mint_signature +
                verify_bls_spend_signature). Does not simulate the contract's redeem() flow.

Usage:
    uv run nozk_tip_test.py              # library-level verification
    uv run nozk_tip_test.py --mock       # full dry-run with mock mint + redeemer
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

import nozk_library as gl
from bls12_381_crypto import (
    CURVE_ORDER,
    Scalar,
    abi_encode_g1,
    g1_scalar_mul,
    G1_GEN,
    normalize,
    serialize_g1_sol,
    serialize_g2_sol,
)

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# ==============================================================================
# FORMATTING HELPERS
# ==============================================================================


def print_g1(name: str, point) -> None:
    from py_ecc.optimized_bls12_381 import normalize as norm

    n = norm(point)
    print(f"    {name} (x) : {hex(n[0].n)}")
    print(f"    {name} (y) : {hex(n[1].n)}")


def print_g2(name: str, point) -> None:
    from py_ecc.optimized_bls12_381 import normalize as norm

    n = norm(point)
    print(f"    {name} (x_c0) : {hex(n[0].coeffs[0])}")
    print(f"    {name} (x_c1) : {hex(n[0].coeffs[1])}")
    print(f"    {name} (y_c0) : {hex(n[1].coeffs[0])}")
    print(f"    {name} (y_c1) : {hex(n[1].coeffs[1])}")


# ==============================================================================
# MAIN
# ==============================================================================


def main() -> None:
    mock_mode = "--mock" in sys.argv

    mode_label = "MOCK DRY-RUN" if mock_mode else "LIBRARY VERIFICATION"
    print(f"NOZK PROTOCOL: FULL LIFECYCLE TEST ({mode_label})\n")

    # -- 0. Mint setup ---------------------------------------------------------
    print("[0] Loading Mint Configuration from .env...")
    sk_hex = os.getenv("MINT_BLS_PRIVKEY") or os.getenv("MINT_BLS_PRIVKEY_INT")
    if not sk_hex:
        raise ValueError("Missing MINT_BLS_PRIVKEY in .env. Run generate_keys.py first.")

    sk_mint = Scalar(int(sk_hex, 16) if sk_hex.startswith("0x") else int(sk_hex))
    pk_mint = g1_scalar_mul(G1_GEN, sk_mint)

    print("    Mint Keys loaded.")
    print_g1("PK_mint", pk_mint)

    if mock_mode:
        from mint_mock import MockMint
        from redeem_mock import MockRedeemer

        mock_mint = MockMint.from_sk(sk_mint)
        mock_redeemer = MockRedeemer(pk_mint=pk_mint)
        print("    MockMint + MockRedeemer initialized (no chain required).")
    print()

    # -- 1. Token derivation ---------------------------------------------------
    print("[1] Deriving Token Secrets (User's Wallet)...")
    master_seed_str = os.getenv("MASTER_SEED")
    if not master_seed_str:
        raise ValueError("Missing MASTER_SEED in .env.")

    master_seed = master_seed_str.encode("utf-8")
    token_index = 42

    secrets = gl.derive_token_secrets(master_seed, token_index)

    print(f"    Token Index        : {token_index}")
    print(f"    Nullifier ID       : {secrets.nullifier_id_hex}")
    print(f"    Deposit ID         : {secrets.deposit_id}")
    print(f"    Blinding scalar r  : {hex(secrets.r)}")
    print_g1("Spend PK (G1)", secrets.spend_bls_pub)
    print()

    # -- 2. Blinding -----------------------------------------------------------
    print("[2] Client Blinding the Token...")
    blinded = gl.blind_token(secrets.spend_bls_pub, secrets.r)

    print_g2("Y = H(spend_pub)", blinded.Y)
    print_g2("B = r*Y (blinded)", blinded.B)
    print(f"    Deposit ID (blind address) : {secrets.deposit_id}")
    print("    B + deposit_id sent to contract.\n")

    # -- 3. Blind signing ------------------------------------------------------
    print("[3] Mint blindly signing the point...")

    if mock_mode:
        S_prime = mock_mint.sign(blinded.B)
        print("    (MockMint -- no chain interaction)")
    else:
        S_prime = gl.mint_blind_sign(blinded.B, sk_mint)

    print_g2("S' = sk*B (blind sig)", S_prime)
    print("    S' announced on-chain.\n")

    # -- 4. Unblinding ---------------------------------------------------------
    print("[4] Client unblinding the signature...")
    S = gl.unblind_signature(S_prime, secrets.r)

    print_g2("S = S'*r^-1 (token)", S)
    print("    Valid token (spend_pub, S) obtained.\n")

    # -- 5. Redemption proof ---------------------------------------------------
    print("[5] Generating Redemption Proof (BLS Spend Signature)...")
    destination = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7"
    _TEST_CHAIN_ID = 11155111
    _TEST_CONTRACT = "0x00000000000000000000000000000000DeaDBeef"
    _TEST_DEADLINE = 2**256 - 1
    proof = gl.generate_redemption_proof(
        secrets.spend_chia_sk,
        secrets.spend_chia_pk,
        destination,
        _TEST_CHAIN_ID,
        _TEST_CONTRACT,
        _TEST_DEADLINE,
    )

    print(f"    Destination      : {destination}")
    print(f"    msg_hash         : {proof.msg_hash.hex()}")
    print(f"    sigma (G2, compressed) : {proof.sigma.to_bytes().hex()[:40]}...")
    print()

    # -- 6. Verification -------------------------------------------------------
    print("[6] Verification...")

    if mock_mode:
        print("    (MockRedeemer -- simulating reveal() + redeem() off-chain)\n")

        # Phase 1: Reveal (BLS mint pairing)
        print("    --- Phase 1: reveal() ---")
        reveal_result = mock_redeemer.reveal(
            spend_pub=secrets.spend_bls_pub,
            S=S,
        )

        print(f"    [BLS pairing]  {'PASS' if reveal_result.bls_pairing_ok else 'FAIL'}")
        print(f"    [Nullifier]    -> {'REVEALED' if reveal_result.success else 'FAILED'}")
        assert reveal_result.success, f"Mock reveal failed: {reveal_result.reason}"

        # Phase 2: Redeem (BLS spend signature)
        print("\n    --- Phase 2: redeem() ---")
        nid = secrets.nullifier_id.hex()
        result = mock_redeemer.redeem(
            recipient=destination,
            sigma=proof.sigma,
            spend_pk=proof.spend_pk,
            msg_hash=proof.msg_hash,
            nullifier_id=nid,
        )

        print(f"    [BLS spend sig] {'PASS' if result.bls_ok else 'FAIL'}")
        print(f"    [State check]   {'REVEALED -> SPENT' if result.success else 'FAILED'}")

        assert result.success, f"Mock redemption failed: {result.reason}"

        # Verify double-spend protection
        print("\n    [Double-spend test]")
        result2 = mock_redeemer.redeem(
            recipient=destination,
            sigma=proof.sigma,
            spend_pk=proof.spend_pk,
            msg_hash=proof.msg_hash,
            nullifier_id=nid,
        )
        assert not result2.success, "Double-spend should have been rejected!"
        assert result2.nullifier_spent is True
        print(f"    Double-spend correctly rejected: {result2.reason}")

        # Verify double-reveal protection
        print("\n    [Double-reveal test]")
        reveal2 = mock_redeemer.reveal(spend_pub=secrets.spend_bls_pub, S=S)
        assert not reveal2.success, "Double-reveal should have been rejected!"
        print(f"    Double-reveal correctly rejected: {reveal2.reason}")

        print("\nFULL MOCK DRY-RUN SUCCESS: All contract checks passed off-chain!")

    else:
        # Library-level verification only
        mint_ok = gl.verify_bls_mint_signature(S, blinded.Y, pk_mint)
        assert mint_ok, "BLS mint signature verification failed!"
        print("    BLS Mint Signature Verified!")

        spend_ok = gl.verify_bls_spend_signature(proof.sigma, proof.msg_hash, secrets.spend_chia_pk)
        assert spend_ok, "BLS spend signature verification failed!"
        print("    BLS Spend Signature Verified!")

        print("\nTRANSACTION SUCCESS: Protocol verified end-to-end!")


if __name__ == "__main__":
    main()
