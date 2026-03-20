import os
from eth_keys import keys
from py_ecc.bn128 import curve_order, G2, multiply


def generate_keys():
    print("========================================")
    print("🔒 GHOST-TIP MINT KEY GENERATION UTILITY")
    print("========================================\n")

    # ---------------------------------------------------------
    # 1. SECP256K1 IDENTITY KEY (ECDH Return Channel)
    # ---------------------------------------------------------
    identity_priv_bytes = os.urandom(32)
    identity_priv_key = keys.PrivateKey(identity_priv_bytes)
    identity_pub_compressed = identity_priv_key.public_key.to_compressed_bytes().hex()

    print("--- [1] SECP256K1 IDENTITY KEYS ---")
    print(
        f"MINT_IDENTITY_PRIVKEY_HEX (Python .env) : 0x{identity_priv_key.to_hex()[2:]}"
    )
    print(f"MINT_IDENTITY_PUBKEY      (Frontend TS) : 0x{identity_pub_compressed}\n")

    # ---------------------------------------------------------
    # 2. BN254 BLIND SIGNATURE KEY
    # ---------------------------------------------------------
    sk_bytes = os.urandom(32)
    sk_int = int.from_bytes(sk_bytes, "big") % curve_order

    # Calculate PK_mint = sk * G2
    pk_g2 = multiply(G2, sk_int)

    # Extract coordinates
    # py_ecc G2 points are tuples of FQ2 polynomials: ((x.real, x.imag), (y.real, y.imag))
    # Note: Solidity ecPairing expects: [x.imag, x.real, y.imag, y.real]
    x_real = pk_g2[0].coeffs[0].n
    x_imag = pk_g2[0].coeffs[1].n
    y_real = pk_g2[1].coeffs[0].n
    y_imag = pk_g2[1].coeffs[1].n

    print("--- [2] BN254 BLS KEYS ---")
    print(f"MINT_BLS_PRIVKEY_INT      (Python .env) : {sk_int}\n")

    # Format for Solidity (Base-10 Integers)
    print("PK_MINT_SOLIDITY          (Smart Contract):")
    print(f"[{x_imag},\n {x_real},\n {y_imag},\n {y_real}]\n")

    # Format for TypeScript / mcl-wasm (Hex Strings)
    print("PK_MINT_TYPESCRIPT        (Frontend TS):")
    print(
        f"['{hex(x_imag)}',\n '{hex(x_real)}',\n '{hex(y_imag)}',\n '{hex(y_real)}']\n"
    )


if __name__ == "__main__":
    generate_keys()
