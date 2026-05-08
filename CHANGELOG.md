# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- BLS12-381 migration: full-stack port from BN254 to BLS12-381 using EIP-2537 Pectra precompiles
- Standard BLS scheme: PK in G1, Sig in G2 (matches Ethereum consensus + chia_rs/blst)
- `BLS12HashToCurve.sol`: standalone RFC 9380 hash-to-curve library using SHA-256 + MAP_FP2_TO_G2
- NozkVaultV2 contract rewritten for standard scheme with BLS spend signatures (AugSchemeMPL)
- G1 compression for AugSchemeMPL message augmentation in on-chain redeem
- Python `hash_to_g2`: uses py_ecc RFC 9380, verified byte-identical to chia_rs and EIP-2537 precompile
- 265 tests: 240 Python (unit, vector, mock, integration, e2e) + 25 Solidity (RFC 9380, parity, flow)
- E2E tests on local anvil: deploy, deposit, announce, reveal, redeem, refund, multi-token, error paths
- Mint server integration tests: sign_deposit + announce on-chain
- Mock flow CLI tests: nozk_flow.sh --mock subprocess verification
- RFC 9380 official test vectors for expand_message_xmd, hash_to_field, hash_to_curve
- Cross-library parity: chia_rs == py_ecc == Solidity precompile (verified)

### Changed

- Flipped to standard BLS scheme (PK=G1, Sig=G2) — was PK=G2, Sig=G1
- Reveal/redeem split: two-step egress flow (`reveal()` + `redeem()`)
- React frontend wallet with activity dashboard, deposit, redeem, and recovery pages
- FastAPI relayer server for gas-abstracted redemption
- Cross-language test vector system with manifest-driven discovery
- Docker Compose deployment with multi-chain mint profiles
- CI pipeline: Python (ruff, ty, pytest), TypeScript (biome, tsc, vitest), Solidity (forge), app build
- CLI wallets in both Python (typer) and TypeScript
- Stateless mint server (WebSocket, event-driven)
- Full lifecycle automation script (`nozk_flow.sh` with `--mock`, `--dry-run`, `--relayer` modes)
- GitHub Pages deployment for frontend

### Security

- Upgrade vite 8.0.1 -> 8.0.11 in nozk_ts/ and app/ (fixes CVE: server.fs.deny bypass, WebSocket arbitrary file read, optimized deps path traversal)
- Upgrade postcss 8.5.8 -> 8.5.14 in nozk_ts/ and app/ (fixes XSS via unescaped style in CSS stringify)
- Upgrade Pygments 2.19.2 -> 2.20.0 in nozk_py/ (fixes ReDoS in GUID matching)
- Upgrade brace-expansion 1.1.12 -> 1.1.14 in app/ (fixes ReDoS via zero-step sequences)

### Fixed

- EIP-2537 precompile addresses updated to final Pectra spec
