# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- TypeScript BLS12-381 migration: `bls12-381-crypto.ts` with AugSchemeMPL sign/verify,
  G1/G2 serialization, aggregation; `nozk-library.ts` with BLS spend signatures replacing ECDSA
- TypeScript test parity with Python: 309 unit/mock/vector + 11 anvil E2E tests (320 total)
- MockMint + MockRedeemer classes (`mint-mock.ts`, `redeem-mock.ts`) for offline testing
- Aggregation vector tests, BLS rejection tests, derivation isolation tests
- Coverage configuration: Python (branch, 59% threshold), TypeScript (v8, 90% threshold)
- React frontend: relayer-only mode for reveal/redeem (no direct on-chain tx needed)
- React frontend: V2 contract support (G2 blinded points, bytes32 nullifier IDs)
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

### Fixed

- Frontend scanner: `normalizeAddress` was called on bytes32 nullifier IDs (64 hex chars),
  causing runtime errors; replaced with `normalizeBytes32` for nullifier-related lookups
- Frontend scanner: NullifierRevealed event topic1 parsed as left-padded address instead of
  bytes32; added `topic1ToBytes32` parser and `nullifierIdToTopic` formatter
- Python client: replaced undeclared `requests` dependency with `httpx` (already in pyproject.toml)
- EIP-2537 precompile addresses updated to final Pectra spec
- Python client `reveal()`: was passing nullifier_id instead of spend pubkey G1 coords
- Python client relayer redeem: field names didn't match relayer's RedeemRequest model
- Constructor validates pkMint via G1MSM precompile (rejects invalid/off-curve points)
- Aggregation vector tests now use real BLS verification instead of smoke checks
- Input validation: `unblind_signature()` and TS `blindToken()`/`deriveTokenSecrets()` guard edge cases
- Zero-padded scalar hex in test vector generator for cross-language consistency

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

### Removed

- BN254/mcl-wasm crypto (replaced by BLS12-381/noble-curves in TypeScript, chia_rs in Python)
- NozkVault V1 contract and V1 ABI
- Legacy BN254 test vectors
- ECDSA redemption proofs (replaced by BLS AugSchemeMPL spend signatures)

### Security

- Upgrade vite 8.0.1 -> 8.0.11 in nozk_ts/ and app/ (fixes CVE: server.fs.deny bypass, WebSocket arbitrary file read, optimized deps path traversal)
- Upgrade postcss 8.5.8 -> 8.5.14 in nozk_ts/ and app/ (fixes XSS via unescaped style in CSS stringify)
- Upgrade Pygments 2.19.2 -> 2.20.0 in nozk_py/ (fixes ReDoS in GUID matching)
- Upgrade brace-expansion 1.1.12 -> 1.1.14 in app/ (fixes ReDoS via zero-step sequences)
