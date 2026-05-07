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

from contract_errors import decode_contract_error
from nozk_library import (
    G1Point,
    G2Point,
    Scalar,
    VerificationError,
    _mul_g2,
    hash_to_curve,
    parse_g1,
    verify_bls_pairing,
    verify_ecdsa_mev_protection,
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
    mint_bls_pubkey: G2Point | None


def _parse_mint_bls_pubkey(raw: str) -> G2Point | None:
    from py_ecc.bn128 import FQ2
    from py_ecc.bn128 import G2 as G2_gen

    if raw:
        parts = [p.strip() for p in raw.split(",")]
        if len(parts) == 4:
            x_imag, x_real, y_imag, y_real = (int(p, 16) for p in parts)
            return G2Point((FQ2([x_real, x_imag]), FQ2([y_real, y_imag])))

    sk_hex = os.getenv("MINT_BLS_PRIVKEY", "").strip() or os.getenv("MINT_BLS_PRIVKEY_INT", "").strip()
    if sk_hex:
        sk_int = int(sk_hex, 16) if sk_hex.startswith("0x") else int(sk_hex)
        return _mul_g2(G2Point(G2_gen), Scalar(sk_int))

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
    nullifier: str  # 0x-prefixed address
    s_x: str  # hex uint256
    s_y: str  # hex uint256


class RedeemRequest(BaseModel):
    recipient: str  # 0x-prefixed address
    spend_signature: str  # 0x-prefixed 65-byte hex (r||s||v)
    nullifier: str  # 0x-prefixed address
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
        """Off-chain pre-validation for reveal."""
        nullifier = Web3.to_checksum_address(req.nullifier)
        s_x = int(req.s_x, 16)
        s_y = int(req.s_y, 16)

        # Check point is on curve
        try:
            S = parse_g1(s_x, s_y)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid G1 point: {exc}")

        # BLS pairing pre-check (if we have the pubkey)
        if self.config.mint_bls_pubkey is not None:
            nullifier_bytes = bytes.fromhex(nullifier[2:])
            Y: G1Point = hash_to_curve(nullifier_bytes)
            if not verify_bls_pairing(S, Y, self.config.mint_bls_pubkey):
                raise HTTPException(status_code=400, detail="BLS pairing check failed — invalid signature")

        # On-chain state check
        state_val = self.contract.functions.nullifierState(nullifier).call()
        if state_val != 0:  # 0 = UNREVEALED
            state_name = {1: "REVEALED", 2: "SPENT"}.get(state_val, f"UNKNOWN({state_val})")
            raise HTTPException(status_code=409, detail=f"Nullifier already {state_name}")

    def validate_redeem(self, req: RedeemRequest) -> None:
        """Off-chain pre-validation for redeem."""
        nullifier = Web3.to_checksum_address(req.nullifier)
        recipient = Web3.to_checksum_address(req.recipient)

        # Deadline check
        if req.deadline < int(time.time()):
            raise HTTPException(status_code=400, detail="Deadline has already passed")

        # Signature format
        sig_hex = req.spend_signature.replace("0x", "")
        if len(sig_hex) != 130:  # 65 bytes = 130 hex chars
            raise HTTPException(status_code=400, detail=f"spend_signature must be 65 bytes, got {len(sig_hex) // 2}")

        # ECDSA pre-check
        r_hex = sig_hex[:64]
        s_hex = sig_hex[64:128]
        v_byte = int(sig_hex[128:130], 16)
        if v_byte not in (27, 28):
            raise HTTPException(status_code=400, detail=f"Invalid signature v byte: {v_byte}, expected 27 or 28")
        recovery_bit = v_byte - 27

        compact_hex = r_hex + s_hex
        try:
            if not verify_ecdsa_mev_protection(
                self.contract.functions.redemptionMessageHash(recipient, req.deadline).call(),
                compact_hex,
                recovery_bit,
                nullifier,
            ):
                raise HTTPException(status_code=400, detail="ECDSA recovery does not match nullifier")
        except VerificationError as exc:
            raise HTTPException(status_code=400, detail=f"Malformed ECDSA signature: {exc}")

        # On-chain state check
        state_val = self.contract.functions.nullifierState(nullifier).call()
        if state_val != 1:  # 1 = REVEALED
            state_name = {0: "UNREVEALED", 2: "SPENT"}.get(state_val, f"UNKNOWN({state_val})")
            raise HTTPException(status_code=409, detail=f"Nullifier is {state_name}, expected REVEALED")

    def submit_reveal(self, req: RevealRequest) -> TxResponse:
        nullifier = Web3.to_checksum_address(req.nullifier)
        s_x = int(req.s_x, 16)
        s_y = int(req.s_y, 16)

        self.validate_reveal(req)

        tx_builder = self.contract.functions.reveal(nullifier, [s_x, s_y])
        tx_hash, block, gas = self._send_tx(tx_builder)

        self._log_tx("reveal", nullifier, tx_hash, block, gas)
        return TxResponse(tx_hash=tx_hash, block_number=block, gas_used=gas, nullifier=nullifier)

    def submit_reveal_batch(self, items: list[RevealRequest]) -> BatchTxResponse:
        nullifiers = []
        sigs = []
        for item in items:
            self.validate_reveal(item)
            nullifiers.append(Web3.to_checksum_address(item.nullifier))
            sigs.append([int(item.s_x, 16), int(item.s_y, 16)])

        tx_builder = self.contract.functions.revealBatch(nullifiers, sigs)
        tx_hash, block, gas = self._send_tx(tx_builder)

        if not is_quiet():
            console.print(
                Text.assemble(
                    ("  ✅  revealBatch  ", "success"),
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
        nullifier = Web3.to_checksum_address(req.nullifier)
        recipient = Web3.to_checksum_address(req.recipient)
        sig_bytes = bytes.fromhex(req.spend_signature.replace("0x", ""))

        self.validate_redeem(req)

        tx_builder = self.contract.functions.redeem(recipient, sig_bytes, nullifier, req.deadline)
        tx_hash, block, gas = self._send_tx(tx_builder)

        self._log_tx("redeem", nullifier, tx_hash, block, gas)
        return TxResponse(tx_hash=tx_hash, block_number=block, gas_used=gas, nullifier=nullifier)

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
