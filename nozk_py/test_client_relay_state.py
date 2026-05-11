"""
Tests for relay state verification: wallet must verify tx on-chain
before persisting terminal state (reveal_tx, redeem_tx, spent).

Mocks the relayer HTTP response and web3 receipt to verify:
- Happy path: relayer + receipt success -> state persisted
- Reverted tx: relayer 200 but receipt status=0 -> state NOT persisted
- Retry possible: after failed relay, token record unchanged

These tests exercise cmd_reveal and cmd_redeem via relayer with full mocking
of external dependencies (httpx, web3, crypto).
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from click.exceptions import Exit as ClickExit

from client import ClientConfig, TokenRecord, WalletState, cmd_reveal

# ==============================================================================
# Constants
# ==============================================================================

FAKE_TX_HASH = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
FAKE_RELAYER = "http://localhost:9999"


# ==============================================================================
# Helpers
# ==============================================================================


def _state_to_dict(state: WalletState) -> dict:
    """Convert WalletState to JSON-serializable dict."""
    tokens = {}
    for idx, rec in state.tokens.items():
        tokens[str(idx)] = {
            "index": rec.index,
            "nullifier_id": rec.nullifier_id,
            "deposit_id": rec.deposit_id,
            "deposit_tx": rec.deposit_tx,
            "deposit_block": rec.deposit_block,
            "s_unblinded_g2": rec.s_unblinded_g2,
            "spend_pub_g1": rec.spend_pub_g1,
            "b_g2": rec.b_g2,
            "reveal_tx": rec.reveal_tx,
            "redeem_tx": rec.redeem_tx,
            "spent": rec.spent,
        }
    return {"tokens": tokens, "last_scanned_block": state.last_scanned_block}


def _make_config() -> ClientConfig:
    """Create a minimal ClientConfig for testing."""
    return ClientConfig(
        master_seed=b"test_relay_state_seed",
        wallet_address="0x" + "aa" * 20,
        wallet_key="0x" + "bb" * 32,
        contract_address="0x" + "cc" * 20,
        rpc_http_url="http://localhost:8545",
        scan_from_block=0,
        mint_bls_pubkey=None,
    )


@pytest.fixture()
def wallet_file(tmp_path, monkeypatch):
    """Create a temporary wallet state with a READY_TO_REVEAL token."""
    path = tmp_path / ".nozk_wallet.json"

    fake_g2 = [hex(i + 1) for i in range(8)]
    fake_g1 = [hex(i + 1) for i in range(4)]

    state = WalletState(
        tokens={
            0: TokenRecord(
                index=0,
                nullifier_id="0x" + "ab" * 32,
                deposit_id="0x" + "cd" * 20,
                deposit_tx="0x" + "11" * 32,
                deposit_block=100,
                s_unblinded_g2=fake_g2,
                spend_pub_g1=fake_g1,
                b_g2=fake_g2,
            ),
        },
    )
    path.write_text(json.dumps(_state_to_dict(state), indent=2))

    monkeypatch.setattr("client.WALLET_STATE_FILE", path)
    monkeypatch.setattr("wallet_state.WALLET_STATE_FILE", path)

    return path


def _mock_httpx_response(json_data=None, status_code=200):
    resp = MagicMock()
    resp.status_code = status_code
    resp.is_success = status_code == 200
    resp.text = json.dumps(json_data or {})
    resp.json.return_value = json_data or {}
    return resp


def _mock_w3(receipt_status=1, block_number=42, gas_used=100_000):
    w3 = MagicMock()
    w3.is_connected.return_value = True
    w3.eth.wait_for_transaction_receipt.return_value = {
        "status": receipt_status,
        "blockNumber": block_number,
        "gasUsed": gas_used,
    }
    return w3


def _mock_secrets():
    secrets = MagicMock()
    secrets.spend_bls_pub = MagicMock()
    secrets.r = 42
    return secrets


# Common patches for cmd_reveal — suppress all crypto + output
_REVEAL_PATCHES = {
    "client.derive_token_secrets": lambda *a: _mock_secrets(),
    "client.parse_g2_sol": lambda *a: MagicMock(),
    "client.serialize_g1_sol": lambda *a: (1, 2, 3, 4),
}


# ==============================================================================
# Reveal tests
# ==============================================================================


class TestRevealRelayVerification:
    """cmd_reveal via relayer must verify tx on-chain before persisting state."""

    def _run_reveal(self, wallet_file, receipt_status):
        """Run cmd_reveal with mocked relayer + receipt. Returns wallet state dict."""
        config = _make_config()
        relayer_resp = _mock_httpx_response(
            json_data={"tx_hash": FAKE_TX_HASH, "block_number": 42, "gas_used": 100_000}
        )
        w3 = _mock_w3(receipt_status=receipt_status)

        patches = {
            "client.httpx.post": MagicMock(return_value=relayer_resp),
            "client.build_web3": MagicMock(return_value=w3),
            **_REVEAL_PATCHES,
        }

        ctx = {k: patch(k, v) for k, v in patches.items()}
        for c in ctx.values():
            c.start()

        try:
            if receipt_status == 1:
                cmd_reveal(config, 0, relayer_url=FAKE_RELAYER)
            else:
                with pytest.raises(ClickExit):
                    cmd_reveal(config, 0, relayer_url=FAKE_RELAYER)
        finally:
            for c in ctx.values():
                c.stop()

        # Verify the receipt was actually checked
        w3.eth.wait_for_transaction_receipt.assert_called_once_with(FAKE_TX_HASH, timeout=30)

        return json.loads(wallet_file.read_text())

    def test_success_persists_reveal_tx(self, wallet_file):
        """Relayer 200 + receipt success -> reveal_tx persisted."""
        saved = self._run_reveal(wallet_file, receipt_status=1)
        assert saved["tokens"]["0"]["reveal_tx"] == FAKE_TX_HASH

    def test_reverted_does_not_persist(self, wallet_file):
        """Relayer 200 but receipt reverted -> reveal_tx stays None."""
        saved = self._run_reveal(wallet_file, receipt_status=0)
        assert saved["tokens"]["0"]["reveal_tx"] is None

    def test_retry_possible_after_revert(self, wallet_file):
        """After reverted relay, token is still READY_TO_REVEAL."""
        saved = self._run_reveal(wallet_file, receipt_status=0)
        assert saved["tokens"]["0"]["reveal_tx"] is None
        assert saved["tokens"]["0"]["spent"] is False
        # Token still has its signature, can retry
        assert saved["tokens"]["0"]["s_unblinded_g2"] is not None
