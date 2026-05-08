# Smart Contracts (`sol`)

The NozkVault smart contract implements on-chain verification and fund custody for the NozKash protocol.

## Contracts

| Contract | Description |
|----------|-------------|
| `NozkVault.sol` | BN254-based vault (v1) |
| `NozkVaultV2.sol` | BLS12-381 vault with aggregation support |

## Tooling

- **Framework:** [Foundry](https://book.getfoundry.sh/) (`forge build`, `forge test`, `forge fmt`)
- **Solidity:** `^0.8.19`
- **Conventions:** custom errors, `calldata` for read-only arrays, `external` visibility

## Quick Commands

```bash
cd sol

# Build + test
forge build && forge test

# Verbose test output
forge test -vvv

# Format
forge fmt

# Gas snapshots
forge snapshot
```

## Gas Targets

| Operation | Target |
|-----------|--------|
| `deposit` | ~50k gas |
| `announce` | ~55k gas |
| `redeem` | ~120k gas |
| `refund` | ~30k gas |

## Sections

- [NozkVault](nozkvault.md) -- v1 contract reference (BN254)
- [NozkVaultV2](nozkvault-v2.md) -- v2 contract reference (BLS12-381)
- [Deployment](deployment.md) -- deployment scripts and verification
