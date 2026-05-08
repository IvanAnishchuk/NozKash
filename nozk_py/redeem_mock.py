"""
Nozk Protocol: Mock Redeemer (On-Chain Verification Simulator)

Simulates the NozkVault reveal() + redeem() smart contract flow off-chain.

BLS12-381 standard scheme: PK in G1, Signature in G2.

Two-phase flow (matches on-chain architecture):
    reveal(spend_pub_G1, S_G2):
        1. Compute nullifier_id = keccak256(abi_encode_g1(spend_pub))
        2. Y = hash_to_G2(abi_encode_g1(spend_pub))
        3. Verify mint BLS pairing: e(PK_mint, Y) == e(G1_gen, S)
        4. Register nullifier_id as REVEALED

    redeem(recipient, sigma_G2, spend_pk_G1, nullifier_id, deadline, ...):
        1. Compute EIP-712 msg_hash
        2. Verify BLS spend signature: AugSchemeMPL.verify(spend_pk, msg_hash, sigma)
        3. Check nullifier_id is REVEALED (not UNREVEALED or SPENT)
        4. Mark SPENT, transfer 0.001 ETH (mock: just records success)

Library usage:
    from redeem_mock import MockRedeemer

    redeemer = MockRedeemer(pk_mint=pk_g1_point)
    redeemer.reveal(spend_pub=spend_pub_g1, S=unblinded_sig_g2)
    result = redeemer.redeem(
        recipient="0xRecipient...",
        sigma=sigma_g2_element,
        spend_pk=pk_g1_element,
        nullifier_id=nullifier_id_hex,
    )

CLI usage (replaces on-chain redeem with full verification):
    uv run redeem_mock.py verify --index 0 --to 0xRecipient
    uv run redeem_mock.py verify --index 0 --to 0xRecipient --verbosity verbose

All operations are pure -- no network, no gas. The CLI reads wallet state and
MASTER_SEED from .env to reconstruct the redemption payload, then verifies it.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Annotated, Optional

import typer
from chia_rs import AugSchemeMPL, G1Element, G2Element
from dotenv import load_dotenv
from eth_utils import keccak
from rich.panel import Panel
from rich.rule import Rule
from rich.text import Text

from bls12_381_crypto import (
    G1Point,
    G2Point,
    abi_encode_g1,
    hash_to_g2,
    verify_mint_pairing,
)
from nozk_library import (
    NozkError,
    derive_token_secrets,
    eip712_redemption_hash,
    generate_redemption_proof,
)
from nozk_theme import make_console
from wallet_state import load_wallet_state, save_wallet_state, short_hex

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


# ==============================================================================
# MOCK REDEEMER LIBRARY
# ==============================================================================


class MockRedeemError(NozkError):
    """Raised for mock redeemer configuration errors."""


class NullifierState(Enum):
    UNREVEALED = "UNREVEALED"
    REVEALED = "REVEALED"
    SPENT = "SPENT"


@dataclass
class RevealResult:
    """Result of a mock reveal attempt."""

    success: bool = False
    nullifier_id: str = ""
    bls_pairing_ok: bool = False
    reason: Optional[str] = None


@dataclass
class RedeemResult:
    """Result of a mock redemption attempt."""

    success: bool = False
    recipient: str = ""
    nullifier_id: Optional[str] = None
    bls_spend_ok: bool = False
    nullifier_spent: bool = False
    reason: Optional[str] = None

    def __str__(self) -> str:
        if self.success:
            return (
                f"REDEEM SUCCESS\n"
                f"  Nullifier ID: {self.nullifier_id}\n"
                f"  Recipient:    {self.recipient}\n"
                f"  BLS spend:    {'PASS' if self.bls_spend_ok else 'FAIL'}"
            )
        return (
            f"REDEEM FAILED\n"
            f"  Reason:       {self.reason}\n"
            f"  Nullifier ID: {self.nullifier_id or 'unknown'}\n"
            f"  BLS spend:    {self.bls_spend_ok}"
        )


def _nullifier_id(spend_pub: G1Point) -> str:
    """Compute nullifier_id = keccak256(abi_encode_g1(spend_pub)) as hex string."""
    return keccak(abi_encode_g1(spend_pub)).hex()


@dataclass
class MockRedeemer:
    """
    Off-chain simulation of NozkVault reveal() + redeem().

    BLS12-381 standard scheme: PK_mint in G1, signatures in G2.

    Maintains an in-memory mapping of nullifier states, matching the
    contract's NullifierState enum (UNREVEALED -> REVEALED -> SPENT).

    Nullifier identity is the G1 spend pubkey; nullifier_id is
    keccak256(abi_encode_g1(spend_pub)).
    """

    pk_mint: G1Point
    nullifier_states: dict[str, NullifierState] = field(default_factory=dict)

    # -- Constructors ----------------------------------------------------------

    @classmethod
    def from_sk(cls, sk_int: int) -> MockRedeemer:
        """Derive PK_mint from the scalar and create a redeemer."""
        from bls12_381_crypto import G1_GEN, Scalar, g1_scalar_mul

        pk = g1_scalar_mul(G1_GEN, Scalar(sk_int))
        return cls(pk_mint=pk)

    @classmethod
    def from_env(cls) -> MockRedeemer:
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

    # -- Reveal (BLS mint signature verification) ------------------------------

    def reveal(self, spend_pub: G1Point, S: G2Point) -> RevealResult:
        """
        Simulate NozkVault.reveal() -- BLS mint pairing verification.

        Args:
            spend_pub: G1 spend pubkey (py_ecc G1Point).
            S: Unblinded mint signature (py_ecc G2Point).

        Verifies e(PK_mint, H_G2(spend_pub)) == e(G1_gen, S) and registers
        the nullifier_id as REVEALED.
        """
        nid = _nullifier_id(spend_pub)
        result = RevealResult(nullifier_id=nid)

        state = self.nullifier_states.get(nid, NullifierState.UNREVEALED)
        if state != NullifierState.UNREVEALED:
            result.reason = f"Nullifier already {state.value}"
            return result

        Y = hash_to_g2(abi_encode_g1(spend_pub))
        result.bls_pairing_ok = verify_mint_pairing(S, Y, self.pk_mint)
        if not result.bls_pairing_ok:
            result.reason = "BLS mint pairing check failed: e(PK_mint, Y) != e(G1_gen, S)"
            return result

        self.nullifier_states[nid] = NullifierState.REVEALED
        result.success = True
        return result

    # -- Redeem (BLS spend signature verification) -----------------------------

    def redeem(
        self,
        recipient: str,
        sigma: G2Element,
        spend_pk: G1Element,
        nullifier_id: str,
        chain_id: int = 11155111,
        contract_address: str = "",
        deadline: int = 2**256 - 1,
    ) -> RedeemResult:
        """
        Simulate NozkVault.redeem() -- BLS spend signature verification.

        BLS mint signature was already verified in reveal(). This checks:
        1. Compute EIP-712 msg_hash from (recipient, deadline, chain_id, contract)
        2. AugSchemeMPL.verify(spend_pk, msg_hash, sigma) -- BLS spend sig
        3. Nullifier must be in REVEALED state
        4. Mark as SPENT
        """
        result = RedeemResult(recipient=recipient, nullifier_id=nullifier_id)

        # Compute EIP-712 message hash
        msg_hash = eip712_redemption_hash(recipient, deadline, chain_id, contract_address)

        # Check nullifier state first (matches on-chain order)
        state = self.nullifier_states.get(nullifier_id, NullifierState.UNREVEALED)
        if state == NullifierState.SPENT:
            result.nullifier_spent = True
            result.reason = f"Token already spent (nullifier_id {nullifier_id})"
            return result
        if state != NullifierState.REVEALED:
            result.reason = f"Nullifier not revealed (state: {state.value})"
            return result

        # Verify BLS spend signature
        result.bls_spend_ok = AugSchemeMPL.verify(spend_pk, msg_hash, sigma)
        if not result.bls_spend_ok:
            result.reason = "BLS spend signature verification failed (AugSchemeMPL.verify)"
            return result

        # Mark as SPENT
        self.nullifier_states[nullifier_id] = NullifierState.SPENT
        result.success = True
        return result

    # -- State queries ---------------------------------------------------------

    def get_state(self, nullifier_id: str) -> NullifierState:
        """Get the state of a nullifier by its hex ID."""
        return self.nullifier_states.get(nullifier_id, NullifierState.UNREVEALED)

    def is_spent(self, nullifier_id: str) -> bool:
        return self.get_state(nullifier_id) == NullifierState.SPENT

    def is_revealed(self, nullifier_id: str) -> bool:
        return self.get_state(nullifier_id) == NullifierState.REVEALED

    def reset(self) -> None:
        self.nullifier_states.clear()


# ==============================================================================
# CLI -- reads wallet state, builds redeem payload, verifies everything
# ==============================================================================

console = make_console()


class Verbosity(str, Enum):
    quiet = "quiet"
    normal = "normal"
    verbose = "verbose"


cli_app = typer.Typer(
    name="mock-redeem",
    help="Nozk Mock Redeemer -- offline contract verification for testing.",
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
    NozkVault.reveal() + redeem() without touching the blockchain.

    Reads the unblinded signature from .nozk_wallet.json (written by
    mock_mint.py sign), derives the spend key from MASTER_SEED, generates
    the BLS spend signature proof, and runs the full verification pipeline:
    BLS mint pairing -> BLS spend sig -> nullifier state.
    """
    from bls12_381_crypto import parse_g1_sol, parse_g2_sol

    is_verbose = verbosity == Verbosity.verbose
    is_quiet = verbosity == Verbosity.quiet

    if not is_quiet:
        console.print(
            Panel(
                Text.assemble(("MOCK REDEEMER  VERIFY", "banner")),
                subtitle=Text("NozkVault.redeem() simulation  no chain required", style="secondary"),
                border_style="magenta",
                padding=(0, 4),
            )
        )
        console.print()

    # -- Load config -----------------------------------------------------------
    master_seed_str = os.getenv("MASTER_SEED")
    if not master_seed_str:
        console.print("[error]  Missing MASTER_SEED in .env[/error]")
        raise typer.Exit(code=1)
    master_seed = master_seed_str.encode("utf-8")

    try:
        redeemer = MockRedeemer.from_env()
    except MockRedeemError as exc:
        console.print(f"[error]  {exc}[/error]")
        raise typer.Exit(code=1)

    # -- Load wallet state -----------------------------------------------------
    state = load_wallet_state()
    token_key = str(index)
    rec = state.get("tokens", {}).get(token_key)

    if not rec:
        console.print(f"[error]  Token {index} not found in wallet state. Run 'mint_mock.py sign' first.[/error]")
        raise typer.Exit(code=1)

    if not rec.get("s_unblinded_g2"):
        console.print(f"[error]  Token {index} has no unblinded signature. Run 'mint_mock.py sign' first.[/error]")
        raise typer.Exit(code=1)

    if rec.get("spent"):
        console.print(f"[warning]  Token {index} is already marked as spent in wallet state.[/warning]")

    # Parse stored G2 signature (8 uint256 hex strings)
    s_g2_hex = rec["s_unblinded_g2"]
    s_g2_coords = tuple(int(c, 16) for c in s_g2_hex)

    # Parse stored G1 spend pubkey (4 uint256 hex strings)
    spend_pub_hex = rec["spend_pub_g1"]
    spend_pub_coords = tuple(int(c, 16) for c in spend_pub_hex)

    nullifier_id_hex = rec.get("nullifier_id", "")

    if not is_quiet:
        console.print(Rule(f"[step]Step 1  Load Token #{index}[/step]", style="dim magenta"))
        console.print(
            Text.assemble(
                ("  Nullifier ID   ", "label"),
                (short_hex(nullifier_id_hex, 18, 8) if nullifier_id_hex else "N/A", "addr"),
            )
        )
        console.print(
            Text.assemble(
                ("  Deposit ID     ", "label"),
                (rec.get("deposit_id", "N/A"), "addr"),
            )
        )
        if is_verbose:
            console.print(Text.assemble(("  S_G2[0]        ", "label"), (short_hex(s_g2_hex[0], 18, 8), "hash")))
            console.print(Text.assemble(("  spend_pub[0]   ", "label"), (short_hex(spend_pub_hex[0], 18, 8), "hash")))
        console.print()

    # -- Derive spend key and generate BLS spend proof -------------------------
    if not is_quiet:
        console.print(Rule("[step]Step 2  Generate BLS Spend Signature[/step]", style="dim magenta"))

    secrets = derive_token_secrets(master_seed, index)
    contract_addr = os.getenv("CONTRACT_ADDRESS", "").strip()
    chain_id = int(os.getenv("CHAIN_ID", "11155111"))
    deadline = int(time.time()) + 3600
    proof = generate_redemption_proof(
        secrets.spend_chia_sk,
        secrets.spend_chia_pk,
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
                (short_hex("0x" + proof.msg_hash.hex(), 18, 8), "hash"),
            )
        )
        if is_verbose:
            console.print(
                Text.assemble(
                    ("  sigma (G2)     ", "label"),
                    (short_hex("0x" + bytes(proof.sigma).hex(), 22, 8), "hash"),
                )
            )
        console.print()

    # -- Reveal: BLS mint pairing check ----------------------------------------
    if not is_quiet:
        console.print(Rule("[step]Step 3  Simulate NozkVault.reveal()[/step]", style="dim magenta"))

    spend_pub_point = parse_g1_sol(*spend_pub_coords)
    S_point = parse_g2_sol(*s_g2_coords)

    reveal_result = redeemer.reveal(
        spend_pub=spend_pub_point,
        S=S_point,
    )

    if not is_quiet:
        console.print(
            Text.assemble(
                ("  [BLS pairing]  ", "label"),
                (
                    "PASS" if reveal_result.bls_pairing_ok else "FAIL",
                    "success" if reveal_result.bls_pairing_ok else "error",
                ),
            )
        )
        console.print(
            Text.assemble(
                ("  [Nullifier]    -> ", "muted"),
                ("REVEALED" if reveal_result.success else "FAILED", "success" if reveal_result.success else "error"),
            )
        )
        console.print()

    if not reveal_result.success:
        console.print(f"[error]  Reveal FAILED: {reveal_result.reason}[/error]")
        raise typer.Exit(code=1)

    # -- Redeem: BLS spend signature verification ------------------------------
    if not is_quiet:
        console.print(Rule("[step]Step 4  Simulate NozkVault.redeem()[/step]", style="dim magenta"))

    result = redeemer.redeem(
        recipient=to,
        sigma=proof.sigma,
        spend_pk=proof.spend_pk,
        nullifier_id=reveal_result.nullifier_id,
        chain_id=chain_id,
        contract_address=contract_addr,
        deadline=deadline,
    )

    if not is_quiet:
        console.print(
            Text.assemble(
                ("  [BLS spend]    ", "label"),
                ("PASS" if result.bls_spend_ok else "FAIL", "success" if result.bls_spend_ok else "error"),
            )
        )
        console.print(
            Text.assemble(
                ("  [State check]  ", "label"),
                (
                    "REVEALED" if not result.nullifier_spent else "ALREADY SPENT",
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
                    ("  Mock reveal + redeem PASSED", "success"),
                    (" -- all contract checks verified off-chain.", "success"),
                )
            )
            console.print(
                Text.assemble(
                    ("  Wallet state updated: token ", "muted"),
                    (str(index), "num"),
                    (" -> SPENT", "muted"),
                )
            )
            console.print()
    else:
        console.print(f"[error]  Redemption FAILED: {result.reason}[/error]")
        raise typer.Exit(code=1)


if __name__ == "__main__":
    cli_app()
