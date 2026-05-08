"""
Nozk Protocol: Relayer Server

FastAPI service that accepts reveal and redeem requests from clients,
validates them off-chain, and submits transactions to the NozkVault contract
using its own funded wallet (gas abstraction + anonymisation).

Both reveal() and redeem() are permissionless on-chain — the relayer is a
convenience layer, not an enforcement layer.

Endpoints:
    POST /reveal           Submit a BLS signature to register a nullifier
    POST /redeem           Submit an ECDSA signature to redeem a revealed token
    GET  /status/{nullifier}  Query nullifier lifecycle state
    GET  /health           Relayer health / balance check

Configuration (via .env or environment variables):
    CONTRACT_ADDRESS        Deployed NozkVault contract address
    RPC_HTTP_URL            HTTP RPC endpoint
    RELAYER_WALLET_ADDRESS  Ethereum address that pays gas
    RELAYER_WALLET_KEY      Private key for the above
    MINT_BLS_PUBKEY         G2 pubkey (4 uint256, comma-separated) for BLS pre-check
    CHAIN_ID                Chain ID (default: 11155111 = Sepolia)

Usage:
    uv run relayer_server.py
    uv run relayer_server.py --port 8000 --verbosity verbose
"""

import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Optional

import typer
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from rich import box
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from rich.traceback import install as install_rich_traceback
from web3 import Web3
from web3.exceptions import ContractCustomError, ContractLogicError

from bls12_381_crypto import (
    G1_GEN,
    G1Point,
    Scalar,
    abi_encode_g1,
    g1_scalar_mul,
    hash_to_g2,
    parse_g1_sol,
    parse_g2_sol,
    verify_mint_pairing,
)
from contract_errors import decode_contract_error
from nozk_library import (
    VerificationError,
)
from nozk_theme import make_console

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# ── Rich setup ────────────────────────────────────────────────────────────────

console = make_console()
install_rich_traceback(console=console, show_locals=False)


# ── Verbosity ─────────────────────────────────────────────────────────────────


class Verbosity(str, Enum):
    quiet = "quiet"
    normal = "normal"
    verbose = "verbose"
    debug = "debug"


VERBOSITY_TO_LOG_LEVEL = {
    Verbosity.quiet: logging.ERROR,
    Verbosity.normal: logging.INFO,
    Verbosity.verbose: logging.DEBUG,
    Verbosity.debug: logging.DEBUG,
}

_verbosity: Verbosity = Verbosity.normal


def is_verbose() -> bool:
    return _verbosity in (Verbosity.verbose, Verbosity.debug)


def is_debug() -> bool:
    return _verbosity == Verbosity.debug


def is_quiet() -> bool:
    return _verbosity == Verbosity.quiet


# ── Formatting helpers ────────────────────────────────────────────────────────


def _shorten(val: str, head: int = 10, tail: int = 8) -> str:
    if len(val) <= head + tail + 3:
        return val
    return f"{val[:head]}…{val[-tail:]}"


def print_banner() -> None:
    banner = Panel(
        Text.assemble(
            ("👻  ", ""),
            ("GHOST-TIP RELAYER", "banner"),
            ("  👻", ""),
        ),
        subtitle=Text("Reveal & Redeem Service · Sepolia", style="secondary"),
        border_style="cyan",
        padding=(0, 4),
    )
    console.print()
    console.print(banner)
    console.print()


def print_config(config: "RelayerConfig") -> None:
    table = Table(
        box=box.SIMPLE,
        show_header=False,
        padding=(0, 2),
        border_style="secondary",
    )
    table.add_column("Key", style="label", no_wrap=True)
    table.add_column("Value", style="value", no_wrap=False)

    table.add_row("Wallet", config.wallet_address)
    table.add_row("Contract", config.contract_address)
    table.add_row("RPC", _shorten(config.rpc_http_url, head=30, tail=8))
    table.add_row("Chain ID", str(config.chain_id))
    table.add_row("Verbosity", _verbosity.value)
    table.add_row("Has BLS pubkey", "yes" if config.mint_bls_pubkey else "no")

    console.print(Panel(table, title="[primary]Configuration[/primary]", border_style="secondary", padding=(0, 1)))
    console.print()


# ── Configuration ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class RelayerConfig:
    contract_address: str
    rpc_http_url: str
    wallet_address: str
    wallet_key: str
    chain_id: int
    mint_bls_pubkey: G1Point | None


def _parse_mint_bls_pubkey(raw: str) -> G1Point | None:
    if raw:
        parts = [p.strip() for p in raw.split(",")]
        if len(parts) == 4:
            x_hi, x_lo, y_hi, y_lo = (int(p, 16) for p in parts)
            return parse_g1_sol(x_hi, x_lo, y_hi, y_lo)

    sk_hex = os.getenv("MINT_BLS_PRIVKEY", "").strip() or os.getenv("MINT_BLS_PRIVKEY_INT", "").strip()
    if sk_hex:
        sk_int = int(sk_hex, 16) if sk_hex.startswith("0x") else int(sk_hex)
        return g1_scalar_mul(G1_GEN, Scalar(sk_int))

    return None


def load_config() -> RelayerConfig:
    missing = []

    def require(key: str) -> str:
        val = os.getenv(key, "").strip()
        if not val:
            missing.append(key)
        return val

    contract_addr = require("CONTRACT_ADDRESS")
    rpc_http_url = require("RPC_HTTP_URL")
    wallet_address = require("RELAYER_WALLET_ADDRESS")
    wallet_key = require("RELAYER_WALLET_KEY")

    if missing:
        console.print(
            Panel(
                Text.assemble(
                    ("Missing environment variables:\n\n", "error"),
                    *[Text.assemble(("  • ", "muted"), (k, "label"), ("\n", "")) for k in missing],
                    ("\nConfigure .env with relayer wallet settings.", "secondary"),
                ),
                title="[error]❌  Configuration Error[/error]",
                border_style="red",
            )
        )
        raise typer.Exit(code=1)

    pk = _parse_mint_bls_pubkey(os.getenv("MINT_BLS_PUBKEY", "").strip())

    return RelayerConfig(
        contract_address=contract_addr,
        rpc_http_url=rpc_http_url,
        wallet_address=wallet_address,
        wallet_key=wallet_key if wallet_key.startswith("0x") else "0x" + wallet_key,
        chain_id=int(os.getenv("CHAIN_ID", "11155111")),
        mint_bls_pubkey=pk,
    )


# ── Contract ABI ──────────────────────────────────────────────────────────────

_ABI_PATH = Path(__file__).resolve().parent / ".." / "abi" / "nozk_vault_abi.json"
NOZK_VAULT_ABI = json.loads(_ABI_PATH.read_text())


# ── Pydantic request/response models ─────────────────────────────────────────


class RevealRequest(BaseModel):
    spend_pub_g1: list[str]  # 4 hex uint256 (G1 spend pubkey)
    s_g2: list[str]  # 8 hex uint256 (G2 unblinded mint signature)


class RedeemRequest(BaseModel):
    recipient: str  # 0x-prefixed address
    spend_sigma_compressed: str  # 96-byte compressed G2 hex (BLS spend sig)
    spend_pk_compressed: str  # 48-byte compressed G1 hex (BLS spend pubkey)
    nullifier_id: str  # 32-byte hex (keccak of G1 spend pubkey)
    deadline: int  # unix timestamp


class RevealBatchRequest(BaseModel):
    items: list[RevealRequest]


class TxResponse(BaseModel):
    tx_hash: str
    block_number: int
    gas_used: int
    nullifier: str


class BatchTxResponse(BaseModel):
    tx_hash: str
    block_number: int
    gas_used: int
    count: int


class StatusResponse(BaseModel):
    nullifier: str
    state: str  # UNREVEALED, REVEALED, SPENT
    amount: int  # wei, 0 if unrevealed


class HealthResponse(BaseModel):
    status: str
    relayer_address: str
    contract_address: str
    chain_id: int
    relayer_balance_wei: str


# ── Relayer core ──────────────────────────────────────────────────────────────


class Relayer:
    def __init__(self, config: RelayerConfig) -> None:
        self.config = config
        self.w3 = Web3(Web3.HTTPProvider(config.rpc_http_url))
        self.contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(config.contract_address),
            abi=NOZK_VAULT_ABI,
        )
        self.wallet = Web3.to_checksum_address(config.wallet_address)
        self._tx_lock = threading.Lock()

    def _log_tx(self, action: str, nullifier: str, tx_hash: str, block: int, gas: int) -> None:
        if is_quiet():
            return
        console.print(
            Text.assemble(
                (f"  ✅  {action}  ", "success"),
                ("nullifier=", "muted"),
                (_shorten(nullifier, 8, 6), "addr"),
                ("  tx=", "muted"),
                (_shorten(tx_hash, 10, 8), "hash"),
                ("  block=", "muted"),
                (str(block), "num"),
                ("  gas=", "muted"),
                (str(gas), "num"),
            )
        )

    def _send_tx(self, tx_builder) -> tuple[str, int, int]:
        """Build, sign, send, and wait for a transaction. Returns (tx_hash, block, gas)."""
        with self._tx_lock:
            nonce = self.w3.eth.get_transaction_count(self.wallet, "pending")
            gas_price = self.w3.eth.gas_price

            try:
                tx = tx_builder.build_transaction(
                    {
                        "from": self.wallet,
                        "nonce": nonce,
                        "gasPrice": gas_price,
                    }
                )
            except (ContractCustomError, ContractLogicError) as exc:
                msg = f"Contract simulation reverted: {decode_contract_error(exc)}"
                raise HTTPException(status_code=400, detail=msg)

            signed = self.w3.eth.account.sign_transaction(tx, private_key=self.config.wallet_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)

        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
        if receipt["status"] != 1:
            raise HTTPException(status_code=500, detail=f"Transaction reverted: {tx_hash.hex()}")

        return tx_hash.hex(), receipt["blockNumber"], receipt["gasUsed"]

    def validate_reveal(self, req: RevealRequest) -> None:
        """Off-chain pre-validation for reveal (BLS12-381 standard scheme)."""
        # Parse G1 spend pubkey and G2 signature from request
        try:
            spend_pub = parse_g1_sol(*[int(c, 16) for c in req.spend_pub_g1])
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid G1 spend pubkey: {exc}")
        try:
            S = parse_g2_sol(*[int(c, 16) for c in req.s_g2])
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid G2 signature: {exc}")

        # BLS pairing pre-check (if we have the pubkey)
        if self.config.mint_bls_pubkey is not None:
            Y = hash_to_g2(abi_encode_g1(spend_pub))
            if not verify_mint_pairing(S, Y, self.config.mint_bls_pubkey):
                raise HTTPException(status_code=400, detail="BLS pairing check failed")

        # Compute nullifier ID
        from eth_utils import keccak

        nullifier_id = keccak(abi_encode_g1(spend_pub))
        state_val = self.contract.functions.nullifierState(nullifier_id).call()
        if state_val != 0:
            state_name = {1: "REVEALED", 2: "SPENT"}.get(state_val, f"UNKNOWN({state_val})")
            raise HTTPException(status_code=409, detail=f"Nullifier already {state_name}")

    def validate_redeem(self, req: RedeemRequest) -> None:
        """Off-chain pre-validation for redeem (BLS spend signature)."""
        from chia_rs import AugSchemeMPL, G1Element, G2Element

        recipient = Web3.to_checksum_address(req.recipient)

        # Deadline check
        if req.deadline < int(time.time()):
            raise HTTPException(status_code=400, detail="Deadline has already passed")

        # Parse BLS spend signature (compressed G2) and spend pubkey (compressed G1)
        try:
            sigma = G2Element.from_bytes(bytes.fromhex(req.spend_sigma_compressed))
            spend_pk = G1Element.from_bytes(bytes.fromhex(req.spend_pk_compressed))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid BLS signature or pubkey: {exc}")

        # BLS spend sig pre-check
        msg_hash = self.contract.functions.redemptionMessageHash(recipient, req.deadline).call()
        try:
            if not AugSchemeMPL.verify(spend_pk, msg_hash, sigma):
                raise HTTPException(status_code=400, detail="BLS spend signature verification failed")
        except VerificationError as exc:
            raise HTTPException(status_code=400, detail=f"Malformed BLS signature: {exc}")

        # On-chain state check
        nullifier_id = bytes.fromhex(req.nullifier_id)
        state_val = self.contract.functions.nullifierState(nullifier_id).call()
        if state_val != 1:  # 1 = REVEALED
            state_name = {0: "UNREVEALED", 2: "SPENT"}.get(state_val, f"UNKNOWN({state_val})")
            raise HTTPException(status_code=409, detail=f"Nullifier is {state_name}, expected REVEALED")

    def submit_reveal(self, req: RevealRequest) -> TxResponse:
        self.validate_reveal(req)

        spend_pub_coords = [int(c, 16) for c in req.spend_pub_g1]
        s_coords = [int(c, 16) for c in req.s_g2]

        tx_builder = self.contract.functions.reveal(spend_pub_coords, s_coords)
        tx_hash, block, gas = self._send_tx(tx_builder)

        nid = req.spend_pub_g1[0][:10]  # short display
        self._log_tx("reveal", nid, tx_hash, block, gas)
        return TxResponse(tx_hash=tx_hash, block_number=block, gas_used=gas, nullifier=nid)

    def submit_reveal_batch(self, items: list[RevealRequest]) -> BatchTxResponse:
        spend_pubs = []
        sigs = []
        for item in items:
            self.validate_reveal(item)
            spend_pubs.append([int(c, 16) for c in item.spend_pub_g1])
            sigs.append([int(c, 16) for c in item.s_g2])

        tx_builder = self.contract.functions.revealBatch(spend_pubs, sigs)
        tx_hash, block, gas = self._send_tx(tx_builder)

        if not is_quiet():
            console.print(
                Text.assemble(
                    ("  revealBatch  ", "success"),
                    ("count=", "muted"),
                    (str(len(items)), "num"),
                    ("  tx=", "muted"),
                    (_shorten(tx_hash, 10, 8), "hash"),
                    ("  block=", "muted"),
                    (str(block), "num"),
                    ("  gas=", "muted"),
                    (str(gas), "num"),
                )
            )
        return BatchTxResponse(tx_hash=tx_hash, block_number=block, gas_used=gas, count=len(items))

    def submit_redeem(self, req: RedeemRequest) -> TxResponse:
        """Submit a redeem transaction on behalf of the user.

        Decompresses the BLS spend signature from chia_rs compressed G2 (96 bytes)
        to EIP-2537 uncompressed format (8 uint256) for the on-chain call.
        """
        from chia_rs import G2Element
        from py_ecc.bls.g2_primitives import signature_to_G2

        from bls12_381_crypto import G2Point, serialize_g2_sol

        self.validate_redeem(req)

        recipient = Web3.to_checksum_address(req.recipient)

        # Decompress BLS spend sig: compressed G2 (96 bytes) → EIP-2537 (8 uint256)
        sigma_chia = G2Element.from_bytes(bytes.fromhex(req.spend_sigma_compressed))
        spend_sig_pyecc = G2Point(signature_to_G2(sigma_chia.to_bytes()))
        spend_sig_coords = list(serialize_g2_sol(spend_sig_pyecc))

        nid_bytes = bytes.fromhex(req.nullifier_id)

        tx_builder = self.contract.functions.redeem(recipient, spend_sig_coords, nid_bytes, req.deadline)
        tx_hash, block, gas = self._send_tx(tx_builder)

        self._log_tx("redeem", req.nullifier_id[:18], tx_hash, block, gas)
        return TxResponse(tx_hash=tx_hash, block_number=block, gas_used=gas, nullifier=req.nullifier_id)

    def get_status(self, nullifier_addr: str) -> StatusResponse:
        nullifier = Web3.to_checksum_address(nullifier_addr)
        state_val = self.contract.functions.nullifierState(nullifier).call()
        amount = self.contract.functions.revealedAmount(nullifier).call()
        state_name = {0: "UNREVEALED", 1: "REVEALED", 2: "SPENT"}.get(state_val, f"UNKNOWN({state_val})")
        return StatusResponse(nullifier=nullifier, state=state_name, amount=amount)

    def get_health(self) -> HealthResponse:
        balance = self.w3.eth.get_balance(self.wallet)
        return HealthResponse(
            status="ok",
            relayer_address=self.wallet,
            contract_address=self.config.contract_address,
            chain_id=self.config.chain_id,
            relayer_balance_wei=str(balance),
        )


# ── FastAPI app ───────────────────────────────────────────────────────────────

fastapi_app = FastAPI(title="Nozk Relayer", version="0.1.0")

_relayer: Optional[Relayer] = None


def get_relayer() -> Relayer:
    assert _relayer is not None, "Relayer not initialized"
    return _relayer


@fastapi_app.post("/reveal", response_model=TxResponse)
def api_reveal(req: RevealRequest) -> TxResponse:
    return get_relayer().submit_reveal(req)


@fastapi_app.post("/reveal/batch", response_model=BatchTxResponse)
def api_reveal_batch(req: RevealBatchRequest) -> BatchTxResponse:
    return get_relayer().submit_reveal_batch(req.items)


@fastapi_app.post("/redeem", response_model=TxResponse)
def api_redeem(req: RedeemRequest) -> TxResponse:
    return get_relayer().submit_redeem(req)


@fastapi_app.get("/status/{nullifier}", response_model=StatusResponse)
def api_status(nullifier: str) -> StatusResponse:
    return get_relayer().get_status(nullifier)


@fastapi_app.get("/health", response_model=HealthResponse)
def api_health() -> HealthResponse:
    return get_relayer().get_health()


# ── Typer CLI ─────────────────────────────────────────────────────────────────

cli = typer.Typer(
    name="relayer-server",
    help="Nozk Protocol Relayer — reveal & redeem service.",
    add_completion=False,
    rich_markup_mode="rich",
    pretty_exceptions_enable=False,
)


@cli.command()
def run(
    port: int = typer.Option(8000, "--port", "-p", help="HTTP port."),
    host: str = typer.Option("0.0.0.0", "--host", help="Bind address."),
    verbosity: Verbosity = typer.Option(
        Verbosity.normal,
        "--verbosity",
        "-v",
        help=(
            "[bold]quiet[/bold] errors only · "
            "[bold]normal[/bold] key events · "
            "[bold]verbose[/bold] intermediates · "
            "[bold]debug[/bold] raw data"
        ),
        show_default=True,
    ),
) -> None:
    """Start the Nozk relayer HTTP server."""
    global _verbosity, _relayer
    _verbosity = verbosity

    effective_log_level = VERBOSITY_TO_LOG_LEVEL[verbosity]
    logging.basicConfig(level=effective_log_level, format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s")
    if verbosity != Verbosity.debug:
        for noisy in ("web3", "websockets", "asyncio", "uvicorn.access"):
            logging.getLogger(noisy).setLevel(logging.ERROR)

    print_banner()
    config = load_config()
    _relayer = Relayer(config)
    print_config(config)

    # Quick connectivity check
    try:
        chain_id = _relayer.w3.eth.chain_id
        block = _relayer.w3.eth.block_number
        balance = _relayer.w3.eth.get_balance(_relayer.wallet)
        if not is_quiet():
            console.print(
                Text.assemble(
                    ("  ✅  Connected  ", "success"),
                    ("chain=", "muted"),
                    (str(chain_id), "num"),
                    ("  block=", "muted"),
                    (str(block), "num"),
                    ("  balance=", "muted"),
                    (f"{Web3.from_wei(balance, 'ether'):.6f} ETH", "num"),
                )
            )
            console.print()
    except Exception as exc:
        console.print(f"[error]  ❌  Cannot connect to RPC: {exc}[/error]")
        raise typer.Exit(code=1)

    if not is_quiet():
        console.print(Text(f"  🌐  Listening on http://{host}:{port}\n", style="secondary"))

    uvicorn.run(
        fastapi_app,
        host=host,
        port=port,
        log_level="warning" if verbosity != Verbosity.debug else "info",
    )


if __name__ == "__main__":
    cli()
