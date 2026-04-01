# NozkVault mint daemon (mint_server.py)
#
# Build from the repository root (needs nozk_py/ and abi/nozk_vault_abi.json):
#   docker build -f nozk_py/Dockerfile -t nozkash-mint-server .
#
# On a GCE VM you can clone the repo, cd into it, and run the same build command.
#
# Run (env vars documented in mint_server.py header).
# Note: Typer exposes a single command at the root — do not pass a literal "run" argv.
#   docker run --rm --env-file .env nozkash-mint-server

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

COPY nozk_py/pyproject.toml nozk_py/uv.lock ./nozk_py/
RUN cd nozk_py && uv sync --frozen

COPY nozk_py/mint_server.py nozk_py/nozk_library.py nozk_py/contract_errors.py ./nozk_py/
COPY abi/nozk_vault_abi.json ./abi/nozk_vault_abi.json

WORKDIR /app/nozk_py

ENV PYTHONUNBUFFERED=1

CMD ["uv", "run", "mint_server.py"]
