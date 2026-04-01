"""Unit tests for contract_errors.py — selector extraction and error decoding."""

import json
from pathlib import Path

from eth_utils import keccak

from contract_errors import (
    _SELECTOR_TO_NAME,
    _extract_selector,
    decode_contract_error,
)

# ==============================================================================
# _extract_selector
# ==============================================================================


def test_extract_selector_raw_hex_with_0x():
    assert _extract_selector("0x28739233") == "28739233"


def test_extract_selector_raw_hex_without_0x():
    assert _extract_selector("28739233") == "28739233"


def test_extract_selector_long_hex_takes_first_8():
    assert _extract_selector("0x28739233aabbccdd") == "28739233"


def test_extract_selector_short_hex_returns_none():
    assert _extract_selector("0x1234") is None


def test_extract_selector_non_hex_returns_none():
    assert _extract_selector("not hex at all") is None


def test_extract_selector_empty_string_returns_none():
    assert _extract_selector("") is None


def test_extract_selector_exception_with_data_attr():
    class FakeExc:
        data = "0x28739233"

    assert _extract_selector(FakeExc()) == "28739233"


def test_extract_selector_exception_with_hex_in_args():
    exc = Exception("0x28739233")
    assert _extract_selector(exc) == "28739233"


def test_extract_selector_str_fallback():
    class Obj:
        def __str__(self):
            return "revert 0xdeadbeef more text"

    assert _extract_selector(Obj()) == "deadbeef"


# ==============================================================================
# decode_contract_error
# ==============================================================================


def test_decode_known_selector_with_hint():
    selector = keccak(b"InvalidBLS()")[:4].hex()
    result = decode_contract_error(f"0x{selector}")
    assert "InvalidBLS" in result
    assert "BLS pairing check failed" in result


def test_decode_known_selector_without_hint():
    # ExpiredSignature is in the ABI but not in _HINTS
    selector = keccak(b"ExpiredSignature()")[:4].hex()
    result = decode_contract_error(f"0x{selector}")
    assert result == "ExpiredSignature"
    assert "\u2014" not in result  # no em-dash hint separator


def test_decode_unknown_selector():
    result = decode_contract_error("0xdeadbeef")
    assert "Unknown contract error" in result
    assert "deadbeef" in result


def test_decode_non_hex_string():
    result = decode_contract_error("some random error")
    assert result == "Contract reverted: some random error"


def test_decode_exception_object():
    # InvalidECDSA selector
    selector = keccak(b"InvalidECDSA()")[:4].hex()
    exc = Exception(f"0x{selector}")
    result = decode_contract_error(exc)
    assert "InvalidECDSA" in result


def test_selector_table_covers_all_abi_errors():
    abi_path = Path(__file__).resolve().parent / ".." / "abi" / "nozk_vault_abi.json"
    abi = json.loads(abi_path.read_text())
    abi_errors = [e for e in abi if e.get("type") == "error"]
    assert len(_SELECTOR_TO_NAME) == len(abi_errors), (
        f"Selector table has {len(_SELECTOR_TO_NAME)} entries but ABI has {len(abi_errors)} errors"
    )
