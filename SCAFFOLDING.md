# Scaffolding & Structure Improvement Plan

Status: living document tracking infrastructure improvements for NozKash.

## Completed (this PR)

- [x] **CLAUDE.md consolidation** — Single authoritative AI instruction file; AGENTS.md, GEMINI.md, copilot-instructions.md reduced to thin pointers; CONVENTIONS.md deleted
- [x] **Pre-commit hooks** — Multi-language: ruff + ty (Python), biome + tsc (TypeScript), forge fmt (Solidity), gitleaks, conventional commits
- [x] **`.claude/settings.json`** — Permission allowlists for common dev commands
- [x] **`.editorconfig`** — Cross-language formatting consistency
- [x] **`.nvmrc`** — Node 20 pinning (matches CI)
- [x] **`CHANGELOG.md`** — Keep a Changelog format, retroactive feature summary
- [x] **`.gitignore` hardening** — Foundry artifacts, caches, coverage
- [x] **CI: `forge fmt --check`** — Solidity formatting enforced in CI
- [x] **CI: gitleaks** — Secret scanning in CI
- [x] **CI: branch cleanup** — Removed stale `init_gen_tool` trigger

## Near-term

### Split CI workflows (like oauth project)
Currently all 10 CI jobs live in a single `ci.yml`. Split into per-component workflows:
- `python.yml` — ruff, ty, pytest
- `typescript.yml` — biome, tsc, vitest
- `solidity.yml` — forge build, forge test, forge fmt
- `app.yml` — npm build
- `security.yml` — gitleaks

Benefits: independent re-runs, clearer failure signals, per-component path filters.

### Meson/Ninja build orchestration (like oauth project)
Add Meson build system for test orchestration across all components:
- Per-component test targets with caching
- Aggregate targets (`ninja -C builddir check-all`)
- Report generation (JUnit XML, coverage, etc.)
- Configurable fuzzing duration

### Coverage reporting
- Python: pytest-cov with fail-under threshold
- TypeScript: vitest coverage (v8 or istanbul)
- Solidity: forge coverage
- Combine and report in CI (diff-cover for PRs)

### pip-audit / dependency scanning
- Add `pip-audit` to Python dev deps
- `npm audit` for TypeScript/frontend
- CI job for dependency vulnerability scanning

## Medium-term

### Monorepo workspace linking
Currently `app/` imports `nozk_ts/` via Vite alias + directory path. Consider:
- npm workspaces at root level
- Proper TypeScript project references (`tsconfig.json` extends)
- Single `npm install` at root

### Property-based testing
- Python: Hypothesis for crypto operation properties (e.g., blind/unblind roundtrip)
- TypeScript: fast-check equivalent
- Solidity: Foundry invariant tests

### Documentation site
- Consolidate README.md + protocol docs into a documentation site
- MkDocs or Docusaurus
- Auto-generated contract docs from NatSpec

### Gas benchmarking CI
- Track gas costs per commit via `forge snapshot`
- CI job that compares snapshots and flags regressions
- Historical gas cost dashboard

## Long-term

### Supply-chain security (for contract deployments)
- Deterministic builds for contract verification
- Deployment attestations
- ABI hash verification in CI

### Mutation testing
- Python: mutmut for crypto library
- Identify weak test coverage in critical paths

### Custom Claude agent: crypto-parity
Specialized agent for maintaining cross-language parity:
- Auto-port Python crypto changes to TypeScript
- Auto-regenerate test vectors
- Auto-run both test suites
- Memory system for tracking parity state

### Dev containers
- `devcontainer.json` for VS Code / Codespaces
- All toolchains pre-installed (Python, Node, Foundry)
- Pre-configured env templates
