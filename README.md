## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

`GhostVault.t.sol` **forks Sepolia** in `setUp` (precompile `0x08` matches testnet). Outbound RPC access is required.

| Env | Purpose |
|-----|---------|
| `SEPOLIA_RPC_URL` | Optional. If unset, tests use `https://ethereum-sepolia-rpc.publicnode.com` (set your own URL for stable CI). |
| `SEPOLIA_FORK_BLOCK` | Optional. Pin a block number for reproducible runs; omit or `0` for latest at fork time. |

CLI fork alias (when `SEPOLIA_RPC_URL` is set in the environment):

```shell
SEPOLIA_RPC_URL="https://..." forge test --fork-url sepolia
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/GhostVault.s.sol:GhostVaultScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```
