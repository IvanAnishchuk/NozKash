"""
Nozk Protocol: Mock Redeemer (On-Chain Verification Simulator)

Simulates the NozkVault reveal() + redeem() smart contract flow off-chain.

Two-phase flow (matches on-chain architecture):
    reveal(nullifier, S):
        1. Parse S as a BN254 G1 point
        2. Y = hashToCurve(nullifier)
        3. ecPairing(S, G2, Y, PK_mint) → BLS verification
        4. Register nullifier as REVEALED (with denomination)

    redeem(recipient, spendSignature, nullifier, deadline):
        1. ecrecover(msg_hash, spendSignature) → nullifier address
        2. Check nullifier is REVEALED (not UNREVEALED or SPENT)
        3. Mark SPENT, transfer 0.001 ETH (mock: just records success)

Library usage:
    from redeem_mock import MockRedeemer

    redeemer = MockRedeemer(pk_mint=pk_g2_point)
    redeemer.reveal(nullifier="0x...", unblinded_s_x=sx, unblinded_s_y=sy)
    result = redeemer.redeem(
        recipient="0xRecipient...",
        spend_signature_bytes=sig_65_bytes,
    )

CLI usage (replaces on-chain redeem with full verification):
    uv run redeem_mock.py verify --index 0 --to 0xRecipient
    uv run redeem_mock.py verify --index 0 --to 0xRecipient --verbosity verbose

All operations are pure — no network, no gas. The CLI reads wallet state and
MASTER_SEED from .env to reconstruct the redemption payload, then verifies it.
"""

import os
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Annotated, Optional

import typer
from dotenv import load_dotenv
from py_ecc.bn128 import G2 as G2_gen
from rich.panel import Panel
from rich.rule import Rule
from rich.text import Text

from nozk_library import (
    G2Point,
    InvalidPointError,
    NozkError,
    Scalar,
    _mul_g2,
    derive_token_secrets,
    generate_redemption_proof,
    hash_to_curve,
    parse_g1,
    verify_bls_pairing,
    verify_ecdsa_mev_protection,
)
from nozk_theme import make_console
from wallet_state import load_wallet_state, save_wallet_state, short_hex

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


# ==============================================================================
# MOCK REDEEMER LIBRARY
# ==============================================================================


class MockRedeemError(NozkError):
    """Raised for mock redeemer configuration errors."""


@dataclass
class RedeemResult:
    """Result of a mock redemption attempt."""

    success: bool
    nullifier: Optional[str] = None
    recipient: Optional[str] = None
    reason: Optional[str] = None

    # Intermediate values for debugging
    ecrecover_address: Optional[str] = None
    bls_pairing_ok: Optional[bool] = None
    ecdsa_ok: Optional[bool] = None
    nullifier_spent: Optional[bool] = None

    def __str__(self) -> str:
        if self.success:
            return (
                f"✅ REDEEM SUCCESS\n"
                f"  Nullifier:  {self.nullifier}\n"
                f"  Recipient:  {self.recipient}\n"
                f"  ECDSA:      {'✅' if self.ecdsa_ok else '❌'}\n"
                f"  BLS:        {'✅' if self.bls_pairing_ok else '❌'}"
            )
        return (
            f"❌ REDEEM FAILED\n"
            f"  Reason:     {self.reason}\n"
            f"  Nullifier:  {self.nullifier or 'unknown'}\n"
            f"  ECDSA:      {self.ecdsa_ok}\n"
            f"  BLS:        {self.bls_pairing_ok}"
        )


class NullifierState(Enum):
    UNREVEALED = "UNREVEALED"
    REVEALED = "REVEALED"
    SPENT = "SPENT"


@dataclass
class RevealResult:
    """Result of a mock reveal attempt."""

    success: bool
    nullifier: Optional[str] = None
    bls_pairing_ok: Optional[bool] = None
    reason: Optional[str] = None


@dataclass
class MockRedeemer:
    """
    Off-chain simulation of NozkVault reveal() + redeem().

    Maintains an in-memory mapping of nullifier states, matching the
    contract's NullifierState enum (UNREVEALED → REVEALED → SPENT).
    """

    pk_mint: G2Point
    nullifier_states: dict[str, NullifierState] = field(default_factory=dict)

    # ── Constructors ──────────────────────────────────────────────────────

    @classmethod
    def from_sk(cls, sk_int: int) -> "MockRedeemer":
        """Derive PK_mint from the scalar and create a redeemer."""
        pk = _mul_g2(G2Point(G2_gen), Scalar(sk_int))
        return cls(pk_mint=pk)

    @classmethod
    def from_env(cls) -> "MockRedeemer":
        """Load the mint scalar from .env and derive PK_mint."""
        sk_hex = os.getenv("MINT_BLS_PRIVKEY")
        sk_int_str = os.getenv("MINT_BLS_PRIVKEY_INT")

        if sk_hex:
            sk = int(sk_hex, 16) if sk_hex.startswith("0x") else int(sk_hex)
        elif sk_int_str:
            sk = int(sk_int_str, 16) if sk_int_str.startswith("0x") else int(sk_int_str)
        else:
            raise MockRedeemError("Missing MINT_BLS_PRIVKEY or MINT_BLS_PRIVKEY_INT in environment.")
        return cls.from_sk(sk)

    # ── Reveal (BLS verification) ─────────────────────────────────────────

    def reveal(
        self,
        nullifier: str,
        unblinded_s_x: int,
        unblinded_s_y: int,
    ) -> RevealResult:
        """
        Simulate NozkVault.reveal() — BLS pairing verification.

        Verifies e(S, G2) == e(H(nullifier), PK_mint) and registers
        the nullifier as REVEALED.
        """
        result = RevealResult(success=False, nullifier=nullifier)
        nullifier_lower = nullifier.lower()

        state = self.nullifier_states.get(nullifier_lower, NullifierState.UNREVEALED)
        if state != NullifierState.UNREVEALED:
            result.reason = f"Nullifier already {state.value}"
            return result

        try:
            S = parse_g1(unblinded_s_x, unblinded_s_y)
        except InvalidPointError as exc:
            result.reason = f"Unblinded signature S is not on BN254 G1: {exc}"
            return result

        nullifier_bytes = bytes.fromhex(nullifier[2:])
        Y = hash_to_curve(nullifier_bytes)

        result.bls_pairing_ok = verify_bls_pairing(S, Y, self.pk_mint)
        if not result.bls_pairing_ok:
            result.reason = "BLS pairing check failed: e(S, G2) != e(Y, PK_mint)"
            return result

        self.nullifier_states[nullifier_lower] = NullifierState.REVEALED
        result.success = True
        return result

    # ── Redeem (ECDSA verification) ───────────────────────────────────────

    def redeem(
        self,
        recipient: str,
        spend_signature_bytes: bytes,
        chain_id: int = 11155111,
        contract_address: str = "",
        deadline: int = 2**256 - 1,
    ) -> RedeemResult:
        """
        Simulate NozkVault.redeem() — ECDSA verification only.

        BLS was already verified in reveal(). This checks:
        1. ecrecover → nullifier address
        2. ECDSA binding verification
        3. Nullifier must be in REVEALED state
        4. Mark as SPENT
        """
        result = RedeemResult(success=False, recipient=recipient)

        if len(spend_signature_bytes) != 65:
            result.reason = f"Spend signature must be 65 bytes, got {len(spend_signature_bytes)}"
            return result

        from eth_keys import keys

        from nozk_library import eip712_redemption_hash

        msg_hash = eip712_redemption_hash(recipient, deadline, chain_id, contract_address)

        r_bytes = spend_signature_bytes[:32]
        s_bytes = spend_signature_bytes[32:64]
        v_byte = spend_signature_bytes[64]

        if v_byte not in (27, 28):
            result.reason = f"Invalid v byte: {v_byte} (expected 27 or 28)"
            return result

        recovery_bit = v_byte - 27
        compact_hex = r_bytes.hex() + s_bytes.hex()

        try:
            r_int = int.from_bytes(r_bytes, "big")
            s_int = int.from_bytes(s_bytes, "big")
            sig = keys.Signature(vrs=(recovery_bit, r_int, s_int))
            recovered_pubkey = sig.recover_public_key_from_msg_hash(msg_hash)
            nullifier = recovered_pubkey.to_address()
        except Exception as exc:
            result.reason = f"ecrecover failed: {exc}"
            return result

        result.nullifier = nullifier
        result.ecrecover_address = nullifier

        result.ecdsa_ok = verify_ecdsa_mev_protection(
            msg_hash,
            compact_hex,
            recovery_bit,
            nullifier,
        )
        if not result.ecdsa_ok:
            result.reason = "ECDSA verification failed (ecrecover address mismatch)"
            return result

        nullifier_lower = nullifier.lower()
        state = self.nullifier_states.get(nullifier_lower, NullifierState.UNREVEALED)
        if state == NullifierState.SPENT:
            result.nullifier_spent = True
            result.reason = f"Token already spent (nullifier {nullifier})"
            return result
        if state != NullifierState.REVEALED:
            result.nullifier_spent = False
            result.reason = f"Nullifier not revealed (state: {state.value})"
            return result
        result.nullifier_spent = False

        self.nullifier_states[nullifier_lower] = NullifierState.SPENT
        result.success = True
        return result

    # ── State queries ─────────────────────────────────────────────────────

    def get_state(self, nullifier: str) -> NullifierState:
        return self.nullifier_states.get(nullifier.lower(), NullifierState.UNREVEALED)

    def is_spent(self, nullifier: str) -> bool:
        return self.get_state(nullifier) == NullifierState.SPENT

    def is_revealed(self, nullifier: str) -> bool:
        return self.get_state(nullifier) == NullifierState.REVEALED

    def reset(self) -> None:
        self.nullifier_states.clear()


# ==============================================================================
# CLI — reads wallet state, builds redeem payload, verifies everything
# ==============================================================================

console = make_console()


class Verbosity(str, Enum):
    quiet = "quiet"
    normal = "normal"
    verbose = "verbose"


def _encode_spend_signature(compact_hex: str, recovery_bit: int) -> bytes:
    """Encode compact_hex + recovery_bit into the 65-byte format the contract expects."""
    r_bytes = bytes.fromhex(compact_hex[:64])
    s_bytes = bytes.fromhex(compact_hex[64:])
    v_byte = bytes([recovery_bit + 27])
    return r_bytes + s_bytes + v_byte


cli_app = typer.Typer(
    name="mock-redeem",
    help="Nozk Mock Redeemer — offline contract verification for testing.",
    no_args_is_help=True,
    rich_markup_mode="rich",
    pretty_exceptions_enable=False,
)


@cli_app.command()
def verify(
    index: Annotated[int, typer.Option("--index", "-i", help="Token index to redeem.", min=0)],
    to: Annotated[str, typer.Option("--to", help="Recipient Ethereum address.")],
    verbosity: Annotated[Verbosity, typer.Option("--verbosity", "-v")] = Verbosity.normal,
) -> None:
    """
    Verify a token redemption off-chain, simulating every step of
    NozkVault.redeem() without touching the blockchain.

    Reads the unblinded signature from .nozk_wallet.json (written by
    mock_mint.py sign), derives the spend key from MASTER_SEED, generates
    the anti-MEV ECDSA proof, and runs the full verification pipeline:
    ecrecover → nullifier check → BLS pairing.
    """
    is_verbose = verbosity == Verbosity.verbose
    is_quiet = verbosity == Verbosity.quiet

    if not is_quiet:
        console.print(
            Panel(
                Text.assemble(("🔍  ", ""), ("MOCK REDEEMER · VERIFY", "banner"), ("  🔍", "")),
                subtitle=Text("NozkVault.redeem() simulation · no chain required", style="secondary"),
                border_style="magenta",
                padding=(0, 4),
            )
        )
        console.print()

    # ── Load config ───────────────────────────────────────────────────────
    master_seed_str = os.getenv("MASTER_SEED")
    if not master_seed_str:
        console.print("[error]  ❌  Missing MASTER_SEED in .env[/error]")
        raise typer.Exit(code=1)
    master_seed = master_seed_str.encode("utf-8")

    try:
        redeemer = MockRedeemer.from_env()
    except MockRedeemError as exc:
        console.print(f"[error]  ❌  {exc}[/error]")
        raise typer.Exit(code=1)

    # ── Load wallet state ─────────────────────────────────────────────────
    state = load_wallet_state()
    token_key = str(index)
    rec = state.get("tokens", {}).get(token_key)

    if not rec:
        console.print(f"[error]  ❌  Token {index} not found in wallet state. Run 'mint_mock.py sign' first.[/error]")
        raise typer.Exit(code=1)

    if not rec.get("s_unblinded_x"):
        console.print(f"[error]  ❌  Token {index} has no unblinded signature. Run 'mint_mock.py sign' first.[/error]")
        raise typer.Exit(code=1)

    if rec.get("spent"):
        console.print(f"[warning]  ⚠️   Token {index} is already marked as spent in wallet state.[/warning]")

    s_x = int(rec["s_unblinded_x"], 16)
    s_y = int(rec["s_unblinded_y"], 16)

    if not is_quiet:
        console.print(Rule(f"[step]Step 1 · Load Token #{index}[/step]", style="dim magenta"))
        console.print(
            Text.assemble(
                ("  Spend address  ", "label"),
                (rec["spend_address"], "addr"),
            )
        )
        console.print(
            Text.assemble(
                ("  Deposit ID     ", "label"),
                (rec["deposit_id"], "addr"),
            )
        )
        if is_verbose:
            console.print(Text.assemble(("  S.x            ", "label"), (short_hex(hex(s_x), 18, 8), "hash")))
            console.print(Text.assemble(("  S.y            ", "label"), (short_hex(hex(s_y), 18, 8), "hash")))
        console.print()

    # ── Derive spend key and generate ECDSA proof ─────────────────────────
    if not is_quiet:
        console.print(Rule("[step]Step 2 · Generate Anti-MEV ECDSA Proof[/step]", style="dim magenta"))

    secrets = derive_token_secrets(master_seed, index)
    contract_addr = os.getenv("CONTRACT_ADDRESS", "").strip()
    chain_id = int(os.getenv("CHAIN_ID", "11155111"))
    deadline = int(time.time()) + 3600
    proof = generate_redemption_proof(
        secrets.spend_priv,
        to,
        chain_id,
        contract_addr,
        deadline,
    )

    if not is_quiet:
        console.print(
            Text.assemble(
                ("  Payload        ", "label"),
                (f"EIP-712 NozkRedeem(recipient={to}, deadline={deadline})", "value"),
            )
        )
        console.print(
            Text.assemble(
                ("  msg_hash       ", "label"),
                (short_hex(proof.msg_hash.hex(), 18, 8), "hash"),
            )
        )
        console.print(
            Text.assemble(
                ("  recovery_bit   ", "label"),
                (str(proof.recovery_bit), "num"),
                ("  (v = ", "muted"),
                (str(proof.recovery_bit + 27), "num"),
                (")", "muted"),
            )
        )
        if is_verbose:
            console.print(
                Text.assemble(
                    ("  compact_hex    ", "label"),
                    (short_hex("0x" + proof.compact_hex, 22, 8), "hash"),
                )
            )
        console.print()

    # ── Reveal: BLS pairing check ─────────────────────────────────────────
    if not is_quiet:
        console.print(Rule("[step]Step 3 · Simulate NozkVault.reveal()[/step]", style="dim magenta"))

    nullifier = rec["spend_address"]
    reveal_result = redeemer.reveal(
        nullifier=nullifier,
        unblinded_s_x=s_x,
        unblinded_s_y=s_y,
    )

    if not is_quiet:
        console.print(
            Text.assemble(
                ("  [BLS pairing]  ", "label"),
                (
                    "✅ PASS" if reveal_result.bls_pairing_ok else "❌ FAIL",
                    "success" if reveal_result.bls_pairing_ok else "error",
                ),
            )
        )
        console.print(
            Text.assemble(
                ("  [Nullifier]    → ", "muted"),
                ("REVEALED" if reveal_result.success else "FAILED", "success" if reveal_result.success else "error"),
            )
        )
        console.print()

    if not reveal_result.success:
        console.print(f"[error]  ❌  Reveal FAILED: {reveal_result.reason}[/error]")
        raise typer.Exit(code=1)

    # ── Redeem: ECDSA verification ─────────────────────────────────────────
    if not is_quiet:
        console.print(Rule("[step]Step 4 · Simulate NozkVault.redeem()[/step]", style="dim magenta"))

    sig_65 = _encode_spend_signature(proof.compact_hex, proof.recovery_bit)

    result = redeemer.redeem(
        recipient=to,
        spend_signature_bytes=sig_65,
        chain_id=chain_id,
        contract_address=contract_addr,
        deadline=deadline,
    )

    if not is_quiet:
        console.print(
            Text.assemble(
                ("  [ecrecover]    → ", "muted"),
                (result.ecrecover_address or "FAILED", "addr"),
            )
        )
        console.print(
            Text.assemble(
                ("  [ECDSA check]  ", "label"),
                ("✅ PASS" if result.ecdsa_ok else "❌ FAIL", "success" if result.ecdsa_ok else "error"),
            )
        )
        console.print(
            Text.assemble(
                ("  [State check]  ", "label"),
                (
                    "✅ REVEALED" if not result.nullifier_spent else "❌ ALREADY SPENT",
                    "success" if not result.nullifier_spent else "error",
                ),
            )
        )
        console.print()

    if result.success:
        # Mark as spent in wallet state
        state["tokens"][token_key]["spent"] = True
        state["tokens"][token_key]["redeem_tx"] = "mock-redeem-verified"
        save_wallet_state(state)

        if not is_quiet:
            console.print(Rule(style="dim magenta"))
            console.print(
                Text.assemble(
                    ("  🎉  ", ""),
                    ("Mock reveal + redeem PASSED", "success"),
                    (" — all contract checks verified off-chain.", "success"),
                )
            )
            console.print(
                Text.assemble(
                    ("  📝  Wallet state updated: token ", "muted"),
                    (str(index), "num"),
                    (" → SPENT", "muted"),
                )
            )
            console.print()
    else:
        console.print(f"[error]  ❌  Redemption FAILED: {result.reason}[/error]")
        raise typer.Exit(code=1)


if __name__ == "__main__":
    cli_app()
