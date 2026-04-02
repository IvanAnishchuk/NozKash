"""Derive MINT_BLS_PUBKEY from a BLS private key scalar."""

import sys

from py_ecc.bn128 import G2, curve_order, multiply

if len(sys.argv) != 2:
    print(f"Usage: {sys.argv[0]} 0x<bls_privkey_hex>")
    sys.exit(1)

sk = int(sys.argv[1], 16) % curve_order
pk = multiply(G2, sk)

x_imag = hex(pk[0].coeffs[1].n)
x_real = hex(pk[0].coeffs[0].n)
y_imag = hex(pk[1].coeffs[1].n)
y_real = hex(pk[1].coeffs[0].n)

print(f"MINT_BLS_PUBKEY={x_imag},{x_real},{y_imag},{y_real}")
