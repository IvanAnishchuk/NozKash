# Signature & Encoding EIPs

EIPs defining the message signing and encoding standards used by NozKash.

---

## EIP-191: Signed Data Standard

- **Authors:** Martin Holst Swende, Nick Johnson
- **Status:** Final (ERC)
- **Created:** 2016-01-20
- **Link:** <https://eips.ethereum.org/EIPS/eip-191>

Defines the envelope format for signed data in Ethereum:

```
0x19 <1 byte version> <version specific data> <data to sign>
```

Version bytes:
- `0x00` — Data with intended validator (multisig wallets)
- `0x01` — Structured data (EIP-712)
- `0x45` — `personal_sign` messages

The leading `0x19` byte ensures signed data cannot collide with valid RLP-encoded transactions.

**Used in NozKash:** EIP-712 (version `0x01`) builds on this standard. The `\x19\x01` prefix appears in `eip712_redemption_hash()` in both Python and TypeScript libraries. The app's seed derivation uses `personal_sign` (version `0x45`).

---

## EIP-712: Typed Structured Data Hashing and Signing

- **Authors:** Remco Bloemen, Leonid Logvinov, Jacob Evans
- **Status:** Final (Interface)
- **Created:** 2017-09-12
- **Link:** <https://eips.ethereum.org/EIPS/eip-712>

Defines a standard for hashing and signing typed structured data, enabling wallets to display human-readable signing prompts instead of opaque hex strings.

Key components:
- **Domain separator:** `keccak256(EIP712Domain(string name,string version,uint256 chainId,address verifyingContract))`
- **Struct hashing:** `keccak256(typeHash || encodeData(struct))`
- **Signed hash:** `keccak256(\x19\x01 || domainSeparator || structHash)`

**Used in NozKash:** The anti-MEV redemption proof uses EIP-712 to bind a nullifier to a specific recipient address and deadline:

```
NozkRedeem(address recipient, uint256 deadline)
```

Domain: `name="NozkVault"`, `version="1"`, `chainId`, `verifyingContract`.

Implemented in:
- `nozk_py/nozk_library.py` — `eip712_domain_separator()`, `eip712_redemption_hash()`
- `nozk_ts/nozk-library.ts` — `eip712DomainSeparator()`, `eip712RedemptionHash()`
- `sol/src/NozkVault.sol` — `DOMAIN_SEPARATOR`, `redemptionMessageHash()`

**References:** EIP-155 (chain ID), EIP-191 (signed data envelope).
