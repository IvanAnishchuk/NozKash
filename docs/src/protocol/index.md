# Protocol

NozKash implements a blind-signature eCash protocol using BLS signatures over elliptic curves, verified entirely on-chain via EVM precompiles.

## Sections

- [Architecture](architecture.md) -- protocol flow and component interaction
- [Cryptographic Primitives](../cryptographic-primitives.md) -- BLS signatures, blind signatures, curves
- [Hash-to-Curve](../hash-to-curve.md) -- RFC 9380 and the try-and-increment method
- [EVM Precompiles](../evm-precompiles.md) -- EIP-196, EIP-197 (BN254), EIP-2537 (BLS12-381)
- [Signature Encoding](../signature-encoding-eips.md) -- EIP-191, EIP-712
- [BLS Key Management](../bls-key-management-eips.md) -- EIP-2333, EIP-2334, EIP-2335
