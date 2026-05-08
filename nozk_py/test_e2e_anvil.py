"""
E2E test: deploy NozkVaultV2 on local anvil, run full BLS12-381 lifecycle.

Tests Python crypto against the actual Solidity contract on a real EVM,
verifying hash-to-G2 parity, BLS pairing checks, and state transitions.

Requires: anvil (Foundry), forge, web3 Python package.
Skips automatically if anvil is not available.

Usage:
    cd nozk_py && PYENV_VERSION=system uv run pytest test_e2e_anvil.py -v
"""

from __future__ import annotations

import json
import shutil
import subprocess
import time

import pytest
from web3 import Web3

from bls12_381_crypto import (
    CURVE_ORDER,
    Scalar,
    abi_encode_g1,
    serialize_g1_sol,
    serialize_g2_sol,
)
from nozk_library import (
    blind_token,
    derive_token_secrets,
    generate_redemption_proof,
    mint_blind_sign,
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
    RECIPIENT,
    SOL_DIR,
)
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
            w3.eth.block_number  # noqa: B018
            return True
        except Exception:
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
        pytest.fail(f"Forge artifact not found — run `cd sol && forge build`")
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
# Tests
# ==============================================================================


def test_contract_deployed(deployed_contract, w3):
    """Verify contract is deployed and configured correctly."""
    vault = deployed_contract
    assert vault.functions.DENOMINATION().call() == DENOMINATION
    assert vault.functions.mintAuthority().call() == w3.eth.account.from_key(DEPLOYER_KEY).address

    # Verify pkMint matches Python
    pk_coords = serialize_g1_sol(MINT_PK)
    for i in range(4):
        assert vault.functions.pkMint(i).call() == pk_coords[i]


def test_full_lifecycle(deployed_contract, w3):
    """Full protocol: deposit -> announce -> reveal -> redeem."""
    vault = deployed_contract
    deployer = w3.eth.account.from_key(DEPLOYER_KEY)
    depositor = w3.eth.account.from_key(DEPOSITOR_KEY)

    # -- 1. Derive token secrets --
    master_seed = b"e2e_test_seed_anvil"
    secrets = derive_token_secrets(master_seed, 0)

    # -- 2. Blind token --
    blinded = blind_token(secrets.spend_bls_pub, secrets.r)
    b_coords = list(serialize_g2_sol(blinded.B))

    # -- 3. Deposit --
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
    assert vault.functions.depositPending(deposit_id).call() is True

    # -- 4. Announce (mint authority blind-signs) --
    S_prime = mint_blind_sign(blinded.B, MINT_SCALAR)
    s_prime_coords = list(serialize_g2_sol(S_prime))

    tx = vault.functions.announce(deposit_id, s_prime_coords).build_transaction(
        {
            "from": deployer.address,
            "nonce": w3.eth.get_transaction_count(deployer.address),
            "gas": 200_000,
            "gasPrice": w3.eth.gas_price,
        }
    )
    signed = deployer.sign_transaction(tx)
    receipt = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.raw_transaction))
    assert receipt["status"] == 1, "Announce failed"
    assert vault.functions.depositFulfilled(deposit_id).call() is True

    # -- 5. Unblind --
    S = unblind_signature(S_prime, secrets.r)

    # Verify locally first
    assert verify_bls_mint_signature(S, blinded.Y, MINT_PK), "Local BLS verify failed"

    # -- 6. Reveal (on-chain BLS pairing check via EIP-2537) --
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
    receipt = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.raw_transaction))
    assert receipt["status"] == 1, f"Reveal failed (gas used: {receipt['gasUsed']})"

    # Verify nullifier state
    nid = vault.functions.nullifierId(spend_pub_coords).call()
    state = vault.functions.nullifierState(nid).call()
    assert state == 1, f"Expected REVEALED (1), got {state}"

    # -- 7. Redeem (on-chain BLS spend sig check) --
    contract_address = vault.address
    deadline = 2**256 - 1

    proof = generate_redemption_proof(
        secrets.spend_chia_sk,
        secrets.spend_chia_pk,
        RECIPIENT,
        CHAIN_ID,
        contract_address,
        deadline,
    )

    # Serialize spend sig G2 for on-chain
    from py_ecc.bls.g2_primitives import signature_to_G2

    spend_sig_g2 = signature_to_G2(bytes(proof.sigma))
    spend_sig_coords = list(serialize_g2_sol(spend_sig_g2))

    recipient_balance_before = w3.eth.get_balance(RECIPIENT)

    tx = vault.functions.redeem(RECIPIENT, spend_sig_coords, nid, deadline).build_transaction(
        {
            "from": depositor.address,
            "nonce": w3.eth.get_transaction_count(depositor.address),
            "gas": 500_000,
            "gasPrice": w3.eth.gas_price,
        }
    )
    signed = depositor.sign_transaction(tx)
    receipt = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.raw_transaction))
    assert receipt["status"] == 1, f"Redeem failed (gas used: {receipt['gasUsed']})"

    # -- 8. Verify final state --
    state = vault.functions.nullifierState(nid).call()
    assert state == 2, f"Expected SPENT (2), got {state}"

    recipient_balance_after = w3.eth.get_balance(RECIPIENT)
    assert recipient_balance_after - recipient_balance_before == DENOMINATION

    print(f"\n  Deposit gas:  {receipt['gasUsed']:,}")
    print(f"  Reveal gas:   (see above)")
    print(f"  Redeem gas:   {receipt['gasUsed']:,}")
    print(f"  Recipient received: {Web3.from_wei(DENOMINATION, 'ether')} ETH")


def test_double_spend_reverts(deployed_contract, w3):
    """Attempting to reveal the same nullifier twice should revert."""
    vault = deployed_contract
    deployer = w3.eth.account.from_key(DEPLOYER_KEY)
    depositor = w3.eth.account.from_key(DEPOSITOR_KEY)

    # Use a different token index to get a fresh nullifier
    secrets = derive_token_secrets(b"e2e_test_seed_anvil", 1)
    blinded = blind_token(secrets.spend_bls_pub, secrets.r)
    b_coords = list(serialize_g2_sol(blinded.B))

    # Deposit
    tx = vault.functions.deposit(Web3.to_checksum_address(secrets.deposit_id), b_coords).build_transaction(
        {
            "from": depositor.address,
            "value": DENOMINATION,
            "nonce": w3.eth.get_transaction_count(depositor.address),
            "gas": 200_000,
            "gasPrice": w3.eth.gas_price,
        }
    )
    signed = depositor.sign_transaction(tx)
    w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.raw_transaction))

    # Announce
    S_prime = mint_blind_sign(blinded.B, MINT_SCALAR)
    tx = vault.functions.announce(Web3.to_checksum_address(secrets.deposit_id), list(serialize_g2_sol(S_prime))).build_transaction(
        {
            "from": deployer.address,
            "nonce": w3.eth.get_transaction_count(deployer.address),
            "gas": 200_000,
            "gasPrice": w3.eth.gas_price,
        }
    )
    signed = deployer.sign_transaction(tx)
    w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.raw_transaction))

    # Reveal (first time — should succeed)
    S = unblind_signature(S_prime, secrets.r)
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
    receipt = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.raw_transaction))
    assert receipt["status"] == 1

    # Reveal again (should revert with AlreadyRevealed)
    tx = vault.functions.reveal(spend_pub_coords, s_coords).build_transaction(
        {
            "from": depositor.address,
            "nonce": w3.eth.get_transaction_count(depositor.address),
            "gas": 500_000,
            "gasPrice": w3.eth.gas_price,
        }
    )
    signed = depositor.sign_transaction(tx)
    with pytest.raises(Exception, match="revert|AlreadyRevealed"):
        w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.raw_transaction))
