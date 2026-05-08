# CI/CD

<!-- TODO: Auto-generate from .github/workflows/ -->

## Pipeline Overview

The CI pipeline runs on every push and PR:

| Stage | Tool | What it checks |
|-------|------|----------------|
| Python lint | ruff | Style, imports, security rules |
| Python format | ruff format | Code formatting |
| Python types | ty | Type checking |
| Python tests | pytest | Unit tests + vector tests |
| TypeScript lint | biome | Style and formatting |
| TypeScript types | tsc | Type checking |
| TypeScript tests | vitest | Vector tests |
| Solidity build | forge build | Compilation |
| Solidity tests | forge test | Contract tests |
| Solidity format | forge fmt | Code formatting |
| Frontend build | npm run build | Production build |

## Pre-commit Hooks

19 hooks run via `pre-commit`:

```bash
cd nozk_py && uv run pre-commit run --all-files
```

## GitHub Pages

The frontend app deploys to GitHub Pages:

```bash
cd app && npm run deploy
```
