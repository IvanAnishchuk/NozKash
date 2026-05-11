"""Derive MINT_BLS_PUBKEY from a BLS private key scalar."""

import sys

from bls12_381_crypto import CURVE_ORDER, G1_GEN, Scalar, g1_scalar_mul, serialize_g1_sol

if len(sys.argv) != 2:
    print(f"Usage: {sys.argv[0]} 0x<bls_privkey_hex>")
    sys.exit(1)

sk = int(sys.argv[1], 16) % CURVE_ORDER
if sk == 0:
    print("Error: private key reduces to zero mod CURVE_ORDER", file=sys.stderr)
    sys.exit(1)
pk = g1_scalar_mul(G1_GEN, Scalar(sk))

x_hi, x_lo, y_hi, y_lo = serialize_g1_sol(pk)

print(f"MINT_BLS_PUBKEY={hex(x_hi)},{hex(x_lo)},{hex(y_hi)},{hex(y_lo)}")
