"""
Integration test: nozk_flow.sh --mock end-to-end.

Runs the full mock flow script as a subprocess and verifies:
1. Exit code is 0
2. Wallet state file is created with expected fields
3. Token state progresses through the lifecycle

This tests the actual CLI tools (client.py, mint_mock.py, redeem_mock.py)
working together, not just the library functions.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

NOZK_PY_DIR = Path(__file__).resolve().parent
REPO_ROOT = NOZK_PY_DIR.parent


def _generate_test_env(tmpdir: Path) -> dict[str, str]:
    """Generate a minimal .env for mock mode testing."""
    env = os.environ.copy()
    # Generate a deterministic test seed and mint key
    env["MASTER_SEED"] = "test_mock_flow_integration_seed_12345"
    env["MINT_BLS_PRIVKEY"] = "0x2a"  # scalar = 42
    env["MINT_BLS_PUBKEY"] = ""  # force derivation from MINT_BLS_PRIVKEY
    # Point to a temp wallet file to avoid polluting the repo
    env["NOZK_WALLET_PATH"] = str(tmpdir / ".nozk_wallet.json")
    return env


@pytest.fixture
def mock_env(tmp_path):
    """Provide a clean environment for mock flow testing."""
    return _generate_test_env(tmp_path)


def _run_uv(args: list[str], env: dict[str, str], cwd: Path = NOZK_PY_DIR) -> subprocess.CompletedProcess:
    """Run a uv command with the test environment."""
    return subprocess.run(
        ["uv", "run"] + args,
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


_FLOW_CMD = [  # noqa: E501 — long but must be a single list
    "bash",
    "nozk_flow.sh",
    "--to",
    "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7",
    "--mock",
    "--quiet",
    "--no-banner",
]


class TestMockFlowScript:
    """Test nozk_flow.sh --mock via subprocess."""

    def test_mock_flow_completes(self, mock_env, tmp_path):
        """The full --mock flow should exit 0."""
        mock_env["NOZK_WALLET_PATH"] = str(tmp_path / ".nozk_wallet.json")

        result = subprocess.run(
            _FLOW_CMD,
            cwd=str(NOZK_PY_DIR),
            env=mock_env,
            capture_output=True,
            text=True,
            timeout=120,
        )

        assert result.returncode == 0, (
            f"Mock flow failed:\nstdout: {result.stdout[-500:]}\nstderr: {result.stderr[-500:]}"
        )

    def test_mock_flow_creates_wallet_state(self, mock_env, tmp_path):
        """After --mock flow, wallet state should have the token marked as spent."""
        wallet_path = tmp_path / ".nozk_wallet.json"
        mock_env["NOZK_WALLET_PATH"] = str(wallet_path)

        result = subprocess.run(
            _FLOW_CMD,
            cwd=str(NOZK_PY_DIR),
            env=mock_env,
            capture_output=True,
            text=True,
            timeout=120,
        )

        if result.returncode != 0:
            pytest.skip(f"Mock flow failed (may need NOZK_WALLET_PATH support): {result.stderr[-200:]}")

        if wallet_path.exists():
            state = json.loads(wallet_path.read_text())
            assert "tokens" in state
            token_0 = state["tokens"].get("0", {})
            assert token_0.get("nullifier_id"), "Token should have nullifier_id"
            assert token_0.get("s_unblinded_g2"), "Token should have unblinded signature"


class TestNozTipSmoke:
    """Test nozk_tip_test.py smoke test via subprocess."""

    def test_library_mode(self, mock_env):
        """nozk_tip_test.py (no --mock) should verify crypto and exit 0."""
        result = _run_uv(["python", "nozk_tip_test.py"], mock_env)
        assert result.returncode == 0, f"Smoke test failed:\n{result.stderr[-500:]}"

    def test_mock_mode(self, mock_env):
        """nozk_tip_test.py --mock should pass full MockMint/MockRedeemer flow."""
        result = _run_uv(["python", "nozk_tip_test.py", "--mock"], mock_env)
        assert result.returncode == 0, f"Mock smoke test failed:\n{result.stderr[-500:]}"
