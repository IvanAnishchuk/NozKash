import json
import pytest
from py_ecc.bn128 import G2, multiply
import ghost_library as gl

# ==============================================================================
# FIXTURES
# ==============================================================================
@pytest.fixture(scope="module")
def vectors():
    """Loads the known-good test vectors from the JSON file."""
    with open("vectors.json", "r") as f:
        return json.load(f)

# ==============================================================================
# VECTOR TESTS
# ==============================================================================

def test_mint_pk_vector(vectors):
    """Proves the Mint's G2 Public Key derives correctly from the scalar."""
    sk_mint = int(vectors["MINT_BLS_PRIVKEY_INT"])
    pk_mint = multiply(G2, sk_mint)

    # Extract py_ecc G2 coordinates
    x_real = hex(pk_mint[0].coeffs[0].n)[2:]
    x_imag = hex(pk_mint[0].coeffs[1].n)[2:]
    y_real = hex(pk_mint[1].coeffs[0].n)[2:]
    y_imag = hex(pk_mint[1].coeffs[1].n)[2:]

    assert x_real == vectors["PK_MINT"]["X_real"]
    assert x_imag == vectors["PK_MINT"]["X_imag"]
    assert y_real == vectors["PK_MINT"]["Y_real"]
    assert y_imag == vectors["PK_MINT"]["Y_imag"]

def test_derive_token_secrets_vector(vectors):
    """Proves deterministic derivation yields the exact address and blinding factor."""
    master_seed = vectors["MASTER_SEED"].encode("utf-8")
    token_index = vectors["TOKEN_INDEX"]

    secrets = gl.derive_token_secrets(master_seed, token_index)

    assert secrets["spend_address_hex"] == vectors["SPEND_ADDRESS"]
    assert str(secrets["r"]) == vectors["BLINDING_R"]

def test_blind_token_vector(vectors):
    """Proves the Hash-to-Curve mapping and Multiplicative Blinding match."""
    master_seed = vectors["MASTER_SEED"].encode("utf-8")
    secrets = gl.derive_token_secrets(master_seed, vectors["TOKEN_INDEX"])

    Y, B = gl.blind_token(secrets["spend_address_bytes"], secrets["r"])

    # Assert Unblinded Hash-to-Curve (Y)
    assert hex(Y[0].n)[2:] == vectors["Y_HASH_TO_CURVE"]["X"]
    assert hex(Y[1].n)[2:] == vectors["Y_HASH_TO_CURVE"]["Y"]
    
    # Assert Blinded Point (B)
    assert hex(B[0].n)[2:] == vectors["B_BLINDED"]["X"]
    assert hex(B[1].n)[2:] == vectors["B_BLINDED"]["Y"]

def test_mint_blind_sign_vector(vectors):
    """Proves the Mint's blind signature (S') generates the exact same point."""
    master_seed = vectors["MASTER_SEED"].encode("utf-8")
    secrets = gl.derive_token_secrets(master_seed, vectors["TOKEN_INDEX"])
    _, B = gl.blind_token(secrets["spend_address_bytes"], secrets["r"])
    
    sk_mint = int(vectors["MINT_BLS_PRIVKEY_INT"])

    S_prime = gl.mint_blind_sign(B, sk_mint)

    assert hex(S_prime[0].n)[2:] == vectors["S_PRIME"]["X"]
    assert hex(S_prime[1].n)[2:] == vectors["S_PRIME"]["Y"]

def test_unblind_signature_vector(vectors):
    """Proves the client-side unblinding correctly recovers the final token signature."""
    master_seed = vectors["MASTER_SEED"].encode("utf-8")
    secrets = gl.derive_token_secrets(master_seed, vectors["TOKEN_INDEX"])
    _, B = gl.blind_token(secrets["spend_address_bytes"], secrets["r"])
    sk_mint = int(vectors["MINT_BLS_PRIVKEY_INT"])
    S_prime = gl.mint_blind_sign(B, sk_mint)

    S = gl.unblind_signature(S_prime, secrets["r"])

    assert hex(S[0].n)[2:] == vectors["S_UNBLINDED"]["X"]
    assert hex(S[1].n)[2:] == vectors["S_UNBLINDED"]["Y"]
