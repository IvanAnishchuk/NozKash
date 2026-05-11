"""
Nozk Protocol: Mock Mint (BLS12-381)

Performs the same blind signing operation (S' = sk · B) as the real mint server,
but without any blockchain interactions. Accepts a blinded G2 point and returns
the blind signature directly.

Standard BLS scheme: PK in G1, Sig/S/S'/B/Y in G2.

This module is the off-chain equivalent of:
    1. Listening for a DepositLocked event
    2. Parsing the blinded point B from the event
    3. Computing S' = sk · B
    4. Calling announce() to post S' back to the chain

Library usage:
    from mint_mock import MockMint

    mint = MockMint.from_env()               # loads MINT_BLS_PRIVKEY_INT from .env
    mint = MockMint.from_sk(sk_int)           # or pass the scalar directly

    S_prime = mint.sign(blinded_point_B)      # returns G2Point
    coords = mint.sign_and_serialize(B)       # returns 8 uint256 for Solidity

CLI usage (replaces the scan step in mock mode):
    uv run mint_mock.py sign --index 0
    uv run mint_mock.py sign --index 0 --index-to 9
    uv run mint_mock.py sign --index 0 --verbosity verbose

All operations are pure — no network, no gas, no state beyond .nozk_wallet.json.
"""

import os
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Annotated, Optional

import typer
from dotenv import load_dotenv
from rich.panel import Panel
from rich.rule import Rule
from rich.text import Text

from bls12_381_crypto import (
    CURVE_ORDER,
    G1_GEN,
    G2Point,
    Scalar,
    g1_scalar_mul,
    parse_g2_sol,
    serialize_g1_sol,
    serialize_g2_sol,
)
from nozk_library import (
    NozkError,
    blind_token,
    derive_token_secrets,
    mint_blind_sign,
    unblind_signature,
    verify_bls_mint_signature,
)
from nozk_theme import make_console
from wallet_state import load_wallet_state, save_wallet_state, short_hex

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


# ==============================================================================
# MOCK MINT LIBRARY
# ==============================================================================


class MockMintError(NozkError):
    """Raised when the mock mint encounters a configuration or signing error."""


@dataclass
class MockMint:
    """
    Stateless mock mint that performs S' = sk · B without chain interaction.

    The real mint server (mint_server.py) does exactly three things:
        1. Receives B from a DepositLocked event
        2. Computes S' = sk · B via nozk_library.mint_blind_sign()
        3. Posts S' back via contract.announce()

    This mock replaces steps 1 and 3 with direct function calls, keeping
    step 2 identical. The cryptographic output is byte-for-byte equivalent.

    Standard BLS scheme: PK in G1, Sig in G2.
    """

    sk: Scalar

    # -- Constructors ----------------------------------------------------------

    @classmethod
    def from_sk(cls, sk_int: int) -> "MockMint":
        """Create from an integer scalar."""
        if sk_int <= 0 or sk_int >= CURVE_ORDER:
            raise MockMintError(f"BLS scalar must be in (0, CURVE_ORDER), got {sk_int}")
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

        Checks MINT_BLS_PRIVKEY (hex) first, then MINT_BLS_PRIVKEY_INT (hex).
        """
        sk_hex = os.getenv("MINT_BLS_PRIVKEY")
        sk_int_str = os.getenv("MINT_BLS_PRIVKEY_INT")

        if sk_hex:
            return cls.from_hex(sk_hex)
        if sk_int_str:
            return cls.from_hex(sk_int_str)

        raise MockMintError(
            "Missing MINT_BLS_PRIVKEY or MINT_BLS_PRIVKEY_INT in environment. Run generate_keys.py first."
        )

    # -- Signing ---------------------------------------------------------------

    def sign(self, B: G2Point) -> G2Point:
        """
        Blind-sign a G2 point: S' = sk · B.

        Delegates to nozk_library.mint_blind_sign() which validates
        that B is on the BLS12-381 G2 curve before multiplying.
        """
        return mint_blind_sign(B, self.sk)

    def sign_and_serialize(self, B: G2Point) -> tuple[int, int, int, int, int, int, int, int]:
        """Blind-sign and return 8 uint256 integers (EIP-2537 G2 encoding)."""
        S_prime = self.sign(B)
        return serialize_g2_sol(S_prime)

    def sign_from_coords(
        self,
        x_c0_hi: int,
        x_c0_lo: int,
        x_c1_hi: int,
        x_c1_lo: int,
        y_c0_hi: int,
        y_c0_lo: int,
        y_c1_hi: int,
        y_c1_lo: int,
    ) -> tuple[int, int, int, int, int, int, int, int]:
        """Parse a G2 point from raw coordinates, sign it, return coordinates."""
        B = parse_g2_sol(
            x_c0_hi,
            x_c0_lo,
            x_c1_hi,
            x_c1_lo,
            y_c0_hi,
            y_c0_lo,
            y_c1_hi,
            y_c1_lo,
        )
        return self.sign_and_serialize(B)


# ==============================================================================
# CLI — integrates with client.py's .nozk_wallet.json
# ==============================================================================

console = make_console()


class Verbosity(str, Enum):
    quiet = "quiet"
    normal = "normal"
    verbose = "verbose"


app = typer.Typer(
    name="mock-mint",
    help="Nozk Mock Mint — offline blind signing for testing.",
    no_args_is_help=True,
    rich_markup_mode="rich",
    pretty_exceptions_enable=False,
)


@app.command()
def sign(
    index: Annotated[int, typer.Option("--index", "-i", help="Token index to sign.", min=0)],
    index_to: Annotated[
        Optional[int],
        typer.Option("--index-to", help="Last index (for batch).", min=0),
    ] = None,
    verbosity: Annotated[Verbosity, typer.Option("--verbosity", "-v")] = Verbosity.normal,
) -> None:
    """
    Mock-sign token(s): derive B from seed, compute S' = sk·B, unblind to S,
    and write the result into .nozk_wallet.json — replacing the scan step.

    This performs the combined work of:
      [bold]deposit event[/bold]  → re-derives B from the master seed
      [bold]mint server[/bold]    → S' = sk · B
      [bold]scan command[/bold]   → unblinds S and writes to wallet state
    """
    is_verbose = verbosity == Verbosity.verbose
    is_quiet = verbosity == Verbosity.quiet

    if not is_quiet:
        console.print(
            Panel(
                Text.assemble(
                    ("🧪  ", ""),
                    ("MOCK MINT · SIGN", "banner"),
                    ("  🧪", ""),
                ),
                subtitle=Text(
                    "Offline blind signing · no chain required",
                    style="secondary",
                ),
                border_style="magenta",
                padding=(0, 4),
            )
        )
        console.print()

    # -- Load config -----------------------------------------------------------
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

    # Derive PK (G1) for BLS verification
    pk_mint = g1_scalar_mul(G1_GEN, mint.sk)

    if not is_quiet:
        console.print(
            Text.assemble(
                ("  BLS sk loaded  ", "label"),
                (short_hex(hex(mint.sk), 12, 6), "hash"),
            )
        )
        pk_coords = serialize_g1_sol(pk_mint)
        console.print(
            Text.assemble(
                ("  PK (G1)       ", "label"),
                (short_hex(hex(pk_coords[1]), 12, 6), "hash"),
                ("  (lo word)", "muted"),
            )
        )
        console.print()

    # -- Load wallet state -----------------------------------------------------
    state = load_wallet_state()

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
            console.print(
                Text.assemble(
                    ("  Nullifier ID   ", "label"),
                    (secrets.nullifier_id_hex, "addr"),
                    ("  (on-chain key)", "muted"),
                )
            )
            console.print(
                Text.assemble(
                    ("  Deposit ID     ", "label"),
                    (secrets.deposit_id, "addr"),
                )
            )

        # Step 2: Blind the token (hash spend G1 pubkey to G2, then blind)
        blinded = blind_token(secrets.spend_bls_pub, secrets.r)
        b_coords = serialize_g2_sol(blinded.B)

        if is_verbose:
            console.print(
                Text.assemble(
                    ("  r              ", "label"),
                    (short_hex(hex(secrets.r), 18, 8), "hash"),
                )
            )
            console.print(
                Text.assemble(
                    ("  B (G2, 8w)     ", "label"),
                    (short_hex(hex(b_coords[0]), 18, 8), "hash"),
                    (" ...", "muted"),
                )
            )

        # Step 3: Mock mint signs (S' = sk · B)
        S_prime = mint.sign(blinded.B)
        s_prime_coords = serialize_g2_sol(S_prime)

        if is_verbose:
            console.print(
                Text.assemble(
                    ("  S' (G2, 8w)    ", "label"),
                    (short_hex(hex(s_prime_coords[0]), 18, 8), "hash"),
                    (" ...", "muted"),
                )
            )

        # Step 4: Client unblinds (S = S' · r^-1)
        S = unblind_signature(S_prime, secrets.r)
        s_coords = serialize_g2_sol(S)

        if is_verbose:
            console.print(
                Text.assemble(
                    ("  S (G2, 8w)     ", "label"),
                    (short_hex(hex(s_coords[0]), 18, 8), "hash"),
                    (" ...", "muted"),
                )
            )

        # Step 5: Local BLS verification (sanity check)
        bls_ok = verify_bls_mint_signature(S, blinded.Y, pk_mint)
        if bls_ok:
            if not is_quiet:
                console.print(Text("  ✅  BLS pairing verified", style="success"))
        else:
            console.print(
                Text(
                    "  ❌  BLS pairing FAILED — this should never happen",
                    style="error",
                )
            )
            raise typer.Exit(code=1)

        # Step 6: Write to wallet state (same record shape as client.py)
        # G2 signature stored as list of 8 hex-encoded uint256 values
        token_key = str(idx)
        existing = state.get("tokens", {}).get(token_key, {})
        spend_pub_coords = serialize_g1_sol(secrets.spend_bls_pub)
        state.setdefault("tokens", {})[token_key] = {
            "index": idx,
            "nullifier_id": secrets.nullifier_id_hex,
            "deposit_id": secrets.deposit_id,
            "deposit_tx": existing.get("deposit_tx", "mock-mint-offline"),
            "deposit_block": existing.get("deposit_block"),
            "s_unblinded_g2": [hex(c) for c in s_coords],
            "spend_pub_g1": [hex(c) for c in spend_pub_coords],
            "b_g2": existing.get("b_g2"),
            "reveal_tx": existing.get("reveal_tx"),
            "redeem_tx": existing.get("redeem_tx"),
            "spent": existing.get("spent", False),
        }

        signed_count += 1

        if not is_quiet:
            console.print(Text("  ✅  Written to wallet state", style="success"))
            console.print()

    save_wallet_state(state)

    if not is_quiet:
        console.print(Rule(style="dim magenta"))
        console.print(
            Text.assemble(
                ("  🧪  Mock mint complete: ", "mock"),
                (str(signed_count), "num"),
                (
                    " token(s) signed → wallet state ready for redeem --dry-run",
                    "mock",
                ),
            )
        )
        console.print()


if __name__ == "__main__":
    app()
