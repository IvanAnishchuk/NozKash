# Security Research

Threat models, known attack vectors, audit references, and security considerations for NozKash and similar privacy protocols.

---

## NozKash Threat Model

### Trust Assumptions

| Party | Trusted for | NOT trusted for |
|-------|-------------|-----------------|
| Mint | Liveness (must sign deposits) | Privacy (cannot link deposit to redemption) |
| Mint | Honest signing (BLS verified on-chain) | Token forgery (pairing check prevents it) |
| Contract | Correct execution (deterministic EVM) | — |
| User | Nothing (protocol protects against malicious users) | — |

### What the Mint Can Do

- **Deny service** — refuse to blind-sign a deposit (liveness failure)
- **Correlate timing** — if it logs deposit/redemption timestamps, statistical deanonymization is possible
- **Collude with observers** — mint + chain observer could narrow anonymity sets via timing

### What the Mint Cannot Do

- **Forge tokens** — BLS pairing check on-chain prevents it; the mint cannot produce a valid `S` without actually signing `B`
- **Steal funds** — redemption goes directly to the recipient specified in the EIP-712 signed message
- **Link deposits to redemptions** — the blinding factor `r` is secret; `B = r * H(msg)` reveals nothing about `msg`
- **Double-spend** — nullifier state machine (UNREVEALED -> REVEALED -> SPENT) is enforced on-chain

### Planned Mitigations for Mint Trust

- **Threshold blind signatures** — N-of-M mint committee, no single party can deny service or correlate
- **TEE attestation** — mint runs in a trusted execution environment, proving it doesn't log
- **Multiple independent mints** — users choose which mint to use

---

## Blind Signature Security

### Core Security Properties

| Property | Definition | Status in NozKash |
|----------|-----------|-------------------|
| **Blindness** | Signer cannot distinguish which message was signed | Guaranteed by multiplicative blinding: `B = r * H(msg)` |
| **Unforgeability** | Cannot produce valid (msg, sig) without signer's key | Guaranteed by BLS unforgeability (CDH assumption) |
| **Unlinkability** | Signer cannot link blind request to unblinded signature | Guaranteed: `S = S' * r^{-1}` is unlinkable to `S' = sk * B` |

### Known Attack Vectors on Blind Signatures

**Parallel session attacks (Wagner's attack):**
An attacker opens many parallel signing sessions and combines partial signatures to forge a new signature. Relevant to RSA-based blind signatures (Chaum's original scheme). Less relevant to NozKash because each blind signing is a single scalar multiplication `S' = sk * B` — there are no interactive rounds to exploit.

**Malleability:**
If the blinded point `B` can be manipulated to produce a related signature, the scheme may be insecure. In NozKash, the mint signs whatever `B` is submitted — the security relies on the on-chain pairing check `e(S, G2) == e(H(nullifier), PK_mint)` binding `S` to a specific nullifier.

**Blinding factor leakage:**
If `r` is predictable or reused, the mint can link deposits to redemptions. NozKash derives `r` deterministically from `keccak256("blind" || keccak256(seed || index))` reduced mod curve order — unique per token, unpredictable without the master seed.

### References

- E. Eaton. **"Security Analysis of Signature Schemes with Key Blinding."** ePrint 2023/380. <https://eprint.iacr.org/2023/380.pdf>
- IETF draft: **"Key Blinding for Signature Schemes."** <https://www.ietf.org/archive/id/draft-irtf-cfrg-signature-key-blinding-02.html>

---

## BLS Signature Security

### Rogue Key Attack

In aggregated BLS signatures, an attacker can craft a "rogue" public key `PK_rogue = PK_attacker - PK_victim` such that an aggregate signature verifies for a message the victim never signed.

**Defenses:**
1. **Proof of Possession (PoP):** Require signers to prove knowledge of their secret key (sign their own public key)
2. **Boneh et al. (2018):** Modified BLS multi-signatures with public-key aggregation that resist rogue-key attacks without PoP

**NozKash impact:** Low. NozKash uses a single mint key, not aggregated multi-party signatures. The rogue key attack is relevant if/when threshold blind signatures are implemented.

- Boneh, Drijvers, Neven. **"BLS Multi-Signatures With Public-Key Aggregation."** <https://crypto.stanford.edu/~dabo/pubs/papers/BLSmultisig.html>
- N. T. M. Quan. **"Attacks and weaknesses of BLS aggregate signatures."** ePrint 2021/377. <https://eprint.iacr.org/2021/377.pdf>

### Subgroup Attacks

If points are not validated to lie in the correct prime-order subgroup, an attacker can submit points in a small subgroup to extract information about the secret key or forge signatures.

**NozKash mitigation:** The EVM `ecPairing` precompile (0x08) performs subgroup checks on input points. The on-chain contract does not need to validate subgroup membership separately.

### IETF BLS Specification

- **Draft:** <https://www.ietf.org/archive/id/draft-irtf-cfrg-bls-signature-05.html>

---

## BN254 Security Level

BN254 was originally believed to provide 128-bit security. In 2016, Kim and Barbulescu published an improved number field sieve algorithm (exTNFS) for discrete logarithms in extension fields, reducing BN254's effective security to **~100 bits**.

This is the primary motivation for NozKash's planned migration to BLS12-381 (~117-120 bit security).

- Kim, Barbulescu. **"Extended Tower Number Field Sieve: A New Complexity for the Medium Prime Case."** CRYPTO 2016.
- IETF pairing-friendly curves draft: <https://www.ietf.org/archive/id/draft-irtf-cfrg-pairing-friendly-curves-08.html>
- BN254 explainer: <https://hackmd.io/@jpw/bn254>

---

## ECDSA / ecrecover Security

### Signature Malleability

For every ECDSA signature `(r, s, v)`, there exists an equivalent valid signature `(r, n-s, v')` where `n` is the secp256k1 order. If a contract uses the raw signature bytes as a key (e.g., in a mapping), an attacker can submit the malleable variant.

**NozKash mitigation:** The contract uses `ecrecover` to derive the signer address, then checks it against the expected nullifier address. The signature bytes themselves are not used as identifiers. Additionally, the nullifier state machine (REVEALED -> SPENT) prevents replay — once spent, the malleable signature is also rejected.

**Best practice:** Enforce low-s values (s < secp256k1n / 2 + 1) per EIP-2. OpenZeppelin's ECDSA library does this.

- OpenZeppelin ECDSA: <https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/utils/cryptography/ECDSA.sol>
- Signature attacks field guide: <https://scsfg.io/hackers/signature-attacks/>
- OpenZeppelin advisory (compact sig malleability): <https://github.com/OpenZeppelin/openzeppelin-contracts/security/advisories/GHSA-4h98-2769-gh6h>

### Replay Attacks

An ECDSA signature valid on one chain/contract could be replayed on another.

**NozKash mitigation (defense in depth):**
1. **EIP-712 domain separator** binds signatures to (chainId, contractAddress, name, version)
2. **Deadline parameter** makes signatures expire: `if (block.timestamp > deadline) revert ExpiredSignature()`
3. **Nullifier state machine** prevents double-use: once SPENT, any replay is rejected
4. **Nullifier uniqueness** each token has a unique spend address, so signatures are inherently single-use

---

## MEV & Front-Running

### The Attack

A front-runner observes a pending `redeem()` transaction, extracts the unblinded signature `S` and nullifier, and submits their own `redeem()` with a different recipient address and higher gas price.

### NozKash Defense

The `redeem()` function requires an **ECDSA signature** over an EIP-712 hash binding:
- The **nullifier** (spend address)
- The **recipient** address
- A **deadline** timestamp
- The **chain ID** and **contract address**

The front-runner cannot change the recipient without the spend private key. Submitting the same transaction with a different recipient produces an invalid signature.

```solidity
bytes32 txHash = redemptionMessageHash(recipient, deadline);
address recoveredNullifier = recoverSigner(txHash, spendSignature);
if (recoveredNullifier != nullifier) revert InvalidECDSA();
```

### Deposit Front-Running (Griefing)

An observer could front-run `deposit()` by registering the same `depositId` first. This is a griefing attack (not theft) — the victim's deposit fails but no funds are lost.

**Mitigation:** On low-traffic testnets, this is negligible. For mainnet, use private mempool submission (Flashbots Protect, MEV Blocker, etc.).

---

## Hash-to-Curve Security

### Try-and-Increment (BN254, Current)

NozKash uses try-and-increment: `keccak256(msg || counter_be32)` until a valid curve point is found.

**Timing side-channel:** The number of iterations varies per input (50% chance per iteration). This is NOT constant-time.

**NozKash impact:** Acceptable because the hash input (nullifier address) is **public** at verification time — there is no secret to leak. The side channel is only a concern when the hash input is secret, which it isn't in the reveal/redeem flow.

**On-chain:** The Solidity `hashToCurve()` function is `view` — executed in a static call context with no gas refund timing oracle.

### SWU Map (BLS12-381, Migration Target)

The BLS12-381 path uses the RFC 9380 SWU map, which IS constant-time. This eliminates the timing concern entirely.

---

## Anonymity Set & Deanonymization

### Anonymity Set Size

NozKash's anonymity set is all deposits that have been blind-signed by the same mint. Unlike Tornado Cash (where the set is all deposits in a specific denomination pool), NozKash's set grows with every deposit to the mint.

### Timing Correlation Attacks

The most practical deanonymization vector for any privacy pool:

1. **Deposit-redeem timing:** If a user deposits and redeems within a short window, the deposit/redeem pair can be correlated statistically
2. **Amount patterns:** Fixed denomination helps (all tokens look identical)
3. **Gas-paying address:** The address funding the deposit and the address receiving the redemption may be linkable through on-chain graph analysis

**Research:**
- Tornado Cash anonymity analysis showed the 0.1 ETH pool's average anonymity set of ~400 could be reduced to ~12 by assuming deposit-withdraw within 24 hours
- <https://arxiv.org/html/2510.09443v2> — Impact analysis of sanctions on privacy tools

### Mitigations

- **Wait before redeeming** — larger time gaps increase the anonymity set
- **Use relayers** — hide the gas-paying address for redemption
- **Avoid round-trip patterns** — don't deposit and redeem from related addresses
- **Multiple tokens** — deposit several tokens at different times, redeem later

---

## eCash Protocol Security (Comparative)

### Fedimint & Cashu

Modern eCash implementations providing reference points for NozKash security design:

**Fedimint** — Federated Chaumian eCash on Bitcoin:
- N-of-M guardian federation using threshold blind signatures
- No single guardian can steal funds or correlate transactions
- Remains operational if minority of guardians go offline
- <https://github.com/fedimint/fedimint>
- <https://fedimint.org/>

**Cashu** — Solo or federated eCash mints:
- Uses Blind Diffie-Hellman Key Exchange (BDHKE)
- Solo mint = single point of trust (similar to current NozKash)
- Federation support via threshold signatures
- <https://cashu.space/>
- <https://github.com/cashubtc>

**Trust-minimized mints (research):**
- <https://dl.acm.org/doi/fullHtml/10.1145/3664476.3670889> — BDHKE mint using secure hardware and distributed computation

### Double-Spend Prevention

| System | Online detection | Offline detection | Mechanism |
|--------|-----------------|-------------------|-----------|
| NozKash | Yes | N/A | On-chain nullifier state machine |
| Tornado Cash | Yes | N/A | On-chain nullifier hash set |
| Cashu | Yes | No | Mint checks spent-token database |
| Fedimint | Yes | No | Federation checks spent-token database |
| Chaum (original) | Yes | Yes (identity reveal) | Cut-and-choose protocol |

NozKash's on-chain nullifier is the strongest model — it's trustless (no mint involvement in verification) and publicly auditable.

---

## Audit References for Similar Protocols

### Tornado Cash
- **ABDK Consulting:** Cryptographic review, smart contract audit, zk-SNARK circuit audit. No critical issues found.
- <https://github.com/tornadocash/tornado-core>

### RAILGUN
- **ABDK** (July 2021)
- **Trail of Bits** (February 2022)
- **Zokyo** (September 2022)

### Privacy Pools (0xbow)
- Under active development; audit status tracked at <https://github.com/0xbow-io/privacy-pools-core>

### General Smart Contract Security Resources
- **Smart Contract Security Field Guide:** <https://scsfg.io/>
- **RareSkills Security Guide:** <https://rareskills.io/post/smart-contract-security>
- **OpenZeppelin contracts:** <https://github.com/OpenZeppelin/openzeppelin-contracts>

---

## NozKash Security Checklist

Current security measures implemented in the protocol:

### Cryptographic
- [x] BLS pairing verification on-chain (unforgeable mint signatures)
- [x] Multiplicative blinding with per-token unique `r` (unlinkability)
- [x] Identity point checks on scalar multiplications (Python library post-checks results; Solidity relies on precompile behavior)
- [x] Blinding factor `r = 0` rejection (implicit: `py_ecc.multiply()` returns identity for scalar 0, caught by post-check; no explicit `r == 0` guard)
- [x] Spend private key `= 0` rejection (implicit: `eth_keys.PrivateKey` constructor validates secp256k1 scalar range; no explicit NozKash guard)
- [x] Domain-separated key derivation (`"spend"` / `"blind"` prefixes)
- [x] Cross-language parity enforced via shared test vectors

### Smart Contract
- [x] EIP-712 domain separator (chain + contract binding)
- [x] Deadline-based signature expiry
- [x] Nullifier state machine (UNREVEALED -> REVEALED -> SPENT)
- [x] ecrecover result validation (`!= address(0)`)
- [x] ECDSA signature binds nullifier to recipient (MEV protection)
- [x] No reentrancy risk (single ETH transfer at end, no callbacks)
- [x] mintAuthority restriction on `announce()`
- [x] Refund mechanism for unfulfilled deposits
- [x] depositId uniqueness enforcement

### Operational
- [x] Secrets in environment variables, never hardcoded
- [x] Master seed derivation from wallet signature (RAM only, never persisted)
- [x] Stateless mint (all state on-chain, re-derivable)
- [x] Stateless wallet recovery (all secrets re-derivable from master seed + index)

### Needs Attention (Future Work)
- [ ] Formal security audit by independent firm
- [ ] Threshold blind signatures (distribute mint trust)
- [ ] Relayer service for gas-anonymous redemption
- [ ] Private mempool submission for deposit front-running protection
- [ ] Compliance screening at mint (blocklist / zkKYC)
- [ ] BN254 -> BLS12-381 migration (100-bit -> ~117-120 bit security)
- [ ] Explicit `r == 0` and `spend_priv == 0` guards (currently implicit via library validation)
- [ ] Low-s enforcement in ecrecover (currently relies on EVM behavior)
- [ ] Fuzz testing for edge cases in cryptographic operations
