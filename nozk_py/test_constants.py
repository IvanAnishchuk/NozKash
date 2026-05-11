"""
Shared constants for integration and e2e tests.

All private keys here are **well-known deterministic test keys** from Foundry's
default anvil mnemonic. They are NOT real secrets — every developer using anvil
has the same keys. They are published in Foundry's documentation:
https://book.getfoundry.sh/reference/anvil/

Mnemonic: test test test test test test test test test test test junk
"""

from pathlib import Path

from web3 import Web3

from bls12_381_crypto import G1_GEN, Scalar, g1_scalar_mul, serialize_g1_sol

# ==============================================================================
# Paths
# ==============================================================================

REPO_ROOT = Path(__file__).resolve().parent.parent
SOL_DIR = REPO_ROOT / "sol"
ABI_PATH = REPO_ROOT / "abi" / "nozk_vault_v2_abi.json"

# ==============================================================================
# Network
# ==============================================================================

ANVIL_RPC = "http://127.0.0.1:8545"
CHAIN_ID = 31337
DENOMINATION = Web3.to_wei(0.001, "ether")

# ==============================================================================
# Anvil default accounts
# Derived from: test test test test test test test test test test test junk
# ==============================================================================

#: Account 0 — deployer + mint authority
DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"  # noqa: S105

#: Account 1 — depositor / user wallet
DEPOSITOR_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"  # noqa: S105

#: Account 2 — relayer wallet
RELAYER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"  # noqa: S105

#: Account 3 — ETH recipient for redeem tests
RECIPIENT = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"

# ==============================================================================
# Test mint keypair (BLS12-381)
# ==============================================================================

MINT_SK = 42
MINT_SCALAR = Scalar(MINT_SK)
MINT_PK = g1_scalar_mul(G1_GEN, MINT_SCALAR)
MINT_PK_COORDS = list(serialize_g1_sol(MINT_PK))
