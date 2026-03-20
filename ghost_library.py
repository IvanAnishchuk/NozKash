import os
from eth_keys import keys
from eth_utils import keccak
from py_ecc.bn128 import (
    G1, G2, multiply, curve_order, field_modulus, pairing, FQ
)

# ==============================================================================
# 1. CORE CRYPTOGRAPHY UTILS
# ==============================================================================

def hash_to_curve(message_bytes: bytes) -> tuple:
    """
    A 'try-and-increment' hash-to-curve mapping for BN254 G1.
    Finds a valid x coordinate where x^3 + 3 is a quadratic residue.
    """
    counter = 0
    while True:
        h = keccak(message_bytes + counter.to_bytes(4, 'big'))
        x = int.from_bytes(h, 'big') % field_modulus
        
        y_squared = (pow(x, 3, field_modulus) + 3) % field_modulus
        
        if pow(y_squared, (field_modulus - 1) // 2, field_modulus) == 1:
            y = pow(y_squared, (field_modulus + 1) // 4, field_modulus)
            return (FQ(x), FQ(y))
        
        counter += 1

def generate_mint_keypair() -> tuple[int, tuple]:
    """Generates a random BLS scalar and its corresponding G2 Public Key."""
    sk_mint = int.from_bytes(os.urandom(32), 'big') % curve_order
    pk_mint = multiply(G2, sk_mint)
    return sk_mint, pk_mint

# ==============================================================================
# 2. CLIENT OPERATIONS (User Wallet)
# ==============================================================================

def derive_token_secrets(master_seed: bytes, token_index: int) -> dict:
    """
    Deterministically derives the ECDSA identity and the BLS blinding factor.
    """
    base_material = keccak(master_seed + token_index.to_bytes(4, 'big'))
    
    spend_priv_bytes = keccak(b"spend" + base_material)
    spend_priv = keys.PrivateKey(spend_priv_bytes)
    spend_address_hex = spend_priv.public_key.to_address()
    spend_address_bytes = bytes.fromhex(spend_address_hex[2:])
    
    r = int.from_bytes(keccak(b"blind" + base_material), 'big') % curve_order
    
    return {
        "spend_priv": spend_priv,
        "spend_address_hex": spend_address_hex,
        "spend_address_bytes": spend_address_bytes,
        "r": r
    }

def blind_token(spend_address_bytes: bytes, r: int) -> tuple[tuple, tuple]:
    """
    Maps the token secret to G1 and applies the multiplicative blinding factor.
    Returns (Y, B) where Y is the unblinded point and B is the blinded point.
    """
    Y = hash_to_curve(spend_address_bytes)
    B = multiply(Y, r)
    return Y, B

def unblind_signature(S_prime: tuple, r: int) -> tuple:
    """
    Removes the blinding factor from the Mint's signature.
    Returns S = S' * r^-1.
    """
    r_inv = pow(r, -1, curve_order)
    S = multiply(S_prime, r_inv)
    return S

def generate_redemption_proof(spend_priv: keys.PrivateKey, destination_address: str) -> dict:
    """
    Generates the anti-MEV ECDSA signature binding the token to a destination.
    Returns the message hash, the raw signature object, and the hex formatted signature.
    """
    payload_str = f"Pay to: {destination_address}"
    msg_hash = keccak(payload_str.encode('utf-8'))
    
    ecdsa_sig = spend_priv.sign_msg_hash(msg_hash)
    
    # Format to perfectly match TypeScript's compactHex format (64 chars)
    r_hex = hex(ecdsa_sig.r)[2:].zfill(64)
    s_hex = hex(ecdsa_sig.s)[2:].zfill(64)
    compact_hex = r_hex + s_hex
    
    return {
        "msg_hash": msg_hash,
        "signature_obj": ecdsa_sig,
        "compact_hex": compact_hex,
        "recovery_bit": ecdsa_sig.v
    }

# ==============================================================================
# 3. MINT OPERATIONS (Server Daemon)
# ==============================================================================

def mint_blind_sign(B: tuple, sk_mint: int) -> tuple:
    """
    Blindly signs a user's point on G1 using the Mint's scalar private key.
    Returns S' = sk * B.
    """
    S_prime = multiply(B, sk_mint)
    return S_prime

# ==============================================================================
# 4. VERIFICATION LOGIC (EVM Equivalents)
# ==============================================================================

def verify_ecdsa_mev_protection(msg_hash: bytes, ecdsa_sig: keys.Signature, expected_address_hex: str) -> bool:
    """
    Simulates the EVM ecrecover precompile to ensure the signature resolves 
    to the expected spend address (nullifier).
    """
    recovered_pubkey = ecdsa_sig.recover_public_key_from_msg_hash(msg_hash)
    recovered_address = recovered_pubkey.to_address()
    return recovered_address.lower() == expected_address_hex.lower()

def verify_bls_pairing(S: tuple, Y: tuple, PK_mint: tuple) -> bool:
    """
    Simulates the EVM 0x08 ecPairing precompile.
    Checks if e(S, G2) == e(Y, PK_mint).
    """
    left_side = pairing(G2, S)
    right_side = pairing(PK_mint, Y)
    return left_side == right_side


if __name__ == "__main__":
    print("👻 Testing Ghost-Tip Helper Library...")

    # 1. Setup
    master_seed = b"super_secret_seed"
    destination = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7"
    sk_mint, PK_mint = generate_mint_keypair()

    # 2. Client Derives & Blinds
    secrets = derive_token_secrets(master_seed, token_index=42)
    Y, B = blind_token(secrets['spend_address_bytes'], secrets['r'])

    # 3. Mint Signs
    S_prime = mint_blind_sign(B, sk_mint)

    # 4. Client Unblinds & Generates Proof
    S = unblind_signature(S_prime, secrets['r'])
    proof = generate_redemption_proof(secrets['spend_priv'], destination)

    # 5. EVM Verifies
    is_valid_ecdsa = verify_ecdsa_mev_protection(
        proof['msg_hash'], 
        proof['signature_obj'], 
        secrets['spend_address_hex']
    )
    is_valid_bls = verify_bls_pairing(S, Y, PK_mint)

    print(f"MEV Protection Valid: {is_valid_ecdsa}")
    print(f"BLS Pairing Valid:    {is_valid_bls}")
