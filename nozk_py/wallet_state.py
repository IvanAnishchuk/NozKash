"""Shared wallet state and formatting helpers for NozKash CLI tools."""

import json
from pathlib import Path
from typing import Any

WALLET_STATE_FILE = Path(__file__).resolve().parent.parent / ".nozk_wallet.json"


def short_hex(val: str, head: int = 10, tail: int = 8) -> str:
    """Truncate a hex string for display: '0x1234…abcd'."""
    if len(val) <= head + tail + 3:
        return val
    return f"{val[:head]}…{val[-tail:]}"


def load_wallet_state() -> dict[str, Any]:
    """Load wallet state from disk, or return empty defaults."""
    if not WALLET_STATE_FILE.exists():
        return {"tokens": {}, "last_scanned_block": 0}
    return json.loads(WALLET_STATE_FILE.read_text())


def save_wallet_state(state: dict[str, Any]) -> None:
    """Persist wallet state to disk."""
    WALLET_STATE_FILE.write_text(json.dumps(state, indent=2))
