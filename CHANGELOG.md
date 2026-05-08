# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- BLS12-381 migration: Python crypto library ported from BN254 to BLS12-381 using chia_rs
- NozkVaultV2 contract with BLS12-381 support and aggregation
- Flipped to standard BLS scheme (PK=G1, Sig=G2)
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

### Fixed

- EIP-2537 precompile addresses updated to final Pectra spec
