#!/usr/bin/env bash
# Deploy GhostVault via Foundry: script/GhostVault.s.sol (GhostVaultScript).
#
# Required (broadcast):
#   PRIVATE_KEY        — hex private key of the deployer (with 0x prefix is fine)
#
# Required (constructor / env read inside Solidity):
#   PK_MINT_X_IMAG     — G2 limb (uint256, decimal or 0x hex)
#   PK_MINT_X_REAL
#   PK_MINT_Y_IMAG
#   PK_MINT_Y_REAL
#   MINT_AUTHORITY     — address allowed to call announce()
#
# Optional:
#   RPC_URL            — defaults to Foundry alias avalanche-fuji (see foundry.toml)
#   FOUNDRY_PROFILE    — etc.
#
# Example (Avalanche Fuji):
#   export PRIVATE_KEY=0x...
#   export PK_MINT_X_IMAG=...  # from your mint keypair / vectors JSON
#   export PK_MINT_X_REAL=...
#   export PK_MINT_Y_IMAG=...
#   export PK_MINT_Y_REAL=...
#   export MINT_AUTHORITY=0x...
#   ./scripts/deploy_ghost_vault.sh
#
# Extra forge flags: ./scripts/deploy_ghost_vault.sh --slow

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

RPC="${RPC_URL:-avalanche-fuji}"

if [[ -z "${PRIVATE_KEY:-}" ]]; then
  echo "error: set PRIVATE_KEY for --broadcast (deployer wallet)" >&2
  exit 1
fi

forge script script/GhostVault.s.sol:GhostVaultScript \
  --sig "run()" \
  --rpc-url "$RPC" \
  --broadcast \
  --private-key "$PRIVATE_KEY" \
  "$@"
