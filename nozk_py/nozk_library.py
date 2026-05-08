import os
from dataclasses import dataclass

from chia_rs import AugSchemeMPL, G1Element, G2Element, PrivateKey
from eth_keys import keys
from eth_utils import keccak

from bls12_381_crypto import (
    CURVE_ORDER,
    G1_GEN,
    G1Point,
    G2Point,
    Scalar,
    abi_encode_g1,
    aggregate_g2,
    g1_scalar_mul,
    g2_scalar_mul,
    hash_to_g2,
    verify_mint_pairing,
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
    """Raised when scalar multiplication returns an unexpected result."""


class DerivationError(NozkError):
    """Raised when token secret derivation receives invalid inputs."""


class VerificationError(NozkError):
    """Raised when a cryptographic verification step produces an unrecoverable error."""


# ==============================================================================
# EIP-712 CONSTANTS
# ==============================================================================

EIP712_DOMAIN_TYPEHASH = keccak(b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
NOZKREDEEM_TYPEHASH = keccak(b"NozkRedeem(address recipient,uint256 deadline)")


def eip712_domain_separator(chain_id: int, contract_address: str) -> bytes:
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
    addr = bytes.fromhex(recipient_address.replace("0x", "").lower())
    struct_hash = keccak(NOZKREDEEM_TYPEHASH + addr.rjust(32, b"\x00") + deadline.to_bytes(32, "big"))
    domain_sep = eip712_domain_separator(chain_id, contract_address)
    return keccak(b"\x19\x01" + domain_sep + struct_hash)


# ==============================================================================
# DATA CLASSES
# ==============================================================================


@dataclass
class TokenKeypair:
    """secp256k1 keypair for deposit ID derivation only."""

    priv: keys.PrivateKey
    pub_hex: str
    address: str
    address_bytes: bytes


@dataclass
class TokenSecrets:
    """
    Client-side only. Standard BLS scheme: PK in G1, Sig in G2.

    spend_bls_priv:  BLS12-381 scalar.
    spend_bls_pub:   G1 public key — THE NULLIFIER identity (py_ecc).
    spend_chia_sk:   chia_rs PrivateKey — for standard BLS sign/verify.
    spend_chia_pk:   chia_rs G1Element — for standard BLS sign/verify.
    nullifier_id:    bytes32 = keccak256(abi_encode_g1(spend_bls_pub)).
    r:               BLS12-381 scalar — blinding factor.
    """

    spend_bls_priv: int
    spend_bls_pub: G1Point  # py_ecc G1 — the nullifier
    spend_chia_sk: PrivateKey  # chia_rs for sign/verify
    spend_chia_pk: G1Element  # chia_rs G1Element
    nullifier_id: bytes  # keccak256(abi_encode_g1(spend_bls_pub))
    r: int
    deposit_id: str
    deposit_blind_keypair: TokenKeypair

    @property
    def nullifier_id_hex(self) -> str:
        return "0x" + self.nullifier_id.hex()


@dataclass
class BlindedPoints:
    Y: G2Point  # H_G2(spend_bls_pub) — unblinded hash-to-curve (G2 in standard scheme)
    B: G2Point  # r·Y — blinded point sent to mint


@dataclass
class RedemptionProof:
    """BLS spend signature via chia_rs AugSchemeMPL."""

    msg_hash: bytes  # EIP-712 hash
    sigma: G2Element  # chia_rs G2 signature
    spend_pk: G1Element  # chia_rs G1 public key


@dataclass
class MintKeypair:
    """Mint BLS keypair. Standard scheme: PK in G1."""

    sk: Scalar  # BLS12-381 scalar
    pk: G1Point  # py_ecc G1 point = sk * G1_gen


# ==============================================================================
# HELPERS
# ==============================================================================


def _derive_blind_keypair(base_material: bytes) -> TokenKeypair:
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
    """Generate a random BLS12-381 mint keypair (PK in G1)."""
    sk = Scalar(int.from_bytes(os.urandom(32), "big") % CURVE_ORDER)
    pk = g1_scalar_mul(G1_GEN, sk)
    return MintKeypair(sk=sk, pk=pk)


# ==============================================================================
# 2. CLIENT OPERATIONS
# ==============================================================================


def derive_token_secrets(master_seed: bytes, token_index: int) -> TokenSecrets:
    """
    Deterministically derive token secrets. Standard BLS: PK in G1.

    The G1 spend public key IS the nullifier identity.
    nullifier_id = keccak256(abi_encode_g1(spend_bls_pub)) — on-chain mapping key.
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
        raise DerivationError("spend_bls_priv derived as zero")

    # py_ecc G1 point (for blind signature protocol + nullifier identity)
    spend_bls_pub = g1_scalar_mul(G1_GEN, Scalar(spend_bls_priv))

    # chia_rs keypair (for standard BLS sign/verify of spend signature)
    spend_chia_sk = PrivateKey.from_bytes(spend_bls_priv.to_bytes(32, "big"))
    spend_chia_pk = spend_chia_sk.get_g1()

    # Nullifier ID
    nullifier_id = keccak(abi_encode_g1(spend_bls_pub))

    # Blind keypair (secp256k1 for deposit ID)
    blind_kp = _derive_blind_keypair(base_material)
    r = int.from_bytes(blind_kp.priv.to_bytes(), "big") % CURVE_ORDER
    if r == 0:
        raise DerivationError("blinding factor r derived as zero")

    return TokenSecrets(
        spend_bls_priv=spend_bls_priv,
        spend_bls_pub=spend_bls_pub,
        spend_chia_sk=spend_chia_sk,
        spend_chia_pk=spend_chia_pk,
        nullifier_id=nullifier_id,
        r=r,
        deposit_id=blind_kp.address,
        deposit_blind_keypair=blind_kp,
    )


def blind_token(spend_bls_pub: G1Point, r: int) -> BlindedPoints:
    """
    Hash the spend G1 pubkey to G2, then blind: B = r * Y.
    Standard scheme: hash to G2, signatures in G2.
    """
    Y = hash_to_g2(abi_encode_g1(spend_bls_pub))
    B = g2_scalar_mul(Y, Scalar(r))
    return BlindedPoints(Y=Y, B=B)


def unblind_signature(S_prime: G2Point, r: int) -> G2Point:
    """Remove blinding: S = S' * r^(-1). Signature is in G2."""
    r_inv = pow(r, -1, CURVE_ORDER)
    return g2_scalar_mul(S_prime, Scalar(r_inv))


def generate_redemption_proof(
    spend_chia_sk: PrivateKey,
    spend_chia_pk: G1Element,
    destination_address: str,
    chain_id: int,
    contract_address: str,
    deadline: int,
) -> RedemptionProof:
    """
    Generate anti-MEV BLS spend signature using chia_rs AugSchemeMPL.
    Signs the EIP-712 redemption hash. Signature is G2.
    """
    msg_hash = eip712_redemption_hash(destination_address, deadline, chain_id, contract_address)
    sigma = AugSchemeMPL.sign(spend_chia_sk, msg_hash)
    return RedemptionProof(
        msg_hash=msg_hash,
        sigma=sigma,
        spend_pk=spend_chia_pk,
    )


# ==============================================================================
# 3. MINT OPERATIONS
# ==============================================================================


def mint_blind_sign(B: G2Point, sk_mint: Scalar) -> G2Point:
    """Blind sign: S' = sk_mint * B. Signature is in G2 (standard scheme)."""
    from bls12_381_crypto import is_g2_identity

    result = g2_scalar_mul(B, sk_mint)
    if is_g2_identity(result):
        raise ScalarMultiplicationError("Blind signature produced identity")
    return result


# ==============================================================================
# 4. VERIFICATION
# ==============================================================================


def verify_bls_mint_signature(S: G2Point, Y: G2Point, PK_mint: G1Point) -> bool:
    """
    Verify mint BLS blind signature (standard: PK=G1, Sig=G2).
    Checks: e(PK_mint, Y) == e(G1_gen, S).
    """
    return verify_mint_pairing(S, Y, PK_mint)


def verify_bls_spend_signature(
    sigma: G2Element,
    msg_hash: bytes,
    spend_pk: G1Element,
) -> bool:
    """Verify BLS spend signature via chia_rs AugSchemeMPL."""
    return AugSchemeMPL.verify(spend_pk, msg_hash, sigma)


# ==============================================================================
# 5. AGGREGATION
# ==============================================================================


def aggregate_reveal_sigma(unblinded_sigs: list[G2Point]) -> G2Point:
    """Aggregate mint signatures for batch reveal (py_ecc G2 addition)."""
    return aggregate_g2(unblinded_sigs)


def verify_aggregated_reveal(
    sigma: G2Point,
    spend_pubs: list[G1Point],
    pk_mint: G1Point,
) -> bool:
    """
    Verify aggregated reveal: e(PK_mint, Y_agg) == e(G1_gen, sigma).
    Y_agg = sum(H_G2(abi_encode_g1(pub)) for pub in spend_pubs).
    """
    ys = [hash_to_g2(abi_encode_g1(pub)) for pub in spend_pubs]
    y_agg = aggregate_g2(ys)
    return verify_mint_pairing(sigma, y_agg, pk_mint)


def aggregate_redeem_sigma(spend_sigs: list[G2Element]) -> G2Element:
    """Aggregate spend signatures for batch redeem (chia_rs G2 addition)."""
    return AugSchemeMPL.aggregate(spend_sigs)


def verify_aggregated_redeem(
    sigma: G2Element,
    msg_hash: bytes,
    spend_pks: list[G1Element],
) -> bool:
    """
    Verify aggregated redeem via chia_rs AugSchemeMPL.
    Each key signed the same msg_hash.
    """
    msgs = [msg_hash] * len(spend_pks)
    return AugSchemeMPL.aggregate_verify(spend_pks, msgs, sigma)


# ==============================================================================
# SMOKE TEST
# ==============================================================================

if __name__ == "__main__":
    print("Testing Nozk Library (BLS12-381, standard scheme: PK=G1, Sig=G2)...")

    master_seed = b"super_secret_seed"
    destination = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7"

    keypair = generate_mint_keypair()
    secrets = derive_token_secrets(master_seed, token_index=42)

    print(f"Nullifier ID:           {secrets.nullifier_id_hex}")
    print(f"Deposit ID:             {secrets.deposit_id}")

    blinded = blind_token(secrets.spend_bls_pub, secrets.r)
    S_prime = mint_blind_sign(blinded.B, keypair.sk)
    S = unblind_signature(S_prime, secrets.r)

    proof = generate_redemption_proof(
        secrets.spend_chia_sk,
        secrets.spend_chia_pk,
        destination,
        chain_id=11155111,
        contract_address="0x00000000000000000000000000000000DeaDBeef",
        deadline=2**256 - 1,
    )

    print(f"Mint BLS Valid:         {verify_bls_mint_signature(S, blinded.Y, keypair.pk)}")
    print(f"Spend BLS Valid:        {verify_bls_spend_signature(proof.sigma, proof.msg_hash, secrets.spend_chia_pk)}")
