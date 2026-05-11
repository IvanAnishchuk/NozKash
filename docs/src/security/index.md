# Security

## Threat Model & Analysis

See [Security Research](../security-research.md) for the comprehensive threat model, attack vectors, audit references, and security checklist.

## Key Security Properties

- **Unlinkability:** The mint cannot correlate deposits with redemptions (blinding factor `r` is secret)
- **Unforgeability:** BLS signatures are verified on-chain via pairing check
- **Non-custodial:** Funds are held by the smart contract, not the mint
- **Double-spend prevention:** Nullifier uniqueness enforced on-chain
- **MEV protection:** BLS spend signature in `redeem()` binds nullifier to specific recipient via EIP-712

## Trust Assumptions

The mint:

- Cannot link deposits to redemptions
- Cannot forge tokens
- Cannot steal funds
- Can refuse to sign (liveness dependency)
- Can collude with observers on timing metadata

Mitigations: threshold blind signatures, TEE attestation, multiple independent mints.
