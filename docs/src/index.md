# NozKash

**Privacy-preserving eCash for EVM chains -- without zero-knowledge proofs.**

NozKash uses BLS blind signatures to deliver unlinkable token transfers at a fraction of the gas cost of zk-SNARK privacy protocols. Users deposit a fixed denomination, receive a cryptographically blind-signed token from a mint, and redeem it to any address -- the mint never learns which deposit corresponds to which redemption.

No circuits. No trusted setup. No off-chain relayer infrastructure. Just elliptic curve math that the EVM already understands.

## Components

| Component | Language | Description |
|-----------|----------|-------------|
| [`nozk_py`](python/index.md) | Python | Crypto library (source of truth), mint server, CLI wallet |
| [`nozk_ts`](typescript/index.md) | TypeScript | Byte-for-byte crypto port, CLI wallet |
| [`sol`](solidity/index.md) | Solidity | NozkVault smart contract (Foundry) |
| [`app`](frontend/index.md) | React | Frontend wallet (Vite + React 19 + Tailwind) |

## Quick Links

- [Getting Started](getting-started/index.md) -- installation and first steps
- [Protocol Overview](protocol/index.md) -- how the blind signature scheme works
- [Security](security/index.md) -- threat model and security analysis
- [Research](research/index.md) -- papers, standards, and ecosystem references
- [Development](development/index.md) -- contributing, CI/CD, changelog
