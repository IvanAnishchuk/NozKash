#!/usr/bin/env bash
# Regenerate vectors into repo-root test_vectors/, then run Foundry tests.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/py"
uv run generate_vectors.py "$@"
cd "$ROOT/sol"
forge test
