import os
from dataclasses import dataclass

from eth_keys import keys
from eth_utils import keccak

from bls12_381_crypto import (
    CURVE_ORDER,
    G2_GEN,
    G1Point,
    G2Point,
    Scalar,
    abi_encode_g2,
    aggregate_g1,
    aggregate_g2,
    g1_scalar_mul,
    g2_scalar_mul,
    hash_to_g1,
    is_g1_identity,
    verify_pairing,
)

# ==============================================================================
# EXCEPTION HIERARCHY
# ==============================================================================


class NozkError(Exception):
    """Base class for all Nozk protocol errors."""


class CurveError(NozkError):
    """Raised when a curve point fails a validity check."""


class InvalidPointError(CurveError):
    """Raised when a supplied point does not lie on the expected curve."""


class ScalarMultiplicationError(CurveError):
    """Raised when scalar multiplication returns an unexpected result (e.g. point at infinity)."""


class DerivationError(NozkError):
    """Raised when token secret derivation receives invalid inputs."""


class VerificationError(NozkError):
    """Raised when a cryptographic verification step produces an unrecoverable error
    (as distinct from a clean False return from a verify_* function)."""


# ==============================================================================
# EIP-712 CONSTANTS
# ==============================================================================

EIP712_DOMAIN_TYPEHASH = keccak(b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
NOZKREDEEM_TYPEHASH = keccak(b"NozkRedeem(address recipient,uint256 deadline)")


def eip712_domain_separator(chain_id: int, contract_address: str) -> bytes:
    """Compute the EIP-712 domain separator for a NozkVault deployment."""
    addr = bytes.fromhex(contract_address.replace("0x", "").lower())
    return keccak(
        EIP712_DOMAIN_TYPEHASH
        + keccak(b"NozkVault")
        + keccak(b"1")
        + chain_id.to_bytes(32, "big")
        + addr.rjust(32, b"\x00")
    )


def eip712_redemption_hash(
    recipient_address: str,
    deadline: int,
    chain_id: int,
    contract_address: str,
) -> bytes:
    """Compute the full EIP-712 signed hash for a NozkRedeem struct."""
    addr = bytes.fromhex(recipient_address.replace("0x", "").lower())
    struct_hash = keccak(NOZKREDEEM_TYPEHASH + addr.rjust(32, b"\x00") + deadline.to_bytes(32, "big"))
    domain_sep = eip712_domain_separator(chain_id, contract_address)
    return keccak(b"\x19\x01" + domain_sep + struct_hash)


# ==============================================================================
# DATA CLASSES
# ==============================================================================


@dataclass
class TokenKeypair:
    """
    A secp256k1 keypair used ONLY for deposit ID derivation.
    The Ethereum address of the blind keypair serves as the deposit ID.
    """

    priv: keys.PrivateKey
    pub_hex: str  # 0x04-prefixed uncompressed public key (65 bytes, 132 hex chars)
    address: str  # 0x-prefixed Ethereum address (20 bytes)
    address_bytes: bytes  # raw 20 bytes


@dataclass
class TokenSecrets:
    """
    Client-side only. Must never be sent to the mint.

    spend_bls_priv:  BLS12-381 scalar — signs the anti-MEV redemption proof.
    spend_bls_pub:   G2 public key — THE NULLIFIER identity.
    nullifier_id:    bytes32 = keccak256(abi.encode(spend_bls_pub)) — on-chain mapping key.
    r:               BLS12-381 scalar — multiplicative blinding factor for B = r·Y.
    deposit_id:      Ethereum address of the blind keypair (revealed at deposit time).
    deposit_blind_keypair: secp256k1 keypair for deposit ID derivation.
    """

    spend_bls_priv: int  # scalar in Z_r
    spend_bls_pub: G2Point  # sk_spend * G2_gen — the nullifier
    nullifier_id: bytes  # keccak256(abi.encode(G2)) — 32 bytes
    r: int  # blind_priv % CURVE_ORDER
    deposit_id: str  # blind keypair Ethereum address
    deposit_blind_keypair: TokenKeypair  # secp256k1 keypair

    @property
    def nullifier_id_hex(self) -> str:
        return "0x" + self.nullifier_id.hex()


@dataclass
class BlindedPoints:
    Y: G1Point  # H(spend_bls_pub) — unblinded hash-to-curve result
    B: G1Point  # r·Y              — blinded point sent to mint


@dataclass
class RedemptionProof:
    """BLS12-381 redemption proof (replaces the former ECDSA proof)."""

    msg_hash: bytes  # EIP-712 hash
    sigma: G1Point  # spend_bls_priv * H_G1(msg_hash) — BLS signature
    spend_pub: G2Point  # spend_bls_priv * G2_gen — for on-chain verification


@dataclass
class MintKeypair:
    sk: Scalar  # BLS12-381 scalar private key in Z_r
    pk: G2Point  # sk·G2 — public verification key


# ==============================================================================
# HELPERS
# ==============================================================================


def _derive_blind_keypair(base_material: bytes) -> TokenKeypair:
    """
    Derives a secp256k1 TokenKeypair for the blind/deposit ID.
    The Ethereum address serves as the deposit ID.
    """
    priv_bytes = keccak(b"blind" + base_material)
    priv = keys.PrivateKey(priv_bytes)
    pub_hex = "0x04" + priv.public_key.to_bytes().hex()
    address = priv.public_key.to_address()
    return TokenKeypair(
        priv=priv,
        pub_hex=pub_hex,
        address=address,
        address_bytes=bytes.fromhex(address[2:]),
    )


# ==============================================================================
# 1. CORE CRYPTOGRAPHY UTILS
# ==============================================================================


def generate_mint_keypair() -> MintKeypair:
    """Generates a random BLS12-381 scalar and its G2 public key."""
    sk = Scalar(int.from_bytes(os.urandom(32), "big") % CURVE_ORDER)
    pk = g2_scalar_mul(G2_GEN, sk)
    return MintKeypair(sk=sk, pk=pk)


# ==============================================================================
# 2. CLIENT OPERATIONS (User Wallet)
# ==============================================================================


def derive_token_secrets(master_seed: bytes, token_index: int) -> TokenSecrets:
    """
    Deterministically derives token secrets for a given index.

    spend key:   BLS12-381 keypair (scalar + G2 pubkey). The G2 pubkey IS the nullifier.
    blind key:   secp256k1 keypair for deposit ID. Its private key (mod curve_order)
                 is the blinding factor r.
    nullifier_id: keccak256(abi.encode(spend_bls_pub)) — used as on-chain mapping key.
    """
    if not master_seed:
        raise DerivationError("master_seed must be non-empty")
    if token_index < 0:
        raise DerivationError(f"token_index must be non-negative, got {token_index}")
    if token_index > 0xFFFFFFFF:
        raise DerivationError(f"token_index must fit in 32 bits, got {token_index}")

    base_material = keccak(master_seed + token_index.to_bytes(4, "big"))

    # BLS12-381 spend key
    spend_priv_bytes = keccak(b"spend" + base_material)
    spend_bls_priv = int.from_bytes(spend_priv_bytes, "big") % CURVE_ORDER
    if spend_bls_priv == 0:
        raise DerivationError("spend_bls_priv derived as zero — use a different seed/index")
    spend_bls_pub = g2_scalar_mul(G2_GEN, Scalar(spend_bls_priv))

    # Nullifier ID = keccak256(abi.encode(G2_pubkey))
    nullifier_id = keccak(abi_encode_g2(spend_bls_pub))

    # secp256k1 blind keypair for deposit ID
    blind_kp = _derive_blind_keypair(base_material)

    # Blinding factor
    r = int.from_bytes(blind_kp.priv.to_bytes(), "big") % CURVE_ORDER
    if r == 0:
        raise DerivationError("blinding factor r derived as zero — use a different seed/index")

    return TokenSecrets(
        spend_bls_priv=spend_bls_priv,
        spend_bls_pub=spend_bls_pub,
        nullifier_id=nullifier_id,
        r=r,
        deposit_id=blind_kp.address,
        deposit_blind_keypair=blind_kp,
    )


def blind_token(spend_bls_pub: G2Point, r: int) -> BlindedPoints:
    """
    Maps the spend BLS public key (G2) to G1 via hash-to-curve, then blinds.
    Returns BlindedPoints(Y, B) where only B is sent to the mint.
    """
    Y = hash_to_g1(abi_encode_g2(spend_bls_pub))
    B = g1_scalar_mul(Y, Scalar(r))
    if is_g1_identity(B):
        raise ScalarMultiplicationError("Blinding produced the identity point — r is invalid")
    return BlindedPoints(Y=Y, B=B)


def unblind_signature(S_prime: G1Point, r: int) -> G1Point:
    """
    Removes the blinding factor from the mint's signature.
    Returns S = S' · r^-1.
    """
    r_inv = pow(r, -1, CURVE_ORDER)
    return g1_scalar_mul(S_prime, Scalar(r_inv))


def generate_redemption_proof(
    spend_bls_priv: int,
    spend_bls_pub: G2Point,
    destination_address: str,
    chain_id: int,
    contract_address: str,
    deadline: int,
) -> RedemptionProof:
    """
    Generates the anti-MEV BLS signature binding the token to a destination address.

    The message is an EIP-712 typed structured data hash.  The proof is a BLS
    signature: sigma = spend_bls_priv * H_G1(msg_hash).

    The on-chain contract verifies: e(sigma, G2_gen) == e(H_G1(msg_hash), spend_pub).
    """
    msg_hash = eip712_redemption_hash(destination_address, deadline, chain_id, contract_address)
    msg_point = hash_to_g1(msg_hash)
    sigma = g1_scalar_mul(msg_point, Scalar(spend_bls_priv))
    return RedemptionProof(
        msg_hash=msg_hash,
        sigma=sigma,
        spend_pub=spend_bls_pub,
    )


# ==============================================================================
# 3. MINT OPERATIONS (Server Daemon)
# ==============================================================================


def mint_blind_sign(B: G1Point, sk_mint: Scalar) -> G1Point:
    """
    Blindly signs a client's G1 point using the mint's scalar private key.
    Returns S' = sk · B.
    """
    result = g1_scalar_mul(B, sk_mint)
    if is_g1_identity(result):
        raise ScalarMultiplicationError("Blind signature produced identity — invalid input point or key")
    return result


# ==============================================================================
# 4. VERIFICATION LOGIC
# ==============================================================================


def verify_bls_mint_signature(S: G1Point, Y: G1Point, PK_mint: G2Point) -> bool:
    """
    Verifies the mint's BLS signature on a token.
    Checks: e(S, G2_gen) == e(Y, PK_mint).
    """
    return verify_pairing(S, Y, PK_mint)


def verify_bls_spend_signature(
    sigma: G1Point,
    msg_hash: bytes,
    spend_pub: G2Point,
) -> bool:
    """
    Verifies a BLS spend signature (replaces ECDSA ecrecover).
    Checks: e(sigma, G2_gen) == e(H_G1(msg_hash), spend_pub).
    """
    msg_point = hash_to_g1(msg_hash)
    return verify_pairing(sigma, msg_point, spend_pub)


# ==============================================================================
# 5. AGGREGATION
# ==============================================================================


def aggregate_reveal_sigma(unblinded_sigs: list[G1Point]) -> G1Point:
    """Aggregate multiple unblinded mint signatures for batch reveal."""
    return aggregate_g1(unblinded_sigs)


def verify_aggregated_reveal(
    sigma: G1Point,
    spend_pubs: list[G2Point],
    pk_mint: G2Point,
) -> bool:
    """
    Verify an aggregated reveal: multiple tokens signed by the same mint.
    Checks: e(sigma, G2_gen) == e(Y_agg, pk_mint)
    where Y_agg = sum(H_G1(abi_encode_g2(pub)) for pub in spend_pubs).
    """
    ys = [hash_to_g1(abi_encode_g2(pub)) for pub in spend_pubs]
    y_agg = aggregate_g1(ys)
    return verify_pairing(sigma, y_agg, pk_mint)


def aggregate_redeem_sigma(spend_sigs: list[G1Point]) -> G1Point:
    """Aggregate multiple spend BLS signatures for batch redeem."""
    return aggregate_g1(spend_sigs)


def verify_aggregated_redeem(
    sigma: G1Point,
    msg_hash: bytes,
    spend_pubs: list[G2Point],
) -> bool:
    """
    Verify an aggregated redeem: multiple spend keys sign the same message.
    Checks: e(sigma, G2_gen) == e(H_G1(msg_hash), PK_agg)
    where PK_agg = sum(spend_pubs).
    """
    pk_agg = aggregate_g2(spend_pubs)
    msg_point = hash_to_g1(msg_hash)
    return verify_pairing(sigma, msg_point, pk_agg)


# ==============================================================================
# QUICK SMOKE TEST
# ==============================================================================

if __name__ == "__main__":
    print("Testing Nozk Helper Library (BLS12-381)...")

    master_seed = b"super_secret_seed"
    destination = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7"

    keypair = generate_mint_keypair()
    secrets = derive_token_secrets(master_seed, token_index=42)

    print(f"Nullifier ID:               {secrets.nullifier_id_hex}")
    print(f"Deposit ID (blind addr):     {secrets.deposit_id}")
    print(f"Blinding scalar r:           {hex(secrets.r)}")

    blinded = blind_token(secrets.spend_bls_pub, secrets.r)

    S_prime = mint_blind_sign(blinded.B, keypair.sk)
    S = unblind_signature(S_prime, secrets.r)

    proof = generate_redemption_proof(
        secrets.spend_bls_priv,
        secrets.spend_bls_pub,
        destination,
        chain_id=11155111,
        contract_address="0x00000000000000000000000000000000DeaDBeef",
        deadline=2**256 - 1,
    )

    is_valid_bls_mint = verify_bls_mint_signature(S, blinded.Y, keypair.pk)
    is_valid_bls_spend = verify_bls_spend_signature(proof.sigma, proof.msg_hash, secrets.spend_bls_pub)

    print(f"BLS Mint Signature Valid:    {is_valid_bls_mint}")
    print(f"BLS Spend Signature Valid:   {is_valid_bls_spend}")
