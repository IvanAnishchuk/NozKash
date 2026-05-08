#!/usr/bin/env python3
"""Export NozkVault ABIs from Foundry build artifacts.

Usage:
    cd sol && forge build && python3 sync_abi.py
"""

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent

CONTRACTS = [
    ("NozkVaultV2.sol", "NozkVaultV2", "nozk_vault_v2_abi.json"),
]

for sol_file, contract_name, abi_filename in CONTRACTS:
    artifact = SCRIPT_DIR / "out" / sol_file / f"{contract_name}.json"
    abi_out = REPO_ROOT / "abi" / abi_filename

    if not artifact.exists():
        print(f"skip: {artifact.name} not found (run `forge build` first)", file=sys.stderr)
        continue

    with open(artifact) as f:
        abi = json.load(f)["abi"]

    abi_out.parent.mkdir(parents=True, exist_ok=True)
    abi_out.write_text(json.dumps(abi, indent=2) + "\n")
    print(f"wrote {len(abi)} ABI entries to {abi_out.relative_to(REPO_ROOT)}")
