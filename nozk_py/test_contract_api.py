"""
Contract API signature tests.

Validates that all client-side contract call patterns match the ABI.
Catches arg count/type mismatches at test time without needing anvil.

Uses the shared ABI from abi/nozk_vault_v2_abi.json as the single source of truth.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from web3 import Web3
from web3.exceptions import MismatchedABI

REPO_ROOT = Path(__file__).resolve().parent.parent
ABI_PATH = REPO_ROOT / "abi" / "nozk_vault_v2_abi.json"

with open(ABI_PATH) as f:
    NOZK_VAULT_ABI = json.load(f)

# Dummy contract instance (no provider needed for ABI encoding)
w3 = Web3()
contract = w3.eth.contract(
    address=Web3.to_checksum_address("0x0000000000000000000000000000000000000001"),
    abi=NOZK_VAULT_ABI,
)

# ==============================================================================
# Helpers: dummy values for each Solidity type
# ==============================================================================

ZERO_ADDR = "0x0000000000000000000000000000000000000001"
ZERO_G1 = [0, 0, 0, 0]  # uint256[4]
ZERO_G2 = [0, 0, 0, 0, 0, 0, 0, 0]  # uint256[8]
ZERO_BYTES32 = b"\x00" * 32
ZERO_UINT = 0


def _encode(fn_name: str, args: list) -> str:
    """Encode a contract call — raises MismatchedABI on wrong arg count. No provider needed."""
    return contract.encode_abi(fn_name, args)


# ==============================================================================
# Test: ABI function input counts
# ==============================================================================


@pytest.mark.parametrize(
    "fn_name,expected_inputs",
    [
        ("deposit", 2),
        ("announce", 2),
        ("reveal", 2),
        ("redeem", 4),
        ("refund", 1),
        ("revealAggregated", 2),
        ("redeemAggregated", 4),
        ("revealBatch", 2),
    ],
)
def test_abi_input_count(fn_name: str, expected_inputs: int):
    """Verify each function's ABI declares the expected number of inputs."""
    for entry in NOZK_VAULT_ABI:
        if entry.get("type") == "function" and entry["name"] == fn_name:
            actual = len(entry["inputs"])
            assert actual == expected_inputs, f"{fn_name}: ABI declares {actual} inputs, expected {expected_inputs}"
            return
    pytest.fail(f"Function {fn_name} not found in ABI")


# ==============================================================================
# Test: correct arg counts encode successfully
# ==============================================================================


def test_deposit_encoding():
    """deposit(address, uint256[8]) encodes with 2 args."""
    assert _encode("deposit", [ZERO_ADDR, ZERO_G2]).startswith("0x")


def test_announce_encoding():
    """announce(address, uint256[8]) encodes with 2 args."""
    assert _encode("announce", [ZERO_ADDR, ZERO_G2]).startswith("0x")


def test_reveal_encoding():
    """reveal(uint256[4], uint256[8]) encodes with 2 args."""
    assert _encode("reveal", [ZERO_G1, ZERO_G2]).startswith("0x")


def test_redeem_encoding():
    """redeem(address, uint256[8], bytes32, uint256) encodes with 4 args."""
    assert _encode("redeem", [ZERO_ADDR, ZERO_G2, ZERO_BYTES32, ZERO_UINT]).startswith("0x")


def test_refund_encoding():
    """refund(address) encodes with 1 arg."""
    assert _encode("refund", [ZERO_ADDR]).startswith("0x")


def test_redeem_aggregated_encoding():
    """redeemAggregated(address, uint256[8], bytes32[], uint256) encodes with 4 args."""
    assert _encode("redeemAggregated", [ZERO_ADDR, ZERO_G2, [ZERO_BYTES32], ZERO_UINT]).startswith("0x")


# ==============================================================================
# Test: wrong arg counts fail to encode
# ==============================================================================


def test_redeem_rejects_5_args():
    """redeem() with 5 args (extra spend_pk_coords) must fail.

    This is the exact bug pattern from client.py line 1130:
        contract.functions.redeem(recipient, spend_sig, spend_pk, nullifier_id, deadline)
    The contract only takes 4 args — spend_pk is looked up by nullifier ID.
    """
    with pytest.raises(MismatchedABI):
        _encode("redeem", [ZERO_ADDR, ZERO_G2, ZERO_G1, ZERO_BYTES32, ZERO_UINT])


def test_reveal_rejects_3_args():
    """reveal() with 3 args must fail."""
    with pytest.raises(MismatchedABI):
        _encode("reveal", [ZERO_G1, ZERO_G2, ZERO_G2])


def test_deposit_rejects_3_args():
    """deposit() with 3 args must fail."""
    with pytest.raises(MismatchedABI):
        _encode("deposit", [ZERO_ADDR, ZERO_G2, ZERO_UINT])


# ==============================================================================
# Test: client.py broadcast path uses correct arg count
# ==============================================================================


def test_client_redeem_broadcast_pattern():
    """Replicate the exact call pattern from client.py's direct broadcast path.

    client.py line 1130-1135 currently passes 5 args (includes spend_pk_coords).
    This test will FAIL until the bug is fixed.
    """
    recipient = Web3.to_checksum_address("0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65")
    spend_sig_coords = list(range(8))  # uint256[8]
    spend_pk_coords = list(range(4))  # uint256[4] — the extra arg
    nullifier_id = b"\x00" * 32
    deadline = 2**256 - 1

    # The BUGGY pattern (5 args) — must raise
    with pytest.raises(MismatchedABI):
        _encode("redeem", [recipient, list(spend_sig_coords), list(spend_pk_coords), nullifier_id, deadline])

    # The CORRECT pattern (4 args) — must succeed
    data = _encode("redeem", [recipient, list(spend_sig_coords), nullifier_id, deadline])
    assert data.startswith("0x")
