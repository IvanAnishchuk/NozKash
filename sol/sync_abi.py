#!/usr/bin/env python3
"""Rebuild NozkVault and export the full ABI to abi/nozk_vault_abi.json.

Usage:
    cd sol && forge build && python3 sync_abi.py
"""

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
ARTIFACT = SCRIPT_DIR / "out" / "NozkVault.sol" / "NozkVault.json"
ABI_OUT = REPO_ROOT / "abi" / "nozk_vault_abi.json"

if not ARTIFACT.exists():
    print(f"error: forge artifact not found at {ARTIFACT}", file=sys.stderr)
    print("hint:  run `forge build` first", file=sys.stderr)
    sys.exit(1)

with open(ARTIFACT) as f:
    abi = json.load(f)["abi"]

output = json.dumps(abi, indent=2) + "\n"

ABI_OUT.parent.mkdir(parents=True, exist_ok=True)
ABI_OUT.write_text(output)
print(f"wrote {len(abi)} ABI entries to {ABI_OUT.relative_to(REPO_ROOT)}")
