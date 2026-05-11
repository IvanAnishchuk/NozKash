"""
Integration tests for relayer FastAPI endpoints against local anvil.

Tests the full HTTP API: /reveal, /redeem, /status, /health.
Deploys NozkVaultV2, prepares tokens, and exercises the relayer endpoints
via FastAPI TestClient.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import time

import pytest
from web3 import Web3

from bls12_381_crypto import (
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
    RELAYER_KEY,
    SOL_DIR,
)


def _wait_for_rpc(url: str, timeout: float = 10.0) -> bool:
    w3 = Web3(Web3.HTTPProvider(url))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            w3.eth.block_number  # noqa: B018
            return True
        except Exception:
            time.sleep(0.1)
    return False


def _send_tx(w3, account, tx):
    signed = account.sign_transaction(tx)
    return w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.raw_transaction))


@pytest.fixture(scope="module")
def anvil_process():
    if not shutil.which("anvil"):
        pytest.skip("anvil not found")
    proc = subprocess.Popen(
        ["anvil", "--chain-id", str(CHAIN_ID), "--silent"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if not _wait_for_rpc(ANVIL_RPC):
        proc.kill()
        pytest.fail("anvil did not start")
    yield proc
    proc.terminate()
    proc.wait(timeout=5)


@pytest.fixture(scope="module")
def w3(anvil_process):
    return Web3(Web3.HTTPProvider(ANVIL_RPC))


@pytest.fixture(scope="module")
def deployed_contract(w3):
    abi = json.loads(ABI_PATH.read_text())
    artifact_path = SOL_DIR / "out" / "NozkVaultV2.sol" / "NozkVaultV2.json"
    if not artifact_path.exists():
        pytest.fail("Forge artifact not found — run `cd sol && forge build`")
    bytecode = json.loads(artifact_path.read_text())["bytecode"]["object"]
    deployer = w3.eth.account.from_key(DEPLOYER_KEY)
    pk_coords = list(serialize_g1_sol(MINT_PK))
    contract = w3.eth.contract(abi=abi, bytecode=bytecode)
    tx = contract.constructor(pk_coords, deployer.address).build_transaction(
        {
            "from": deployer.address,
            "nonce": w3.eth.get_transaction_count(deployer.address),
            "gas": 5_000_000,
            "gasPrice": w3.eth.gas_price,
        }
    )
    signed = deployer.sign_transaction(tx)
    receipt = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.raw_transaction))
    assert receipt["status"] == 1
    return w3.eth.contract(address=receipt["contractAddress"], abi=abi)


@pytest.fixture(scope="module")
def relayer_client(deployed_contract, w3):
    """Create a FastAPI TestClient backed by a real Relayer connected to anvil."""
    import relayer_server
    from relayer_server import Relayer, RelayerConfig, fastapi_app

    config = RelayerConfig(
        contract_address=deployed_contract.address,
        rpc_http_url=ANVIL_RPC,
        wallet_address=w3.eth.account.from_key(RELAYER_KEY).address,
        wallet_key=RELAYER_KEY.replace("0x", ""),
        chain_id=CHAIN_ID,
        mint_bls_pubkey=MINT_PK,
    )
    relayer_server._relayer = Relayer(config)

    from fastapi.testclient import TestClient

    yield TestClient(fastapi_app)
    relayer_server._relayer = None


# ==============================================================================
# Health and status endpoints
# ==============================================================================


def test_health_endpoint(relayer_client):
    resp = relayer_client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["chain_id"] == CHAIN_ID


def test_status_unknown_nullifier(relayer_client):
    resp = relayer_client.get("/status/0x" + "00" * 32)
    assert resp.status_code == 200
    data = resp.json()
    assert data["state"] == "UNREVEALED"


# ==============================================================================
# Reveal endpoint
# ==============================================================================


def _prepare_token(w3, vault, depositor, deployer, seed, index):
    """Deposit + announce a token, return (secrets, S)."""
    secrets = derive_token_secrets(seed, index)
    blinded = blind_token(secrets.spend_bls_pub, secrets.r)
    deposit_id = Web3.to_checksum_address(secrets.deposit_id)

    tx = vault.functions.deposit(deposit_id, list(serialize_g2_sol(blinded.B))).build_transaction(
        {
            "from": depositor.address,
            "value": DENOMINATION,
            "nonce": w3.eth.get_transaction_count(depositor.address),
            "gas": 200_000,
            "gasPrice": w3.eth.gas_price,
        }
    )
    _send_tx(w3, depositor, tx)

    S_prime = mint_blind_sign(blinded.B, MINT_SCALAR)
    tx = vault.functions.announce(deposit_id, list(serialize_g2_sol(S_prime))).build_transaction(
        {
            "from": deployer.address,
            "nonce": w3.eth.get_transaction_count(deployer.address),
            "gas": 200_000,
            "gasPrice": w3.eth.gas_price,
        }
    )
    _send_tx(w3, deployer, tx)

    S = unblind_signature(S_prime, secrets.r)
    return secrets, S


def test_reveal_valid(relayer_client, deployed_contract, w3):
    deployer = w3.eth.account.from_key(DEPLOYER_KEY)
    depositor = w3.eth.account.from_key(DEPOSITOR_KEY)

    secrets, S = _prepare_token(w3, deployed_contract, depositor, deployer, b"relayer_reveal_test", 300)

    resp = relayer_client.post(
        "/reveal",
        json={
            "spend_pub_g1": [hex(c) for c in serialize_g1_sol(secrets.spend_bls_pub)],
            "s_g2": [hex(c) for c in serialize_g2_sol(S)],
        },
    )
    assert resp.status_code == 200, f"Reveal failed: {resp.json()}"
    data = resp.json()
    assert data["tx_hash"]

    # Verify on-chain
    from eth_utils import keccak

    nid = keccak(abi_encode_g1(secrets.spend_bls_pub))
    state = deployed_contract.functions.nullifierState(nid).call()
    assert state == 1, f"Expected REVEALED (1), got {state}"


def test_reveal_invalid_signature_400(relayer_client, deployed_contract, w3):
    deployer = w3.eth.account.from_key(DEPLOYER_KEY)
    depositor = w3.eth.account.from_key(DEPOSITOR_KEY)

    # Deposit+announce a real token
    secrets, _S = _prepare_token(w3, deployed_contract, depositor, deployer, b"relayer_bad_sig", 301)

    # Submit with garbage G2 signature
    resp = relayer_client.post(
        "/reveal",
        json={
            "spend_pub_g1": [hex(c) for c in serialize_g1_sol(secrets.spend_bls_pub)],
            "s_g2": ["0x1", "0x2", "0x3", "0x4", "0x5", "0x6", "0x7", "0x8"],
        },
    )
    # Should fail — either 400 (pairing check) or 500 (on-chain revert)
    assert resp.status_code in (400, 500), f"Expected error, got {resp.status_code}: {resp.json()}"


# ==============================================================================
# Redeem endpoint
# ==============================================================================


def test_redeem_expired_deadline_400(relayer_client):
    resp = relayer_client.post(
        "/redeem",
        json={
            "recipient": RECIPIENT,
            "spend_sigma_compressed": "aa" * 96,
            "spend_pk_compressed": "bb" * 48,
            "nullifier_id": "cc" * 32,
            "deadline": int(time.time()) - 3600,
        },
    )
    assert resp.status_code == 400
    assert "Deadline" in resp.json()["detail"] or "deadline" in resp.json()["detail"].lower()


def test_redeem_valid(relayer_client, deployed_contract, w3):
    deployer = w3.eth.account.from_key(DEPLOYER_KEY)
    depositor = w3.eth.account.from_key(DEPOSITOR_KEY)

    secrets, S = _prepare_token(w3, deployed_contract, depositor, deployer, b"relayer_redeem_test", 302)

    # Reveal first (via relayer)
    resp = relayer_client.post(
        "/reveal",
        json={
            "spend_pub_g1": [hex(c) for c in serialize_g1_sol(secrets.spend_bls_pub)],
            "s_g2": [hex(c) for c in serialize_g2_sol(S)],
        },
    )
    assert resp.status_code == 200, f"Reveal failed: {resp.json()}"

    # Generate spend signature
    deadline = 2**256 - 1
    proof = generate_redemption_proof(
        secrets.spend_chia_sk,
        secrets.spend_chia_pk,
        RECIPIENT,
        CHAIN_ID,
        deployed_contract.address,
        deadline,
    )

    from eth_utils import keccak

    nid = keccak(abi_encode_g1(secrets.spend_bls_pub))
    bal_before = w3.eth.get_balance(RECIPIENT)

    resp = relayer_client.post(
        "/redeem",
        json={
            "recipient": RECIPIENT,
            "spend_sigma_compressed": proof.sigma.to_bytes().hex(),
            "spend_pk_compressed": proof.spend_pk.to_bytes().hex(),
            "nullifier_id": nid.hex(),
            "deadline": deadline,
        },
    )
    assert resp.status_code == 200, f"Redeem failed: {resp.json()}"

    # Verify on-chain
    state = deployed_contract.functions.nullifierState(nid).call()
    assert state == 2, f"Expected SPENT (2), got {state}"

    bal_after = w3.eth.get_balance(RECIPIENT)
    assert bal_after - bal_before == DENOMINATION
