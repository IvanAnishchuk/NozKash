# Library References

Cryptographic and utility libraries used by NozKash, with links to documentation.

---

## Python (`nozk_py/`)

### py_ecc

Elliptic curve arithmetic for BN254 and BLS12-381.

- **PyPI:** <https://pypi.org/project/py-ecc/>
- **GitHub:** <https://github.com/ethereum/py_ecc>
- **Version:** `>=8.0.0`

Used for:
- `py_ecc.bn128` — BN254 G1/G2 operations, pairing (current on-chain code path)
- `py_ecc.optimized_bls12_381` — BLS12-381 operations including `optimized_swu_G1`, `iso_map_G1`, pairing (migration target)

### eth-keys

secp256k1 key operations and Ethereum address derivation.

- **PyPI:** <https://pypi.org/project/eth-keys/>
- **GitHub:** <https://github.com/ethereum/eth-keys>
- **Version:** `>=0.7.0`

Used for: spend/blind keypair derivation, public key to address conversion.

### eth-utils

Ethereum utility functions including Keccak-256 hashing.

- **PyPI:** <https://pypi.org/project/eth-utils/>
- **GitHub:** <https://github.com/ethereum/eth-utils>
- **Version:** `>=5.3.1`

Used for: `keccak()` hash function throughout the crypto library.

### web3.py

Ethereum JSON-RPC client for Python.

- **Docs:** <https://web3py.readthedocs.io/>
- **PyPI:** <https://pypi.org/project/web3/>
- **Version:** `>=7.14.1`

Used for: contract interaction (deposit, announce, redeem), event scanning, transaction broadcasting.

---

## TypeScript (`nozk_ts/`)

### mcl-wasm

WebAssembly implementation of BN254 and BLS12-381 curve arithmetic.

- **npm:** <https://www.npmjs.com/package/mcl-wasm>
- **GitHub:** <https://github.com/herumi/mcl-wasm>
- **Version:** `^2.0.0`

Initialized with `mcl.BN_SNARK1` for BN254 operations. Provides G1/G2 point arithmetic, scalar multiplication, and pairing checks. Used in `bn254-crypto.ts`.

### @noble/curves

Audited JavaScript implementation of elliptic curves including secp256k1.

- **npm:** <https://www.npmjs.com/package/@noble/curves>
- **GitHub:** <https://github.com/paulmillr/noble-curves>
- **Version:** `^2.0.1`

Used for: secp256k1 ECDSA operations in `nozk-library.ts` (spend key signing, address derivation).

### ethereum-cryptography

Audited cryptographic primitives for Ethereum (Keccak-256, etc.).

- **npm:** <https://www.npmjs.com/package/ethereum-cryptography>
- **GitHub:** <https://github.com/ethereum/js-ethereum-cryptography>
- **Version:** `^3.2.0`

Used for: `keccak256` hash function in `bn254-crypto.ts` and `nozk-library.ts`.

### viem

TypeScript Ethereum client (successor to ethers.js).

- **Docs:** <https://viem.sh/>
- **npm:** <https://www.npmjs.com/package/viem>
- **Version:** `^2.47.6`

Used for: contract interaction, transaction encoding, wallet operations in `client.ts`.

---

## Solidity (`sol/`)

### Foundry (forge)

Ethereum development toolchain for compiling, testing, and deploying Solidity contracts.

- **Docs:** <https://book.getfoundry.sh/>
- **GitHub:** <https://github.com/foundry-rs/foundry>

### forge-std

Standard library for Foundry tests and scripts.

- **GitHub:** <https://github.com/foundry-rs/forge-std>

Included as a git submodule at `sol/lib/forge-std/`.

---

## EVM Precompiles Used On-Chain

| Address | Name       | Purpose in NozKash              |
|---------|------------|---------------------------------|
| `0x05`  | modexp     | Modular exponentiation (sqrt)   |
| `0x06`  | ecAdd      | BN254 G1 point addition         |
| `0x07`  | ecMul      | BN254 G1 scalar multiplication  |
| `0x08`  | ecPairing  | BN254 pairing check (BLS verify)|

Post-Pectra (BLS12-381 migration):

| Address | Name              | Purpose                          |
|---------|-------------------|----------------------------------|
| `0x0b`  | BLS12_G1ADD       | G1 addition                      |
| `0x0c`  | BLS12_G1MSM       | G1 multi-scalar multiplication   |
| `0x0f`  | BLS12_PAIRING     | BLS12-381 pairing check          |
| `0x10`  | BLS12_MAP_FP_TO_G1| Hash-to-curve (SWU + isogeny)    |
