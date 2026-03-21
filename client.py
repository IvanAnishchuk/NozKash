"""
Ghost-Tip Protocol: CLI Wallet

Reference implementation of the full client lifecycle. Each command maps to
one phase of the protocol and prints every intermediate cryptographic value
so the output can be used as a debugging reference when building other clients.

Commands:
    deposit   Blind a token and submit a deposit transaction to GhostVault
    scan      Scan chain events to find and recover pending/spendable tokens
    redeem    Unblind a recovered token and redeem it to a destination address
    status    Show wallet state: known tokens, spent nullifiers, balances
    balance   Query on-chain ETH balance for the wallet address

Configuration (.env):
    MASTER_SEED             Hex string seed (from generate_keys.py)
    WALLET_ADDRESS          Ethereum address that pays gas for deposit/redeem
    WALLET_KEY              Private key for the above (hex, with or without 0x)
    CONTRACT_ADDRESS        Deployed GhostVault contract address
    RPC_HTTP_URL            HTTP RPC endpoint (e.g. https://sepolia.infura.io/...)
    SCAN_FROM_BLOCK         Block to start scanning from (default: 0)

Usage:
    uv run client.py deposit --index 0
    uv run client.py scan --from-block 7000000 --indices 0 1 2 3 4
    uv run client.py redeem --index 0 --to 0xRecipientAddress
    uv run client.py status
    uv run client.py balance
"""

import argparse
import json
import logging
import os
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from web3 import Web3

from ghost_library import (
    G1Point, G2Point, Scalar,
    derive_token_secrets, blind_token, unblind_signature,
    generate_redemption_proof, serialize_g1, parse_g1,
    verify_bls_pairing, verify_ecdsa_mev_protection,
    GhostError, InvalidPointError,
)

load_dotenv()

# ==============================================================================
# LOGGING — verbose, structured, with section banners
# ==============================================================================

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ghost_client")

DENOMINATION_WEI = 10_000_000_000_000_000  # 0.01 ETH


def banner(title: str) -> None:
    log.info("")
    log.info("━" * 60)
    log.info("  %s", title)
    log.info("━" * 60)


def section(title: str) -> None:
    log.info("")
    log.info("── %s", title)


def field_log(name: str, value: str) -> None:
    log.info("    %-28s %s", name + ":", value)


# ==============================================================================
# WALLET STATE  (persisted to .ghost_wallet.json)
# ==============================================================================

WALLET_STATE_FILE = Path(".ghost_wallet.json")


@dataclass
class TokenRecord:
    """Persisted record for a single token across its full lifecycle."""
    index:          int
    spend_address:  str                     # The nullifier / token identity
    deposit_id:     Optional[str] = None    # 0x-hex uint256 from DepositLocked
    deposit_tx:     Optional[str] = None    # Deposit transaction hash
    deposit_block:  Optional[int] = None
    s_unblinded_x:  Optional[str] = None    # Hex — recovered after unblinding S'
    s_unblinded_y:  Optional[str] = None
    redeem_tx:      Optional[str] = None
    spent:          bool = False

    @property
    def has_token(self) -> bool:
        return self.s_unblinded_x is not None

    @property
    def status(self) -> str:
        if self.spent:
            return "SPENT"
        if self.has_token:
            return "READY_TO_REDEEM"
        if self.deposit_id:
            return "AWAITING_MINT"
        return "FRESH"


@dataclass
class WalletState:
    tokens: dict[int, TokenRecord] = field(default_factory=dict)
    last_scanned_block: int = 0

    def save(self) -> None:
        data = {
            "tokens": {
                str(idx): asdict(rec)
                for idx, rec in self.tokens.items()
            },
            "last_scanned_block": self.last_scanned_block,
        }
        WALLET_STATE_FILE.write_text(json.dumps(data, indent=2))
        log.debug("Wallet state saved to %s", WALLET_STATE_FILE)

    @classmethod
    def load(cls) -> "WalletState":
        if not WALLET_STATE_FILE.exists():
            return cls()
        data = json.loads(WALLET_STATE_FILE.read_text())
        tokens = {
            int(idx): TokenRecord(**rec)
            for idx, rec in data.get("tokens", {}).items()
        }
        return cls(
            tokens=tokens,
            last_scanned_block=data.get("last_scanned_block", 0),
        )


# ==============================================================================
# CONFIGURATION
# ==============================================================================

@dataclass(frozen=True)
class ClientConfig:
    master_seed:      bytes
    wallet_address:   str
    wallet_key:       str
    contract_address: str
    rpc_http_url:     str
    scan_from_block:  int


def load_config() -> ClientConfig:
    missing = []

    def require(key: str) -> str:
        val = os.getenv(key, "").strip()
        if not val:
            missing.append(key)
        return val

    seed_hex     = require("MASTER_SEED")
    wallet_addr  = require("WALLET_ADDRESS")
    wallet_key   = require("WALLET_KEY")
    contract     = require("CONTRACT_ADDRESS")
    rpc_url      = require("RPC_HTTP_URL")

    if missing:
        log.error("Missing required .env variables: %s", ", ".join(missing))
        log.error("Run generate_keys.py to create a .env, then add WALLET_ADDRESS,")
        log.error("WALLET_KEY, CONTRACT_ADDRESS, and RPC_HTTP_URL.")
        sys.exit(1)

    return ClientConfig(
        master_seed=seed_hex.encode("utf-8"),
        wallet_address=wallet_addr,
        wallet_key=wallet_key if wallet_key.startswith("0x") else "0x" + wallet_key,
        contract_address=contract,
        rpc_http_url=rpc_url,
        scan_from_block=int(os.getenv("SCAN_FROM_BLOCK", "0")),
    )


# ==============================================================================
# CONTRACT ABI
# ==============================================================================

GHOST_VAULT_ABI = [
    {
        "name": "DepositLocked",
        "type": "event",
        "inputs": [
            {"name": "depositId", "type": "uint256", "indexed": True},
            {"name": "B",         "type": "uint256[2]", "indexed": False},
        ],
    },
    {
        "name": "MintFulfilled",
        "type": "event",
        "inputs": [
            {"name": "depositId",        "type": "uint256", "indexed": True},
            {"name": "blindedSignature", "type": "uint256[2]", "indexed": False},
        ],
    },
    {
        "name": "deposit",
        "type": "function",
        "stateMutability": "payable",
        "inputs": [
            {"name": "blindedPointB", "type": "uint256[2]"},
        ],
        "outputs": [],
    },
    {
        "name": "redeem",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "recipient",          "type": "address"},
            {"name": "spendSignature",     "type": "bytes"},
            {"name": "unblindedSignatureS","type": "uint256[2]"},
        ],
        "outputs": [],
    },
    {
        "name": "spentNullifiers",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "", "type": "address"}],
        "outputs": [{"name": "", "type": "bool"}],
    },
]


# ==============================================================================
# HELPERS
# ==============================================================================

def encode_spend_signature(compact_hex: str, recovery_bit: int) -> bytes:
    """
    Encodes the ECDSA signature for Solidity ecrecover.

    Solidity's ecrecover expects 65 bytes: r (32) + s (32) + v (1)
    where v = recovery_bit + 27.

    The compact_hex from ghost_library is already r||s as 128 hex chars.
    """
    r_bytes = bytes.fromhex(compact_hex[:64])
    s_bytes = bytes.fromhex(compact_hex[64:])
    v_byte  = bytes([recovery_bit + 27])
    return r_bytes + s_bytes + v_byte


def build_web3(config: ClientConfig) -> Web3:
    w3 = Web3(Web3.HTTPProvider(config.rpc_http_url))
    if not w3.is_connected():
        log.error("Cannot connect to RPC: %s", config.rpc_http_url)
        sys.exit(1)
    return w3


# ==============================================================================
# COMMAND: deposit
# ==============================================================================

def cmd_deposit(config: ClientConfig, token_index: int) -> None:
    banner(f"DEPOSIT  —  Token Index {token_index}")

    state = WalletState.load()
    w3    = build_web3(config)

    # ── Step 1: Derive token secrets ──────────────────────────────────────────
    section("Step 1 · Derive Token Secrets")
    secrets = derive_token_secrets(config.master_seed, token_index)

    field_log("Token index",      str(token_index))
    field_log("Spend address",    secrets.spend_address_hex)
    field_log("Blinding scalar r", hex(secrets.r))
    log.info("")
    log.info("    The spend address IS the token secret. It is derived")
    log.info("    deterministically and never leaves the client.")

    # ── Step 2: Blind the token ───────────────────────────────────────────────
    section("Step 2 · Blind Token → G1")
    blinded = blind_token(secrets.spend_address_bytes, secrets.r)
    b_x, b_y = serialize_g1(blinded.B)
    y_x, y_y = serialize_g1(blinded.Y)

    field_log("Y = H(spend_addr) x", hex(y_x))
    field_log("Y = H(spend_addr) y", hex(y_y))
    field_log("B = r·Y  x",          hex(b_x))
    field_log("B = r·Y  y",          hex(b_y))
    log.info("")
    log.info("    B is the blinded point sent to the contract.")
    log.info("    The mint cannot derive the spend address from B without r.")

    # ── Step 3: Simulate deposit_id ───────────────────────────────────────────
    section("Step 3 · Simulate depositId (for record keeping)")
    # The contract computes: keccak256(abi.encodePacked(msg.sender, block.timestamp, B))
    # We can't know the exact value pre-submission, but we record B so we can match
    # the DepositLocked event during scan.
    log.info("    depositId will be emitted by the contract after submission.")
    log.info("    Run 'scan' after the mint responds to recover the token.")

    # ── Step 4: Submit deposit transaction ────────────────────────────────────
    section("Step 4 · Submit deposit() Transaction")

    contract = w3.eth.contract(
        address=Web3.to_checksum_address(config.contract_address),
        abi=GHOST_VAULT_ABI,
    )
    wallet = Web3.to_checksum_address(config.wallet_address)

    nonce     = w3.eth.get_transaction_count(wallet)
    gas_price = w3.eth.gas_price
    balance   = w3.eth.get_balance(wallet)

    field_log("Wallet address",  wallet)
    field_log("Wallet balance",  f"{Web3.from_wei(balance, 'ether'):.6f} ETH")
    field_log("Nonce",           str(nonce))
    field_log("Gas price",       f"{Web3.from_wei(gas_price, 'gwei'):.2f} gwei")
    field_log("Deposit amount",  "0.01 ETH")

    if balance < DENOMINATION_WEI:
        log.error("Insufficient balance: need at least 0.01 ETH")
        sys.exit(1)

    tx = contract.functions.deposit([b_x, b_y]).build_transaction({
        "from":     wallet,
        "value":    DENOMINATION_WEI,
        "nonce":    nonce,
        "gasPrice": gas_price,
    })

    signed   = w3.eth.account.sign_transaction(tx, private_key=config.wallet_key)
    tx_hash  = w3.eth.send_raw_transaction(signed.raw_transaction)
    tx_hex   = tx_hash.hex()

    field_log("Transaction sent", tx_hex)
    log.info("    Waiting for confirmation...")

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

    if receipt["status"] != 1:
        log.error("Transaction REVERTED  tx=%s", tx_hex)
        sys.exit(1)

    field_log("Confirmed at block", str(receipt["blockNumber"]))
    field_log("Gas used",           str(receipt["gasUsed"]))

    # Extract depositId from the DepositLocked event in the receipt
    deposit_id_hex = None
    logs = contract.events.DepositLocked().process_receipt(receipt)
    if logs:
        deposit_id     = logs[0]["args"]["depositId"]
        deposit_id_hex = hex(deposit_id)
        field_log("depositId", deposit_id_hex)
        log.info("")
        log.info("    DepositLocked event received. The mint server will now")
        log.info("    sign B and call announce() with the blinded signature S'.")

    # ── Persist ───────────────────────────────────────────────────────────────
    state.tokens[token_index] = TokenRecord(
        index=token_index,
        spend_address=secrets.spend_address_hex,
        deposit_id=deposit_id_hex,
        deposit_tx=tx_hex,
        deposit_block=receipt["blockNumber"],
    )
    state.save()

    log.info("")
    log.info("✅  Deposit complete. Next: run 'scan' to recover the signed token.")


# ==============================================================================
# COMMAND: scan
# ==============================================================================

def cmd_scan(
    config: ClientConfig,
    from_block: Optional[int],
    indices: list[int],
) -> None:
    banner("SCAN  —  Recovering Tokens from Chain Events")

    state    = WalletState.load()
    w3       = build_web3(config)
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(config.contract_address),
        abi=GHOST_VAULT_ABI,
    )

    start_block  = from_block if from_block is not None else state.last_scanned_block
    latest_block = w3.eth.block_number

    field_log("Scanning blocks",   f"{start_block} → {latest_block}")
    field_log("Token indices",     str(indices) if indices else "all known")
    log.info("")

    # ── Step 1: Fetch all MintFulfilled events in range ───────────────────────
    section("Step 1 · Fetch MintFulfilled Events")

    fulfilled_events = contract.events.MintFulfilled().get_logs(
        from_block=start_block,
        to_block=latest_block,
    )

    field_log("MintFulfilled events found", str(len(fulfilled_events)))

    # Build a lookup: depositId → blinded_signature coords
    fulfilled: dict[int, tuple[int, int]] = {}
    for evt in fulfilled_events:
        did  = evt["args"]["depositId"]
        sig  = evt["args"]["blindedSignature"]
        fulfilled[did] = (int(sig[0]), int(sig[1]))
        log.debug("    MintFulfilled  depositId=0x%x  S'.x=0x%x...", did, sig[0] >> 240)

    # ── Step 2: Also fetch DepositLocked to match unknown tokens ─────────────
    section("Step 2 · Fetch DepositLocked Events (for unknown deposits)")

    deposit_events = contract.events.DepositLocked().get_logs(
        from_block=start_block,
        to_block=latest_block,
    )
    field_log("DepositLocked events found", str(len(deposit_events)))

    # ── Step 3: Derive secrets for each candidate index and try to match ──────
    section("Step 3 · Match Events to Token Indices")

    scan_indices = indices if indices else list(state.tokens.keys())
    recovered = 0

    for idx in scan_indices:
        log.info("")
        log.info("  ── Token %d ──", idx)

        secrets = derive_token_secrets(config.master_seed, idx)
        blinded = blind_token(secrets.spend_address_bytes, secrets.r)
        b_x, b_y = serialize_g1(blinded.B)

        field_log("  Spend address",   secrets.spend_address_hex)
        field_log("  B.x",             hex(b_x))
        field_log("  B.y",             hex(b_y))

        # Find the depositId for this token by matching B in DepositLocked events
        matched_deposit_id = None
        for evt in deposit_events:
            raw_b = evt["args"]["B"]
            if int(raw_b[0]) == b_x and int(raw_b[1]) == b_y:
                matched_deposit_id = evt["args"]["depositId"]
                field_log("  DepositLocked match", f"depositId=0x{matched_deposit_id:x}")
                break

        # Also check already-known deposit_id from state
        if matched_deposit_id is None and idx in state.tokens:
            stored = state.tokens[idx]
            if stored.deposit_id:
                matched_deposit_id = int(stored.deposit_id, 16)
                field_log("  depositId (from state)", hex(matched_deposit_id))

        if matched_deposit_id is None:
            log.info("  No deposit found for token %d in this range", idx)
            continue

        # Check if we have a MintFulfilled for this deposit
        if matched_deposit_id not in fulfilled:
            log.info("  Deposit found, but mint has not yet responded (no MintFulfilled)")
            field_log("  Token status", "AWAITING_MINT")
            if idx not in state.tokens:
                state.tokens[idx] = TokenRecord(
                    index=idx,
                    spend_address=secrets.spend_address_hex,
                    deposit_id=hex(matched_deposit_id),
                )
            continue

        s_prime_x, s_prime_y = fulfilled[matched_deposit_id]
        field_log("  S'.x (blind sig)",  hex(s_prime_x))
        field_log("  S'.y (blind sig)",  hex(s_prime_y))

        # ── Step 4: Unblind the signature ──────────────────────────────────
        log.info("  Unblinding: S = S' · r⁻¹ mod q ...")

        S_prime = parse_g1(s_prime_x, s_prime_y)
        S       = unblind_signature(S_prime, secrets.r)
        s_x, s_y = serialize_g1(S)

        field_log("  S.x (unblinded)",   hex(s_x))
        field_log("  S.y (unblinded)",   hex(s_y))

        # ── Step 5: Local BLS pairing verification ────────────────────────
        # We need PK_mint to verify. For now, verify structure is sound.
        # Full pairing check is done in cmd_redeem with the actual PK_mint.
        log.info("  Token unblinded successfully.")
        log.info("  BLS pairing will be verified at redemption time.")

        # ── Step 6: Check nullifier on-chain ──────────────────────────────
        nullifier_addr = Web3.to_checksum_address(secrets.spend_address_hex)
        is_spent = contract.functions.spentNullifiers(nullifier_addr).call()
        field_log("  Nullifier spent on-chain", str(is_spent))

        rec = state.tokens.get(idx, TokenRecord(
            index=idx,
            spend_address=secrets.spend_address_hex,
            deposit_id=hex(matched_deposit_id),
        ))
        rec.s_unblinded_x = hex(s_x)
        rec.s_unblinded_y = hex(s_y)
        rec.spent         = is_spent
        state.tokens[idx] = rec
        recovered += 1

        status = "SPENT (already redeemed on-chain)" if is_spent else "READY_TO_REDEEM"
        field_log("  Token status", status)

    state.last_scanned_block = latest_block
    state.save()

    log.info("")
    log.info("━" * 60)
    log.info("  Scan complete.  %d token(s) recovered.  Block %d saved.",
             recovered, latest_block)


# ==============================================================================
# COMMAND: redeem
# ==============================================================================

def cmd_redeem(config: ClientConfig, token_index: int, recipient: str) -> None:
    banner(f"REDEEM  —  Token Index {token_index}  →  {recipient}")

    state = WalletState.load()
    w3    = build_web3(config)

    if token_index not in state.tokens:
        log.error("Token %d not found in wallet state. Run 'scan' first.", token_index)
        sys.exit(1)

    rec = state.tokens[token_index]

    if rec.spent:
        log.error("Token %d is already spent (nullifier recorded on-chain).", token_index)
        sys.exit(1)

    if not rec.has_token:
        log.error("Token %d has no unblinded signature. Run 'scan' first.", token_index)
        sys.exit(1)

    # ── Step 1: Reconstruct unblinded signature from state ────────────────────
    section("Step 1 · Load Unblinded Signature from Wallet State")

    s_x = int(rec.s_unblinded_x, 16)
    s_y = int(rec.s_unblinded_y, 16)
    S   = parse_g1(s_x, s_y)

    field_log("S.x", hex(s_x))
    field_log("S.y", hex(s_y))

    # ── Step 2: Derive token secrets for the spend key ────────────────────────
    section("Step 2 · Derive Spend Key")

    secrets = derive_token_secrets(config.master_seed, token_index)
    field_log("Spend address (nullifier)", secrets.spend_address_hex)
    log.info("")
    log.info("    The spend address is the nullifier. The contract records it")
    log.info("    as spent after this redemption to prevent double-spending.")

    # ── Step 3: Local BLS verification (pre-flight check) ────────────────────
    section("Step 3 · Pre-flight BLS Verification")
    blinded = blind_token(secrets.spend_address_bytes, secrets.r)
    log.info("    Re-deriving Y = H(spend_address) for pairing check...")
    log.info("    Note: full pairing requires PK_mint — skipped here if not")
    log.info("    available. The contract will enforce this on-chain.")
    log.info("    (Add PK_MINT to .env for local pre-flight pairing check.)")

    pk_mint_hex = os.getenv("PK_MINT_X_REAL")
    if pk_mint_hex:
        log.info("    PK_mint found in env — running local pairing verification...")
        try:
            from ghost_library import G2Point, _mul_g2
            from py_ecc.bn128 import G2
            pk_mint_sk = Scalar(int(os.getenv("MINT_BLS_PRIVKEY", "0"), 16))
            if pk_mint_sk:
                pk_mint = _mul_g2(G2Point(G2), pk_mint_sk)
                ok = verify_bls_pairing(S, blinded.Y, pk_mint)
                field_log("Local BLS pairing", "✅ VALID" if ok else "❌ INVALID")
                if not ok:
                    log.error("BLS pairing failed locally — token may be invalid.")
                    sys.exit(1)
        except Exception as e:
            log.warning("    Local pairing check skipped: %s", e)
    else:
        log.info("    Skipping local pairing check (MINT_BLS_PRIVKEY not set).")

    # ── Step 4: Generate redemption proof (ECDSA anti-MEV signature) ─────────
    section("Step 4 · Generate Redemption Proof (Anti-MEV ECDSA Signature)")

    recipient_checksum = Web3.to_checksum_address(recipient)
    proof = generate_redemption_proof(secrets.spend_priv, recipient_checksum)

    field_log("Payload",        f"\"Pay to: {recipient_checksum}\"")
    field_log("msg_hash",       proof.msg_hash.hex())
    field_log("compact_hex",    "0x" + proof.compact_hex)
    field_log("recovery_bit",   str(proof.recovery_bit))
    log.info("")
    log.info("    The contract will call ecrecover on this signature.")
    log.info("    The recovered address must match the spend address (nullifier).")
    log.info("    This prevents MEV bots from changing the recipient address.")

    # Verify locally that ecrecover produces the correct nullifier
    is_valid = verify_ecdsa_mev_protection(
        proof.msg_hash,
        proof.compact_hex,
        proof.recovery_bit,
        secrets.spend_address_hex,
    )
    field_log("Local ecrecover check", "✅ VALID" if is_valid else "❌ INVALID")
    if not is_valid:
        log.error("Local ECDSA verification failed — aborting.")
        sys.exit(1)

    # Encode for Solidity: 65 bytes = r(32) + s(32) + v(1), v = recovery_bit + 27
    spend_sig_bytes = encode_spend_signature(proof.compact_hex, proof.recovery_bit)
    field_log("Encoded sig (65 bytes)", "0x" + spend_sig_bytes.hex())
    field_log("v (EVM)",                str(proof.recovery_bit + 27))

    # ── Step 5: Submit redeem() transaction ───────────────────────────────────
    section("Step 5 · Submit redeem() Transaction")

    contract = w3.eth.contract(
        address=Web3.to_checksum_address(config.contract_address),
        abi=GHOST_VAULT_ABI,
    )
    wallet    = Web3.to_checksum_address(config.wallet_address)
    nonce     = w3.eth.get_transaction_count(wallet)
    gas_price = w3.eth.gas_price

    field_log("Caller (pays gas)", wallet)
    field_log("Recipient",         recipient_checksum)
    field_log("Nonce",             str(nonce))
    field_log("Gas price",         f"{Web3.from_wei(gas_price, 'gwei'):.2f} gwei")
    field_log("S.x (Solidity)",    str(s_x))
    field_log("S.y (Solidity)",    str(s_y))

    tx = contract.functions.redeem(
        recipient_checksum,
        spend_sig_bytes,
        [s_x, s_y],
    ).build_transaction({
        "from":     wallet,
        "nonce":    nonce,
        "gasPrice": gas_price,
    })

    signed  = w3.eth.account.sign_transaction(tx, private_key=config.wallet_key)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    tx_hex  = tx_hash.hex()

    field_log("Transaction sent", tx_hex)
    log.info("    Waiting for confirmation...")

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

    if receipt["status"] != 1:
        log.error("Transaction REVERTED  tx=%s", tx_hex)
        log.error("Possible causes: token already spent, invalid BLS pairing,")
        log.error("invalid ECDSA signature, or wrong recovery bit.")
        sys.exit(1)

    field_log("Confirmed at block",  str(receipt["blockNumber"]))
    field_log("Gas used",            str(receipt["gasUsed"]))
    log.info("")
    log.info("    On-chain checks passed:")
    log.info("      ✅  ecrecover → nullifier matches spend address")
    log.info("      ✅  spentNullifiers[nullifier] was false")
    log.info("      ✅  ecPairing: e(S, G2) == e(H(nullifier), PK_mint)")
    log.info("      ✅  0.01 ETH transferred to %s", recipient_checksum)

    # ── Persist ───────────────────────────────────────────────────────────────
    rec.redeem_tx = tx_hex
    rec.spent     = True
    state.save()

    log.info("")
    log.info("✅  Redemption complete. Token %d is now spent.", token_index)


# ==============================================================================
# COMMAND: status
# ==============================================================================

def cmd_status(config: ClientConfig) -> None:
    banner("WALLET STATUS")

    state = WalletState.load()
    w3    = build_web3(config)

    wallet  = Web3.to_checksum_address(config.wallet_address)
    balance = w3.eth.get_balance(wallet)

    section("On-chain Balance")
    field_log("Wallet address", wallet)
    field_log("ETH balance",    f"{Web3.from_wei(balance, 'ether'):.6f} ETH")

    section("Token Records")
    if not state.tokens:
        log.info("    No tokens in wallet state. Run 'deposit' to create one.")
        return

    field_log("Last scanned block", str(state.last_scanned_block))
    log.info("")

    for idx in sorted(state.tokens):
        rec = state.tokens[idx]
        log.info("  Token %-4d  %-20s  spend=%s",
                 idx, rec.status, rec.spend_address)
        if rec.deposit_id:
            log.info("             deposit_id=%s  tx=%s",
                     rec.deposit_id, rec.deposit_tx or "—")
        if rec.has_token:
            log.info("             S.x=%s...", rec.s_unblinded_x[:18])
        if rec.redeem_tx:
            log.info("             redeem_tx=%s", rec.redeem_tx)


# ==============================================================================
# COMMAND: balance
# ==============================================================================

def cmd_balance(config: ClientConfig) -> None:
    banner("BALANCE CHECK")

    w3      = build_web3(config)
    wallet  = Web3.to_checksum_address(config.wallet_address)
    balance = w3.eth.get_balance(wallet)

    field_log("Address", wallet)
    field_log("Balance", f"{Web3.from_wei(balance, 'ether'):.8f} ETH")
    field_log("Wei",     str(balance))


# ==============================================================================
# CLI ARGUMENT PARSING
# ==============================================================================

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="client.py",
        description="Ghost-Tip Protocol CLI Wallet",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # deposit
    p_dep = sub.add_parser("deposit", help="Blind and deposit a token")
    p_dep.add_argument("--index", type=int, required=True,
                       help="Token index (0-based, must be unique per seed)")

    # scan
    p_scan = sub.add_parser("scan", help="Scan chain for MintFulfilled events and recover tokens")
    p_scan.add_argument("--from-block", type=int, default=None,
                        help="Block to start scanning from (default: last scanned)")
    p_scan.add_argument("--indices", type=int, nargs="+", default=[],
                        help="Token indices to scan for (default: all known)")

    # redeem
    p_red = sub.add_parser("redeem", help="Redeem an unblinded token to a destination")
    p_red.add_argument("--index", type=int, required=True,
                       help="Token index to redeem")
    p_red.add_argument("--to",    type=str, required=True,
                       help="Recipient Ethereum address")

    # status
    sub.add_parser("status", help="Show wallet state and token statuses")

    # balance
    sub.add_parser("balance", help="Query on-chain ETH balance")

    return parser


# ==============================================================================
# ENTRY POINT
# ==============================================================================

def main() -> None:
    parser = build_parser()
    args   = parser.parse_args()
    config = load_config()

    if args.command == "deposit":
        cmd_deposit(config, args.index)
    elif args.command == "scan":
        cmd_scan(config, args.from_block, args.indices)
    elif args.command == "redeem":
        cmd_redeem(config, args.index, args.to)
    elif args.command == "status":
        cmd_status(config)
    elif args.command == "balance":
        cmd_balance(config)


if __name__ == "__main__":
    main()
