---
title: "TEE Wallet Architectures — Key Management in Trusted Execution Environments"
type: research
status: draft
date: 2026-06-02
relevance: core — TEE is the security foundation for our wallet service
sources:
  - https://eco.com/support/en/articles/14845485-coinbase-agentic-wallets-explained
  - https://www.openfort.io/blog/non-custodial-wallet-infrastructure-open-beats-closed
  - https://www.openfort.io/blog/key-management-solutions
  - https://www.privy.io/
  - https://www.crossmint.com/learn/agent-wallets-compared
  - https://github.com/tkhq/qos (Turnkey Quorum OS)
  - https://github.com/fireblocks/mpc-lib (Fireblocks MPC-CMP)
  - https://github.com/automata-network/automata-dcap-attestation (on-chain SGX attestation)
  - https://github.com/LitProtocol (distributed TEE network)
  - https://github.com/narval-xyz/narval (open-source policy engine)
  - https://github.com/Dstack-TEE/dstack (TDX Docker framework)
---

# TEE Wallet Architectures

## TEE Technologies

### AWS Nitro Enclaves (Coinbase, primary)

- Isolated VM with no persistent storage
- No operator login — not even AWS or Coinbase can access memory
- Attestation document (PCR values) proves enclave code identity
- Used by Coinbase for Agentic Wallets
- **Best for**: Cloud-native services, highest production maturity

### Intel SGX / TDX

- Hardware-level memory encryption
- Enclave code attestation via Intel Attestation Service
- TDX extends to full VM isolation (not just enclaves)
- Used by some wallet providers (Turnkey historically)
- **Best for**: On-premises deployments, bare metal

### AMD SEV-SNP (Google Cloud Confidential Space)

- Full VM memory encryption with attestation
- Google Cloud Confidential VMs use SEV-SNP under the hood
- **Google Confidential Space**: purpose-built TEE product with
  OIDC-based attestation (Google Cloud Attestation service),
  Docker workload identity, and KMS key policy integration
- Attestation via OpenID Connect tokens — simpler than SGX DCAP
- **Best for**: Multi-cloud deployments, Google Cloud users

### ARM TrustZone

- Mobile/embedded TEE
- Used in hardware wallets and mobile secure elements
- **Best for**: Mobile wallet implementations

## Architecture Patterns

### Pattern 1: MPC + TEE (Coinbase Model)

```
  Operator's CDP Project          AWS Nitro Enclave
        |                               |
   key share A                     key share B
        |                               |
        |--- signing request ---------->|
        |                               | policy check
        |                               | threshold ECDSA
        |<-- MPC signature -------------|
```

- **cb-mpc**: EC-DKG + threshold ECDSA (secp256k1) + Schnorr (Ed25519)
- Key shares split between operator and enclave
- Neither party alone can sign
- Open-source MPC library, closed-source enclave infra

### Pattern 2: TEE-Only (Privy Model)

```
  User Auth (OAuth/email)          TEE
        |                           |
   auth token -------verif--------> |
        |                           | key generation
        |                           | key sealing
        |<-- signed tx -------------|
```

- Keys generated and sealed entirely within TEE
- Auth via social login, email, SMS
- Key sharding for recovery
- Multi-approver quorums for high-value operations

### Pattern 3: Self-Hosted TEE (OpenSigner Model)

```
  Your Infrastructure              Your TEE (Nitro/SGX)
        |                               |
   API gateway                     OpenSigner module
        |                               |
        |--- sign request ------------>|
        |                               | key gen/storage
        |                               | policy enforcement
        |<-- signature ----------------|
```

- **OpenSigner** (Openfort): Open-source, self-hostable
- Full audit of key management code
- Operator controls the enclave deployment
- Can integrate with external signers (Turnkey, Fireblocks)
- **Most relevant model for NozKash**

### Pattern 4: Distributed TEE Network (Lit Protocol Model)

```
  User/Agent               Lit Network (N TEE nodes)
      |                    ┌──────┐ ┌──────┐ ┌──────┐
      |--- sign request -->│Node 1│ │Node 2│ │Node 3│  (each in SEV-SNP)
      |                    │share │ │share │ │share │
      |                    └──┬───┘ └──┬───┘ └──┬───┘
      |                       │ threshold signing │
      |<-- aggregated sig ----┴────────┴─────────┘
```

- Distributed key generation (DKG) across TEE nodes
- Threshold BLS and threshold ECDSA signing
- "Lit Actions" — JS programs running in TEE that control signing conditions
- No single node holds the full key (defense against TEE side-channels)
- Permissionless staking-based network

### Notable Open-Source Projects

| Project | What | URL |
|---------|------|-----|
| **Turnkey Quorum OS** | Full enclave OS for wallet infra | `github.com/tkhq/qos` |
| **Fireblocks MPC-CMP** | Threshold ECDSA/EdDSA library | `github.com/fireblocks/mpc-lib` |
| **Narval** | Policy engine for signing ops | `github.com/narval-xyz/narval` |
| **Dstack** | Docker-in-TDX framework | `github.com/Dstack-TEE/dstack` |
| **Automata DCAP** | On-chain SGX attestation verifier | `github.com/automata-network` |
| **Web3Signer** | Remote signing service (ECDSA+BLS) | `github.com/ConsenSys/web3signer` |

### On-Chain Attestation Verification

Automata Network has deployed Solidity contracts that verify Intel SGX DCAP
attestation quotes on-chain. This enables patterns like:
- Smart contract only accepts signed messages from a verified TEE
- DAO governs which enclave code hashes are approved
- On-chain proof that privacy-preserving computation ran correctly

Relevant for NozKash: `NozkVault.announce()` could verify that the mint
is running in an attested TEE before accepting blind signatures.

## Non-Custodial Guarantees

For a TEE-backed wallet to be non-custodial:

1. **Attestation**: User can verify the exact code running in the enclave
2. **No operator access**: Enclave memory inaccessible to host
3. **Key export**: User can extract their private key
4. **Policy transparency**: Signing policies are auditable
5. **No unilateral action**: Service cannot sign without user authorization

### Trust Model

Users trust:
- **Hardware vendor** (Intel/AMD/AWS): TEE implementation is correct
- **Attestation service**: Attestation is not forged
- **Code audit**: Published code matches attested code
- **No side channels**: TEE is resistant to known attacks

This is weaker than self-custody (hardware wallet) but stronger than
traditional custodial (exchange holds your keys).

## Key Recovery in Non-Custodial TEE Model

Challenge: If the TEE instance dies, keys are lost.

Solutions:
1. **Key sealing to enclave identity**: Keys encrypted to the enclave's
   sealing key, restorable on same hardware
2. **Distributed key backup**: MPC shares across multiple TEEs
3. **User-held backup**: Encrypted key backup given to user
4. **Social recovery**: Threshold scheme with trusted contacts
5. **Deterministic derivation**: Derive keys from user secret
   (NozKash already does this — `masterSeed + index`)

**NozKash advantage**: Our key derivation from `(masterSeed, index)` means
the TEE only needs the master seed. Recovery = re-derive everything.

## Relevance to NozKash

### Recommended Architecture

```
                    ┌─────────────────────────────────┐
                    │        AWS Nitro Enclave         │
                    │                                  │
                    │  ┌────────────┐ ┌─────────────┐ │
                    │  │ Key Manager│ │ Mint Service │ │
                    │  │ (signing)  │ │ (BLS blind   │ │
                    │  │            │ │  signatures) │ │
                    │  └────────────┘ └─────────────┘ │
                    │                                  │
                    │  ┌────────────────────────────┐  │
                    │  │ Policy Engine              │  │
                    │  │ - session caps             │  │
                    │  │ - tx limits                │  │
                    │  │ - compliance checks        │  │
                    │  └────────────────────────────┘  │
                    │                                  │
                    │  attestation ←──── remote verify │
                    └─────────────────────────────────┘
                              ▲           │
                              │           ▼
                    ┌─────────────────────────────────┐
                    │       API Gateway / x402        │
                    │    (agent requests, webhooks)    │
                    └─────────────────────────────────┘
```

Both **wallet signing** and **mint authority** run inside the same TEE:
- Wallet keys: derived from user's `masterSeed`
- Mint BLS key: `MINT_BLS_PRIVKEY` sealed in enclave
- Policy engine enforces spending limits, compliance checks
- Attestation proves to users that the mint is honest
