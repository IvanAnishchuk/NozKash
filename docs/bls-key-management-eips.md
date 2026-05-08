# BLS Key Management EIPs

EIPs defining standards for BLS12-381 key generation, hierarchy, and storage. These three EIPs form a complete key management stack originally designed for Ethereum's Beacon Chain validators.

---

## EIP-2333: BLS12-381 Key Generation

- **Author:** Carl Beekhuizen (@CarlBeek)
- **Status:** Draft (ERC)
- **Created:** 2019-09-30
- **Link:** <https://eips.ethereum.org/EIPS/eip-2333>

Defines a method for deriving a hierarchical tree of BLS12-381 keys from a single entropy seed. Uses HKDF (RFC 5869) for key derivation and includes a Lamport signature-based mechanism for quantum-resistant backup.

Key properties:
- A parent private key + child index deterministically derives a child key
- Invalid key probability is negligible (~1 in 2^127), unlike BIP32 which fails ~54% of the time for BLS12-381
- Chain-agnostic: no dependency on Keccak or any Ethereum-specific primitive

**Relevance to NozKash:** NozKash currently uses its own key derivation (`keccak256(seed || index_be32)` with domain separation), but EIP-2333 provides the standard approach for BLS12-381 key trees. May be relevant for the planned BLS12-381 migration.

**References:** RFC 5869 (HKDF), RFC 3447 (I2OSP/OS2IP), BIP32, BIP39.

---

## EIP-2334: BLS12-381 Deterministic Account Hierarchy

- **Author:** Carl Beekhuizen (@CarlBeek)
- **Status:** Draft (ERC)
- **Created:** 2019-09-30
- **Link:** <https://eips.ethereum.org/EIPS/eip-2334>

Defines the path structure for organizing keys derived via EIP-2333:

```
m / purpose / coin_type / account / use
```

- **Purpose:** `12381` (the BLS12-381 curve identifier)
- **Coin type:** `3600` for Ethereum (60^2, related to Ethereum's secp256k1 coin type 60)
- **Beacon Chain paths:**
  - Withdrawal key: `m/12381/3600/i/0`
  - Signing key: `m/12381/3600/i/0/0`

**Relevance to NozKash:** Provides a standard hierarchy model if NozKash adopts EIP-2333 key derivation.

**References:** EIP-2333, BIP43, BIP44, ERC-600, ERC-601.

---

## EIP-2335: BLS12-381 Keystore

- **Author:** Carl Beekhuizen (@CarlBeek)
- **Status:** Draft (ERC)
- **Created:** 2019-09-30
- **Link:** <https://eips.ethereum.org/EIPS/eip-2335>

Defines a JSON format for encrypted storage and interchange of BLS12-381 private keys. The keystore encrypts a private key with a password, allowing safe transport between devices.

### JSON Schema Structure

```json
{
  "crypto": {
    "kdf":      { "function": "scrypt|pbkdf2", "params": {...}, "message": "" },
    "checksum": { "function": "sha256",        "params": {},    "message": "..." },
    "cipher":   { "function": "aes-128-ctr",   "params": {...}, "message": "..." }
  },
  "path": "m/12381/3600/0/0",
  "uuid": "...",
  "version": 4,
  "pubkey": "...",
  "description": "..."
}
```

Decryption process:
1. **KDF** (scrypt or PBKDF2-SHA-256) derives decryption key from password
2. **Checksum** (SHA-256) verifies the password is correct
3. **Cipher** (AES-128-CTR) decrypts the secret key

Key design decisions:
- Modular crypto components (KDF, checksum, cipher can be swapped independently)
- No Keccak dependency (chain-agnostic, unlike Web3 Secret Storage)
- Password normalization: NFKD unicode, control codes stripped, UTF-8 encoded

**Relevance to NozKash:** Standard format for storing BLS12-381 mint keys and potentially wallet keys on the BLS12-381 migration path.

**References:** EIP-2333, EIP-2334, RFC 2898 (PBKDF2), RFC 7914 (scrypt), RFC 3686 (AES-CTR), RFC 4122 (UUID), RFC 6234 (SHA-256).
