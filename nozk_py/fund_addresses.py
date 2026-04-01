"""Read .env and write fund_addresses.txt with public addresses that need Sepolia ETH."""

from datetime import datetime, timezone
from pathlib import Path

from dotenv import dotenv_values

ENV_FILE = Path(__file__).resolve().parent / ".env"
OUT_FILE = Path(__file__).resolve().parent.parent / "fund_addresses.txt"

ROLES = [
    ("WALLET_ADDRESS", "WALLET", "Deposit wallet — submits deposit() transactions (0.01 ETH per token + gas)"),
    ("MINT_WALLET_ADDRESS", "MINT", "Mint server — submits announce() transactions (gas only)"),
    ("DEPLOYER_ADDRESS", "DEPLOYER", "Deployer — deploys the NozkVault contract (gas only, one-time)"),
]


def main() -> None:
    if not ENV_FILE.exists():
        raise SystemExit(f"error: {ENV_FILE} not found — run generate_keys.py first")

    env = dotenv_values(ENV_FILE)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    lines = [
        "# Nozk Protocol — Addresses to fund with Sepolia ETH",
        f"# Generated from .env on {today}",
        "#",
        "# Use a Sepolia faucet or transfer from another funded account.",
        "# Each address needs enough ETH to cover gas for its role.",
    ]

    found = 0
    for env_key, label, comment in ROLES:
        addr = env.get(env_key)
        if addr:
            lines += ["", f"# {comment}", f"{label:<16}{addr}"]
            found += 1

    if found == 0:
        raise SystemExit("error: no wallet addresses found in .env")

    lines.append("")
    OUT_FILE.write_text("\n".join(lines))
    print(f"Wrote {found} address(es) to {OUT_FILE}")


if __name__ == "__main__":
    main()
