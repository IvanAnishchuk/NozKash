# nozk_library API Reference

<!-- TODO: Auto-generate from nozk_py/nozk_library.py docstrings -->

Source: `nozk_py/nozk_library.py`

## Token Derivation

- `derive_token_secrets(master_seed, index)` -- derive spend/blind key pair from seed and index

## Blinding

- `blind_token(spend_addr)` -- produce blinded point `B = r * H_G1(spend_addr)` and blinding factor

## Unblinding

- `unblind_signature(blinded_sig, r)` -- remove blinding factor: `S = S' * r^-1`

## Verification

- `verify_signature(message, signature, pubkey)` -- BLS signature verification via pairing check

## Redemption

- `generate_redemption_proof(spend_priv, recipient, deadline)` -- EIP-712 typed data ECDSA signature

## Serialization

- Point encoding/decoding utilities for G1 and G2 points
- Big-endian encoding for all multi-byte values
