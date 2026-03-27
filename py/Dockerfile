# GhostVault mint daemon (mint_server.py)
#
# Build from the repository root (needs py/ and sol/ghost_vault_abi.json):
#   docker build -f py/Dockerfile -t nozkash-mint-server .
#
# On a GCE VM you can clone the repo, cd into it, and run the same build command.
#
# Run (env vars documented in mint_server.py header):
#   docker run --rm --env-file .env nozkash-mint-server

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

COPY py/pyproject.toml py/uv.lock ./py/
RUN cd py && uv sync --frozen

COPY py/mint_server.py py/ghost_library.py py/contract_errors.py ./py/
COPY sol/ghost_vault_abi.json ./sol/ghost_vault_abi.json

WORKDIR /app/py

ENV PYTHONUNBUFFERED=1

CMD ["uv", "run", "python", "mint_server.py", "run"]
