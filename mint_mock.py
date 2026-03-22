"""
Ghost-Tip Protocol: Mock Mint

Performs the same blind signing operation (S' = sk · B) as the real mint server,
but without any blockchain interactions. Accepts a blinded G1 point and returns
the blind signature directly.

This module is the off-chain equivalent of:
    1. Listening for a DepositLocked event
    2. Parsing the blinded point B from the event
    3. Computing S' = sk · B
    4. Calling announce() to post S' back to the chain

Library usage:
    from mint_mock import MockMint

    mint = MockMint.from_env()               # loads MINT_BLS_PRIVKEY_INT from .env
    mint = MockMint.from_sk(sk_int)           # or pass the scalar directly

    S_prime = mint.sign(blinded_point_B)      # returns G1Point
    s_x, s_y = mint.sign_and_serialize(B)     # returns (int, int) for Solidity

CLI usage (replaces the scan step in mock mode):
    uv run mint_mock.py sign --index 0
    uv run mint_mock.py sign --index 0 --index-to 9
    uv run mint_mock.py sign --index 0 --verbosity verbose

All operations are pure — no network, no gas, no state beyond .ghost_wallet.json.
"""

import json
import os
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Annotated, Optional

import typer
from dotenv import load_dotenv
from py_ecc.bn128 import curve_order
from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.rule import Rule
from rich.text import Text
from rich.theme import Theme

from ghost_library import (
    G1Point, G2Point, Scalar,
    derive_token_secrets, blind_token,
    mint_blind_sign, unblind_signature,
    serialize_g1, parse_g1,
    verify_bls_pairing, _mul_g2,
    InvalidPointError, GhostError,
)

load_dotenv()


# ==============================================================================
# MOCK MINT LIBRARY
# ==============================================================================

class MockMintError(GhostError):
    """Raised when the mock mint encounters a configuration or signing error."""


@dataclass
class MockMint:
    """
    Stateless mock mint that performs S' = sk · B without chain interaction.

    The real mint server (mint_server.py) does exactly three things:
        1. Receives B from a DepositLocked event
        2. Computes S' = sk · B via ghost_library.mint_blind_sign()
        3. Posts S' back via contract.announce()

    This mock replaces steps 1 and 3 with direct function calls, keeping
    step 2 identical. The cryptographic output is byte-for-byte equivalent.
    """

    sk: Scalar

    # ── Constructors ──────────────────────────────────────────────────────

    @classmethod
    def from_sk(cls, sk_int: int) -> "MockMint":
        """Create from an integer scalar."""
        if sk_int <= 0 or sk_int >= curve_order:
            raise MockMintError(
                f"BLS scalar must be in (0, curve_order), got {sk_int}"
            )
        return cls(sk=Scalar(sk_int))

    @classmethod
    def from_hex(cls, sk_hex: str) -> "MockMint":
        """Create from a hex string (with or without 0x prefix)."""
        try:
            sk_int = int(sk_hex, 16) if sk_hex.startswith("0x") else int(sk_hex)
        except ValueError as exc:
            raise MockMintError(f"Invalid hex scalar: {sk_hex!r}") from exc
        return cls.from_sk(sk_int)

    @classmethod
    def from_env(cls) -> "MockMint":
        """
        Load the mint scalar from environment variables.

        Checks MINT_BLS_PRIVKEY (hex) first, then MINT_BLS_PRIVKEY_INT (decimal).
        """
        sk_hex = os.getenv("MINT_BLS_PRIVKEY")
        sk_int_str = os.getenv("MINT_BLS_PRIVKEY_INT")

        if sk_hex:
            return cls.from_hex(sk_hex)
        if sk_int_str:
            return cls.from_sk(int(sk_int_str))

        raise MockMintError(
            "Missing MINT_BLS_PRIVKEY or MINT_BLS_PRIVKEY_INT in environment. "
            "Run generate_keys.py first."
        )

    # ── Signing ───────────────────────────────────────────────────────────

    def sign(self, B: G1Point) -> G1Point:
        """
        Blind-sign a G1 point: S' = sk · B.

        Delegates to ghost_library.mint_blind_sign() which validates
        that B is on the BN254 G1 curve before multiplying.
        """
        return mint_blind_sign(B, self.sk)

    def sign_and_serialize(self, B: G1Point) -> tuple[int, int]:
        """Blind-sign and return (S'_x, S'_y) as uint256 integers."""
        S_prime = self.sign(B)
        return serialize_g1(S_prime)

    def sign_from_coords(self, b_x: int, b_y: int) -> tuple[int, int]:
        """Parse a G1 point from raw coordinates, sign it, return coordinates."""
        B = parse_g1(b_x, b_y)
        return self.sign_and_serialize(B)


# ==============================================================================
# CLI — integrates with client.py's .ghost_wallet.json
# ==============================================================================

ghost_theme = Theme({
    "primary":   "bold cyan",
    "secondary": "dim cyan",
    "success":   "bold green",
    "warning":   "bold yellow",
    "error":     "bold red",
    "muted":     "dim white",
    "label":     "bold white",
    "value":     "cyan",
    "addr":      "yellow",
    "hash":      "magenta",
    "num":       "bright_blue",
    "banner":    "bold bright_cyan",
    "step":      "bold cyan",
    "mock":      "bold magenta",
})

console = Console(theme=ghost_theme, highlight=False)

WALLET_STATE_FILE = Path(".ghost_wallet.json")


class Verbosity(str, Enum):
    quiet   = "quiet"
    normal  = "normal"
    verbose = "verbose"


def _short(val: str, head: int = 10, tail: int = 8) -> str:
    if len(val) <= head + tail + 3:
        return val
    return f"{val[:head]}…{val[-tail:]}"


def _load_wallet_state() -> dict:
    if not WALLET_STATE_FILE.exists():
        return {"tokens": {}, "last_scanned_block": 0}
    return json.loads(WALLET_STATE_FILE.read_text())


def _save_wallet_state(state: dict) -> None:
    WALLET_STATE_FILE.write_text(json.dumps(state, indent=2))


app = typer.Typer(
    name="mock-mint",
    help="Ghost-Tip Mock Mint — offline blind signing for testing.",
    no_args_is_help=True,
    rich_markup_mode="rich",
    pretty_exceptions_enable=False,
)


@app.command()
def sign(
    index: Annotated[int, typer.Option("--index", "-i", help="Token index to sign.", min=0)],
    index_to: Annotated[Optional[int], typer.Option("--index-to", help="Last index (for batch).", min=0)] = None,
    verbosity: Annotated[Verbosity, typer.Option("--verbosity", "-v")] = Verbosity.normal,
) -> None:
    """
    Mock-sign token(s): derive B from seed, compute S' = sk·B, unblind to S,
    and write the result into .ghost_wallet.json — replacing the scan step.

    This performs the combined work of:
      [bold]deposit event[/bold]  → re-derives B from the master seed
      [bold]mint server[/bold]    → S' = sk · B
      [bold]scan command[/bold]   → unblinds S and writes to wallet state
    """
    is_verbose = verbosity == Verbosity.verbose
    is_quiet   = verbosity == Verbosity.quiet

    if not is_quiet:
        console.print(Panel(
            Text.assemble(("🧪  ", ""), ("MOCK MINT · SIGN", "banner"), ("  🧪", "")),
            subtitle=Text("Offline blind signing · no chain required", style="secondary"),
            border_style="magenta",
            padding=(0, 4),
        ))
        console.print()

    # ── Load config ───────────────────────────────────────────────────────
    master_seed_str = os.getenv("MASTER_SEED")
    if not master_seed_str:
        console.print("[error]  ❌  Missing MASTER_SEED in .env[/error]")
        raise typer.Exit(code=1)
    master_seed = master_seed_str.encode("utf-8")

    try:
        mint = MockMint.from_env()
    except MockMintError as exc:
        console.print(f"[error]  ❌  {exc}[/error]")
        raise typer.Exit(code=1)

    # Derive PK for BLS verification
    from py_ecc.bn128 import G2 as G2_gen
    pk_mint = _mul_g2(G2Point(G2_gen), mint.sk)

    if not is_quiet:
        console.print(Text.assemble(
            ("  BLS sk loaded  ", "label"),
            (_short(hex(mint.sk), 12, 6), "hash"),
        ))
        console.print()

    # ── Load wallet state ─────────────────────────────────────────────────
    state = _load_wallet_state()

    end_index = index_to if index_to is not None else index
    if end_index < index:
        console.print(f"[error]  ❌  --index-to ({end_index}) must be >= --index ({index})[/error]")
        raise typer.Exit(code=1)

    signed_count = 0

    for idx in range(index, end_index + 1):
        if not is_quiet:
            console.print(Rule(f"[step]Token #{idx}[/step]", style="dim magenta"))

        # Step 1: Derive token secrets (same derivation as client.py deposit)
        secrets = derive_token_secrets(master_seed, idx)

        if not is_quiet:
            console.print(Text.assemble(
                ("  Spend address  ", "label"), (secrets.spend.address, "addr"),
                ("  (nullifier)", "muted"),
            ))
            console.print(Text.assemble(
                ("  Deposit ID     ", "label"), (secrets.deposit_id, "addr"),
            ))

        # Step 2: Blind the token (re-derive B from spend address + r)
        blinded = blind_token(secrets.spend_address_bytes, secrets.r)
        b_x, b_y = serialize_g1(blinded.B)

        if is_verbose:
            console.print(Text.assemble(("  r              ", "label"), (_short(hex(secrets.r), 18, 8), "hash")))
            console.print(Text.assemble(("  B.x            ", "label"), (_short(hex(b_x), 18, 8), "hash")))
            console.print(Text.assemble(("  B.y            ", "label"), (_short(hex(b_y), 18, 8), "hash")))

        # Step 3: Mock mint signs (S' = sk · B)
        S_prime = mint.sign(blinded.B)
        s_prime_x, s_prime_y = serialize_g1(S_prime)

        if is_verbose:
            console.print(Text.assemble(("  S'.x           ", "label"), (_short(hex(s_prime_x), 18, 8), "hash")))
            console.print(Text.assemble(("  S'.y           ", "label"), (_short(hex(s_prime_y), 18, 8), "hash")))

        # Step 4: Client unblinds (S = S' · r⁻¹)
        S = unblind_signature(S_prime, secrets.r)
        s_x, s_y = serialize_g1(S)

        if is_verbose:
            console.print(Text.assemble(("  S.x            ", "label"), (_short(hex(s_x), 18, 8), "hash")))
            console.print(Text.assemble(("  S.y            ", "label"), (_short(hex(s_y), 18, 8), "hash")))

        # Step 5: Local BLS verification (sanity check)
        bls_ok = verify_bls_pairing(S, blinded.Y, pk_mint)
        if bls_ok:
            if not is_quiet:
                console.print(Text("  ✅  BLS pairing verified", style="success"))
        else:
            console.print(Text("  ❌  BLS pairing FAILED — this should never happen", style="error"))
            raise typer.Exit(code=1)

        # Step 6: Write to wallet state (same record shape as client.py)
        token_key = str(idx)
        existing = state.get("tokens", {}).get(token_key, {})
        state.setdefault("tokens", {})[token_key] = {
            "index":         idx,
            "spend_address": secrets.spend.address,
            "deposit_id":    secrets.deposit_id,
            "deposit_tx":    existing.get("deposit_tx", "mock-mint-offline"),
            "deposit_block": existing.get("deposit_block"),
            "s_unblinded_x": hex(s_x),
            "s_unblinded_y": hex(s_y),
            "redeem_tx":     existing.get("redeem_tx"),
            "spent":         existing.get("spent", False),
        }

        signed_count += 1

        if not is_quiet:
            console.print(Text("  ✅  Written to wallet state", style="success"))
            console.print()

    _save_wallet_state(state)

    if not is_quiet:
        console.print(Rule(style="dim magenta"))
        console.print(Text.assemble(
            ("  🧪  Mock mint complete: ", "mock"),
            (str(signed_count), "num"),
            (" token(s) signed → wallet state ready for redeem --dry-run", "mock"),
        ))
        console.print()


if __name__ == "__main__":
    app()
