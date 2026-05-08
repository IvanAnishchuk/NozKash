# NozkVaultV2 (BLS12-381)

<!-- TODO: Auto-generate from Solidity NatSpec comments via forge doc -->

Source: `sol/src/NozkVaultV2.sol`

BLS12-381-based vault using EIP-2537 precompiles (Pectra). Supports BLS signature aggregation.

## Changes from V1

- Uses BLS12-381 curve instead of BN254
- Standard BLS scheme: PK=G1, Sig=G2
- EIP-2537 precompile addresses (0x0b-0x11)
- Signature aggregation support

## Entry Points

Same interface as [NozkVault](nozkvault.md) with updated curve parameters.

## Status

In active development as part of the BLS12-381 migration. See [Changelog](../development/changelog.md).
