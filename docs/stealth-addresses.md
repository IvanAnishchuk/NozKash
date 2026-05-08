# Stealth Addresses

Stealth addresses allow senders to non-interactively generate one-time addresses that only the intended recipient can control, hiding the recipient's identity from on-chain observers.

---

## EIP-5564: Stealth Addresses

- **Authors:** Toni Wahrstätter, Matt Solomon, Ben DiFrancesco, Vitalik Buterin
- **Status:** Draft (ERC)
- **Created:** 2022-08-13
- **Link:** <https://eips.ethereum.org/EIPS/eip-5564>

Defines the core stealth address mechanism for Ethereum:

**Stealth meta-address format:**
```
st:<chain>:0x<spendingPubKey><viewingPubKey>
```

**How it works:**
1. Recipient publishes a stealth meta-address (spending key + viewing key)
2. Sender generates ephemeral keypair, computes shared secret via ECDH
3. Sender derives a one-time stealth address from the shared secret + recipient's spending key
4. Sender publishes ephemeral public key in an `Announcement` event
5. Recipient scans announcements using their viewing key to find payments
6. Recipient derives the private key for the stealth address using their spending key

**Singleton contract:** `0x55649E01B5Df198D18D95b5cc5051630cfD45564`

The initial scheme uses **SECP256k1** with a view tag optimization (first byte of shared secret hash) for efficient scanning.

**References:** ERC-6538, ERC-4337, RFC 2119.

---

## ERC-6538: Stealth Meta-Address Registry

- **Authors:** Matt Solomon, Toni Wahrstätter, Ben DiFrancesco, Vitalik Buterin, Gary Ghayrat
- **Status:** Draft (ERC)
- **Created:** 2023-01-24
- **Link:** <https://eips.ethereum.org/EIPS/eip-6538>

Defines a canonical on-chain registry for stealth meta-addresses:

- `registerKeys()` — direct registration
- `registerKeysOnBehalf()` — delegated via EIP-712 or EIP-1271 signatures
- Nonce-based replay protection
- Scheme ID 1 = SECP256k1

**Singleton contract:** `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538`

**References:** EIP-5564, EIP-712, EIP-1271, EIP-3770.

---

## Umbra (ScopeLift)

The first production implementation of stealth addresses on Ethereum mainnet.

- **Contracts:** <https://github.com/ScopeLift/stealth-address-erc-contracts>
- **SDK:** <https://github.com/ScopeLift/stealth-address-sdk>

Implements EIP-5564 + ERC-6538 on Ethereum mainnet and L2s.

---

## Vitalik Buterin: "An Incomplete Guide to Stealth Addresses"

- **Published:** January 20, 2023
- **Link:** <https://vitalik.eth.limo/general/2023/01/20/stealth.html>

Foundational blog post that motivated EIP-5564. Describes the privacy problem (ENS names, POAPs, NFTs, soulbound tokens all leak identity), the Diffie-Hellman key exchange mechanism for stealth addresses, and the scan/spend key separation.

---

## Dual-Key Stealth Address Protocol (DKSAP)

The cryptographic foundation behind modern stealth address schemes:

- **Scan key pair** (s, S) — used to detect incoming payments
- **Spend key pair** (b, B) — used to spend received funds
- Recipient shares (s, B) with auditors/proxies who can scan but not spend

First implemented in ShadowSend (2014), later adopted by Monero.

**Research:**
- <https://arxiv.org/html/2312.10698> — HE-DKSAP: Privacy-preserving stealth addresses via homomorphic encryption
- <https://arxiv.org/pdf/2312.12131> — Elliptic curve pairing stealth address protocols

---

## Relevance to NozKash

NozKash solves a different privacy problem (unlinkable token transfers via blind signatures) but shares the goal of recipient privacy. Stealth addresses hide *who receives*; NozKash hides *which deposit maps to which redemption*. The two approaches are complementary — a user could receive funds to a stealth address and then deposit into NozKash for further unlinkability.
