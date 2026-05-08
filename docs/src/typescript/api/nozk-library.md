# nozk-library API Reference

<!-- TODO: Auto-generate from nozk_ts/nozk-library.ts via typedoc or similar -->

Source: `nozk_ts/nozk-library.ts`

This module mirrors `nozk_py/nozk_library.py` exactly. All functions produce byte-identical output for the same inputs.

## Token Derivation

- `deriveTokenSecrets(masterSeed, index)` -- derive spend/blind key pair

## Blinding

- `blindToken(spendAddr)` -- produce blinded point and blinding factor

## Unblinding

- `unblindSignature(blindedSig, r)` -- remove blinding factor

## Verification

- `verifySignature(message, signature, pubkey)` -- BLS signature verification

## Redemption

- `generateRedemptionProof(spendPriv, recipient, deadline)` -- EIP-712 ECDSA proof

## Imports

The frontend app imports this library via the `@nozk/` Vite alias:

```typescript
import { deriveTokenSecrets } from "@nozk/nozk-library.js";
```

Note: NodeNext module resolution requires `.js` extensions in imports.
