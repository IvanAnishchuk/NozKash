"""
Integration tests for the mint server's signing logic against a local anvil devnet.

Tests sign_deposit() from mint_server.py directly and verifies the full
deposit -> mint sign -> announce -> scan -> unblind -> verify flow against
the actual Solidity contract running on anvil.

Requires: anvil (Foundry), forge, web3 Python package.
Skips automatically if anvil is not available.

Usage:
    cd nozk_py && PYENV_VERSION=system uv run pytest test_mint_integration.py -v
"""

from __future__ import annotations

import json
import shutil
import subprocess
import time

import pytest
from web3 import Web3

from bls12_381_crypto import (
    serialize_g1_sol,
    serialize_g2_sol,
)
from mint_server import sign_deposit
from nozk_library import (
    ScalarMultiplicationError,
    blind_token,
    derive_token_secrets,
    unblind_signature,
    verify_bls_mint_signature,
)
from test_constants import (
    ABI_PATH,
    ANVIL_RPC,
    CHAIN_ID,
    DENOMINATION,
    DEPLOYER_KEY,
    DEPOSITOR_KEY,
    MINT_PK,
    MINT_SCALAR,
    SOL_DIR,
)

# Master seed for token derivation (unique to this test module)
MASTER_SEED = b"mint_integration_test_seed"

# ==============================================================================
# Fixtures
# ==============================================================================


def _anvil_available() -> bool:
    return shutil.which("anvil") is not None


def _wait_for_rpc(url: str, timeout: float = 10.0) -> bool:
    """Poll RPC until it responds or timeout."""
    deadline = time.monotonic() + timeout
    w3 = Web3(Web3.HTTPProvider(url))
    while time.monotonic() < deadline:
        try:
            w3.eth.block_number  # noqa: B018 — side-effect: test connectivity
            return True
        except (ConnectionError, OSError):
            time.sleep(0.1)
    return False


@pytest.fixture(scope="module")
def anvil_process():
    """Start anvil, yield the process, kill on teardown."""
    if not _anvil_available():
        pytest.skip("anvil not found — install Foundry to run e2e tests")

    proc = subprocess.Popen(
        ["anvil", "--chain-id", str(CHAIN_ID), "--silent"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if not _wait_for_rpc(ANVIL_RPC):
        proc.kill()
        pytest.fail("anvil did not start within 10s")

    yield proc

    proc.terminate()
    proc.wait(timeout=5)


@pytest.fixture(scope="module")
def w3(anvil_process):
    """Web3 instance connected to local anvil."""
    return Web3(Web3.HTTPProvider(ANVIL_RPC))


@pytest.fixture(scope="module")
def deployed_contract(w3):
    """Deploy NozkVaultV2 and return the contract instance."""
    if not ABI_PATH.exists():
        pytest.fail(f"V2 ABI not found at {ABI_PATH} — run `cd sol && forge build && python3 sync_abi.py`")

    abi = json.loads(ABI_PATH.read_text())

    # Get bytecode from forge artifact
    artifact_path = SOL_DIR / "out" / "NozkVaultV2.sol" / "NozkVaultV2.json"
    if not artifact_path.exists():
        pytest.fail("Forge artifact not found — run `cd sol && forge build`")
    bytecode = json.loads(artifact_path.read_text())["bytecode"]["object"]

    deployer = w3.eth.account.from_key(DEPLOYER_KEY)

    # Constructor args: pkMint (4 uint256), mintAuthority (address)
    pk_coords = list(serialize_g1_sol(MINT_PK))
    mint_authority = deployer.address

    contract = w3.eth.contract(abi=abi, bytecode=bytecode)
    tx = contract.constructor(pk_coords, mint_authority).build_transaction(
        {
            "from": deployer.address,
            "nonce": w3.eth.get_transaction_count(deployer.address),
            "gas": 5_000_000,
            "gasPrice": w3.eth.gas_price,
        }
    )
    signed = deployer.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    assert receipt["status"] == 1, "Deploy failed"

    return w3.eth.contract(address=receipt["contractAddress"], abi=abi)


# ==============================================================================
# Helper: perform an on-chain deposit
# ==============================================================================


def _do_deposit(w3, vault, depositor_key, secrets):
    """Deposit a token on-chain. Returns (deposit_id, b_coords, blinded)."""
    depositor = w3.eth.account.from_key(depositor_key)
    blinded = blind_token(secrets.spend_bls_pub, secrets.r)
    b_coords = list(serialize_g2_sol(blinded.B))
    deposit_id = Web3.to_checksum_address(secrets.deposit_id)

    tx = vault.functions.deposit(deposit_id, b_coords).build_transaction(
        {
            "from": depositor.address,
            "value": DENOMINATION,
            "nonce": w3.eth.get_transaction_count(depositor.address),
            "gas": 200_000,
            "gasPrice": w3.eth.gas_price,
        }
    )
    signed = depositor.sign_transaction(tx)
    receipt = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.raw_transaction))
    assert receipt["status"] == 1, f"Deposit failed: {receipt}"

    return deposit_id, b_coords, blinded


# ==============================================================================
# Tests
# ==============================================================================


class TestSignDepositUnit:
    """Tests for sign_deposit() that do not require on-chain interaction."""

    def test_sign_deposit_produces_valid_blind_sig(self):
        """Call sign_deposit with known B coords, verify result is a valid G2 point."""
        secrets = derive_token_secrets(MASTER_SEED, 100)
        blinded = blind_token(secrets.spend_bls_pub, secrets.r)

        # Serialize B to 8 uint256 as the contract would store it
        b_coords = list(serialize_g2_sol(blinded.B))

        # Call sign_deposit (the mint server's core function)
        s_prime_coords = sign_deposit(b_coords, MINT_SCALAR)

        # Result should be a tuple of 8 integers
        assert isinstance(s_prime_coords, tuple)
        assert len(s_prime_coords) == 8
        assert all(isinstance(c, int) for c in s_prime_coords)

        # At least some coordinates should be nonzero (not the identity)
        assert any(c != 0 for c in s_prime_coords), "sign_deposit returned the identity point"

        # Deserialize S' and unblind it, then verify the BLS pairing
        from bls12_381_crypto import parse_g2_sol

        S_prime = parse_g2_sol(*s_prime_coords)
        S = unblind_signature(S_prime, secrets.r)

        assert verify_bls_mint_signature(S, blinded.Y, MINT_PK), (
            "Unblinded signature from sign_deposit failed BLS pairing verification"
        )

    def test_sign_deposit_rejects_identity_point(self):
        """Passing G2 identity (all zeros) should raise an error."""
        identity_coords = [0, 0, 0, 0, 0, 0, 0, 0]

        with pytest.raises(ScalarMultiplicationError, match="identity"):
            sign_deposit(identity_coords, MINT_SCALAR)


class TestMintOnChain:
    """Tests requiring anvil devnet and deployed contract."""

    def test_mint_announce_on_chain(self, deployed_contract, w3):
        """Deposit on-chain, call sign_deposit, then announce() — verify MintFulfilled event."""
        vault = deployed_contract
        deployer = w3.eth.account.from_key(DEPLOYER_KEY)

        secrets = derive_token_secrets(MASTER_SEED, 200)
        deposit_id, b_coords, _blinded = _do_deposit(w3, vault, DEPOSITOR_KEY, secrets)

        # Mint signs the blinded point using sign_deposit
        s_prime_coords = sign_deposit(b_coords, MINT_SCALAR)

        # Announce on-chain (mint authority submits the blind signature)
        tx = vault.functions.announce(deposit_id, list(s_prime_coords)).build_transaction(
            {
                "from": deployer.address,
                "nonce": w3.eth.get_transaction_count(deployer.address),
                "gas": 200_000,
                "gasPrice": w3.eth.gas_price,
            }
        )
        signed = deployer.sign_transaction(tx)
        receipt = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.raw_transaction))
        assert receipt["status"] == 1, "announce() failed"

        # Verify MintFulfilled event was emitted
        mint_fulfilled_logs = vault.events.MintFulfilled().process_receipt(receipt)
        assert len(mint_fulfilled_logs) == 1, f"Expected 1 MintFulfilled event, got {len(mint_fulfilled_logs)}"

        event_args = mint_fulfilled_logs[0]["args"]
        assert event_args["depositId"] == deposit_id
        # S_prime in the event should match what sign_deposit returned
        for i in range(8):
            assert event_args["S_prime"][i] == s_prime_coords[i], (
                f"S_prime coord {i} mismatch: event={event_args['S_prime'][i]}, expected={s_prime_coords[i]}"
            )

        # Verify contract state
        assert vault.functions.depositFulfilled(deposit_id).call() is True

    def test_mint_full_flow(self, deployed_contract, w3):
        """Full flow: deposit -> mint sign -> announce -> scan event -> unblind -> verify locally + on-chain."""
        vault = deployed_contract
        deployer = w3.eth.account.from_key(DEPLOYER_KEY)
        depositor = w3.eth.account.from_key(DEPOSITOR_KEY)

        # -- 1. Derive token secrets --
        secrets = derive_token_secrets(MASTER_SEED, 201)
        blinded = blind_token(secrets.spend_bls_pub, secrets.r)
        b_coords = list(serialize_g2_sol(blinded.B))
        deposit_id = Web3.to_checksum_address(secrets.deposit_id)

        # -- 2. Deposit --
        block_before_deposit = w3.eth.block_number
        tx = vault.functions.deposit(deposit_id, b_coords).build_transaction(
            {
                "from": depositor.address,
                "value": DENOMINATION,
                "nonce": w3.eth.get_transaction_count(depositor.address),
                "gas": 200_000,
                "gasPrice": w3.eth.gas_price,
            }
        )
        signed = depositor.sign_transaction(tx)
        receipt = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.raw_transaction))
        assert receipt["status"] == 1, "Deposit failed"

        # -- 3. Mint signs using sign_deposit --
        s_prime_coords = sign_deposit(b_coords, MINT_SCALAR)

        # -- 4. Announce --
        tx = vault.functions.announce(deposit_id, list(s_prime_coords)).build_transaction(
            {
                "from": deployer.address,
                "nonce": w3.eth.get_transaction_count(deployer.address),
                "gas": 200_000,
                "gasPrice": w3.eth.gas_price,
            }
        )
        signed = deployer.sign_transaction(tx)
        announce_receipt = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.raw_transaction))
        assert announce_receipt["status"] == 1, "Announce failed"

        # -- 5. Scan for MintFulfilled event using eth_getLogs --
        mint_fulfilled_filter = vault.events.MintFulfilled.create_filter(
            from_block=block_before_deposit,
            to_block="latest",
            argument_filters={"depositId": deposit_id},
        )
        events = mint_fulfilled_filter.get_all_entries()
        assert len(events) >= 1, "MintFulfilled event not found via scan"

        # Extract S' from the scanned event
        scanned_s_prime = events[0]["args"]["S_prime"]
        for i in range(8):
            assert scanned_s_prime[i] == s_prime_coords[i], (
                f"Scanned S_prime coord {i} mismatch: {scanned_s_prime[i]} != {s_prime_coords[i]}"
            )

        # -- 6. Unblind the signature --
        from bls12_381_crypto import parse_g2_sol

        S_prime_point = parse_g2_sol(*[int(c) for c in scanned_s_prime])
        S = unblind_signature(S_prime_point, secrets.r)

        # -- 7. Verify BLS pairing locally --
        assert verify_bls_mint_signature(S, blinded.Y, MINT_PK), "Local BLS pairing verification failed"

        # -- 8. Verify on-chain via reveal() --
        spend_pub_coords = list(serialize_g1_sol(secrets.spend_bls_pub))
        s_coords = list(serialize_g2_sol(S))

        tx = vault.functions.reveal(spend_pub_coords, s_coords).build_transaction(
            {
                "from": depositor.address,
                "nonce": w3.eth.get_transaction_count(depositor.address),
                "gas": 500_000,
                "gasPrice": w3.eth.gas_price,
            }
        )
        signed = depositor.sign_transaction(tx)
        reveal_receipt = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.raw_transaction))
        assert reveal_receipt["status"] == 1, f"reveal() failed (gas used: {reveal_receipt['gasUsed']})"

        # Verify nullifier is now REVEALED
        nid = vault.functions.nullifierId(spend_pub_coords).call()
        state = vault.functions.nullifierState(nid).call()
        assert state == 1, f"Expected REVEALED (1), got {state}"
