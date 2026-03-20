import pytest
from eth_keys import keys
from eth_utils import keccak
# IMPORT b and b2 (The curve equation constants) instead of the G1/G2 generators!
from py_ecc.bn128 import curve_order, is_on_curve, b, b2

# Import your newly named library
import ghost_library as gl

# ==============================================================================
# FIXTURES
# ==============================================================================
@pytest.fixture
def setup_data():
    """Provides standard deterministic inputs for the tests."""
    master_seed = b"pytest_secret_master_seed_2026"
    token_index = 42
    destination = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7"
    return master_seed, token_index, destination

# ==============================================================================
# TESTS
# ==============================================================================

def test_mint_keypair_generation():
    """Ensures the Mint generates valid scalar keys and G2 points."""
    sk_mint, pk_mint = gl.generate_mint_keypair()
    
    # Secret key must be a valid scalar within the curve order
    assert isinstance(sk_mint, int)
    assert 0 < sk_mint < curve_order
    
    # Public key must be a mathematically valid point on the G2 curve (using constant b2)
    assert is_on_curve(pk_mint, b2)

def test_token_derivation_is_deterministic(setup_data):
    """Proves that passing the same seed and index yields the exact same secrets."""
    master_seed, token_index, _ = setup_data
    
    secrets1 = gl.derive_token_secrets(master_seed, token_index)
    secrets2 = gl.derive_token_secrets(master_seed, token_index)
    
    assert secrets1["spend_address_hex"] == secrets2["spend_address_hex"]
    assert secrets1["spend_priv"].to_hex() == secrets2["spend_priv"].to_hex()
    assert secrets1["r"] == secrets2["r"]

def test_full_protocol_lifecycle(setup_data):
    """Integration test: proves the math holds from blinding through verification."""
    master_seed, token_index, destination = setup_data
    
    # 1. Setup Mint
    sk_mint, PK_mint = gl.generate_mint_keypair()
    
    # 2. Client Setup & Blinding
    secrets = gl.derive_token_secrets(master_seed, token_index)
    Y, B = gl.blind_token(secrets["spend_address_bytes"], secrets["r"])
    
    # Y and B must both be valid points on G1 (using constant b)
    assert is_on_curve(Y, b)
    assert is_on_curve(B, b)
    
    # 3. Mint Signs
    S_prime = gl.mint_blind_sign(B, sk_mint)
    assert is_on_curve(S_prime, b)
    
    # 4. Client Unblinds & Proof
    S = gl.unblind_signature(S_prime, secrets["r"])
    assert is_on_curve(S, b)
    
    proof = gl.generate_redemption_proof(secrets["spend_priv"], destination)
    
    # 5. EVM Verification (ECDSA Check)
    is_valid_ecdsa = gl.verify_ecdsa_mev_protection(
        proof["msg_hash"], 
        proof["signature_obj"], 
        secrets["spend_address_hex"]
    )
    assert is_valid_ecdsa is True
    
    # 6. EVM Verification (BLS Check)
    is_valid_bls = gl.verify_bls_pairing(S, Y, PK_mint)
    assert is_valid_bls is True

def test_mev_protection_rejects_tampering(setup_data):
    """Proves that a tampered destination payload invalidates the ecrecover extraction."""
    master_seed, token_index, _ = setup_data
    secrets = gl.derive_token_secrets(master_seed, token_index)
    
    # User signs a transaction intended for Alice
    intended_destination = "0xAliceAddress"
    proof = gl.generate_redemption_proof(secrets["spend_priv"], intended_destination)
    
    # A front-running MEV bot intercepts it and tries to redirect funds to Bob
    tampered_payload_str = "Pay to: 0xBobAddress"
    tampered_msg_hash = keccak(tampered_payload_str.encode('utf-8'))
    
    # The smart contract verification should completely fail because ecrecover 
    # will yield a garbage address, not the token's spend_address_hex
    is_valid = gl.verify_ecdsa_mev_protection(
        tampered_msg_hash, 
        proof["signature_obj"], 
        secrets["spend_address_hex"]
    )
    assert is_valid is False
