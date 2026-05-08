# Downloaded Standards & Specifications

Local copies of all standards referenced by the NozKash protocol and its documentation.

## EIPs (Ethereum Improvement Proposals)

| File | Title | Relevance |
|------|-------|-----------|
| [eip-155.md](eips/eip-155.md) | Simple Replay Attack Protection | Chain ID; referenced by EIP-712 domain separator |
| [eip-191.md](eips/eip-191.md) | Signed Data Standard | `\x19\x01` prefix for EIP-712 signed data |
| [eip-196.md](eips/eip-196.md) | ecAdd/ecMul on alt_bn128 | BN254 precompiles at 0x06, 0x07 |
| [eip-197.md](eips/eip-197.md) | ecPairing on alt_bn128 | BN254 pairing check at 0x08; core of on-chain BLS verify |
| [eip-712.md](eips/eip-712.md) | Typed Structured Data Hashing and Signing | Anti-MEV redemption proof (NozkRedeem struct) |
| [eip-2333.md](eips/eip-2333.md) | BLS12-381 Key Generation | Hierarchical BLS key derivation from seed |
| [eip-2334.md](eips/eip-2334.md) | BLS12-381 Deterministic Account Hierarchy | Path structure for BLS key trees |
| [eip-2335.md](eips/eip-2335.md) | BLS12-381 Keystore | JSON format for encrypted BLS key storage |
| [eip-2494.md](eips/eip-2494.md) | Baby Jubjub Elliptic Curve | Twisted Edwards curve for zk-SNARK circuits (Tornado Cash, RAILGUN) |
| [eip-2537.md](eips/eip-2537.md) | BLS12-381 Precompiles | Pectra precompiles 0x0b-0x11; target for NozKash migration |
| [eip-5564.md](eips/eip-5564.md) | Stealth Addresses | One-time recipient addresses; future receive flow |
| [eip-6538.md](eips/eip-6538.md) | Stealth Meta-Address Registry | On-chain registry for stealth meta-addresses |
| [eip-7591.md](eips/eip-7591.md) | BLS Signed Transactions | BLS signature aggregation for Ethereum transactions |
| [eip-1271.md](eips/eip-1271.md) | Standard Signature Validation Method for Contracts | Contract signatures; required by EIP-6538 registry |
| [eip-2718.md](eips/eip-2718.md) | Typed Transaction Envelope | Transaction type framework; referenced by EIP-7591 |
| [eip-4337.md](eips/eip-4337.md) | Account Abstraction Using Alt Mempool | Smart accounts; referenced by EIP-5564, Kohaku pq-account |

## RFCs (IETF)

| File | Title | Relevance |
|------|-------|-----------|
| [rfc2898.txt](rfcs/rfc2898.txt) | PKCS#5 v2.0 (PBKDF2) | Key derivation in EIP-2335 keystore |
| [rfc3686.txt](rfcs/rfc3686.txt) | AES-CTR with IPsec ESP | Cipher mode in EIP-2335 keystore |
| [rfc4122.txt](rfcs/rfc4122.txt) | UUID URN Namespace | UUID format in EIP-2335 keystore |
| [rfc5869.txt](rfcs/rfc5869.txt) | HKDF (HMAC-based KDF) | Key derivation in EIP-2333 |
| [rfc6234.txt](rfcs/rfc6234.txt) | US Secure Hash Algorithms (SHA-256) | Checksum in EIP-2335 keystore |
| [rfc7914.txt](rfcs/rfc7914.txt) | scrypt | Memory-hard KDF option in EIP-2335 keystore |
| [rfc9380.txt](rfcs/rfc9380.txt) | Hashing to Elliptic Curves | SWU map; used in BLS12-381 hash-to-curve path |
| [draft-irtf-cfrg-pairing-friendly-curves.txt](rfcs/draft-irtf-cfrg-pairing-friendly-curves.txt) | Pairing-Friendly Curves (draft-08) | BN254 and BLS12-381 curve parameters |
| [draft-irtf-cfrg-bls-signature.txt](rfcs/draft-irtf-cfrg-bls-signature.txt) | BLS Signatures (draft-05) | IETF BLS signature standard |
| [rfc3447.txt](rfcs/rfc3447.txt) | PKCS#1 v2.1 (I2OSP/OS2IP) | Integer-to-octet encoding; referenced by EIP-2333 |
| [rfc7748.txt](rfcs/rfc7748.txt) | Elliptic Curves for Security | Curve25519/448; referenced by EIP-2494, RFC 9380 |
| [rfc8032.txt](rfcs/rfc8032.txt) | EdDSA | Edwards-curve signatures; referenced by EIP-2494 |

## BIPs (Bitcoin Improvement Proposals)

| File | Title | Relevance |
|------|-------|-----------|
| [bip-0032.mediawiki](bips/bip-0032.mediawiki) | Hierarchical Deterministic Wallets | Foundation for key derivation; referenced by EIP-2333 |
| [bip-0039.mediawiki](bips/bip-0039.mediawiki) | Mnemonic Seed Phrases | Seed generation standard; referenced by EIP-2333 |
| [bip-0043.mediawiki](bips/bip-0043.mediawiki) | Purpose Field for HD Wallets | Path purpose convention; referenced by EIP-2334 |
| [bip-0044.mediawiki](bips/bip-0044.mediawiki) | Multi-Account HD Wallets | Account hierarchy standard; referenced by EIP-2334 |
