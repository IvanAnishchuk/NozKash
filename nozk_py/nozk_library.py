"""Protocol-level operations for the NozKash blind signature eCash system.

This module implements the complete client-side and mint-side cryptographic
protocol for NozKash: a privacy-preserving eCash system for EVM chains using
BLS blind signatures over BLS12-381. It provides token derivation, blind
signature creation and unblinding, BLS spend signature generation, and
batch aggregation -- all without zero-knowledge proofs.

**Scheme overview (standard BLS):**

- Mint keypair: secret scalar ``sk``, public key ``PK = sk * G1_gen`` (G1).
- Token identity: spend keypair on BLS12-381; the G1 public key serves as the
  nullifier identity. The on-chain nullifier ID is
  ``keccak256(abi_encode_g1(spend_pub))``.
- Blind signature flow: hash spend_pub to G2 (``Y``), blind with scalar ``r``
  to get ``B = r * Y``, mint signs ``S' = sk * B``, client unblinds
  ``S = S' * r^{-1}``.
- Redemption: an AugSchemeMPL (chia_rs) signature over the EIP-712 redemption
  hash binds the nullifier to a recipient address, preventing MEV front-running.
- Verification: on-chain BLS12-381 pairing (EIP-2537) checks
  ``e(pkMint, Y) == e(G1_gen, S)`` for reveal, and AugSchemeMPL BLS verify
  for the spend signature in redeem.

Source of truth: this module (``nozk_library.py``) is the canonical
implementation. The TypeScript port (``nozk_ts/nozk-library.ts``) must produce
byte-identical output, enforced by shared test vectors in ``test_vectors/``.
"""

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
    is_g2_identity,
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
"""keccak256 of the EIP-712 domain type string for ``NozkVault``."""

NOZKREDEEM_TYPEHASH = keccak(b"NozkRedeem(address recipient,uint256 deadline)")
"""keccak256 of the ``NozkRedeem`` struct type string used in redemption messages."""


def eip712_domain_separator(chain_id: int, contract_address: str) -> bytes:
    """Compute the EIP-712 domain separator for a deployed NozkVault instance.

    Implements the ``hashStruct(eip712Domain)`` computation per EIP-712
    (https://eips.ethereum.org/EIPS/eip-712). The domain binds signatures to a
    specific contract deployment, preventing cross-chain and cross-contract
    replay attacks.

    Domain components:
        - ``name``:              ``"NozkVault"``
        - ``version``:           ``"1"``
        - ``chainId``:           the target EVM chain ID (e.g. 11155111 for Sepolia)
        - ``verifyingContract``: the deployed NozkVault contract address

    Args:
        chain_id: EVM chain ID (e.g. 11155111 for Sepolia).
        contract_address: Hex address of the deployed NozkVault contract.

    Returns:
        32-byte keccak256 domain separator hash.
    """
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
    """Compute the EIP-712 typed structured hash for a NozKash redemption.

    Produces the final 32-byte digest that gets signed by the spend key. The
    hash follows the EIP-712 encoding:
    ``keccak256("\\x19\\x01" || domainSeparator || hashStruct(NozkRedeem))``.

    The ``NozkRedeem`` struct contains the recipient address and a deadline
    timestamp, binding the redemption to a specific beneficiary and time window.
    This prevents MEV bots from front-running the redemption transaction.

    Args:
        recipient_address: Hex address of the ETH recipient.
        deadline: Unix timestamp after which the redemption expires.
        chain_id: EVM chain ID for domain separation.
        contract_address: Hex address of the deployed NozkVault contract.

    Returns:
        32-byte EIP-712 hash suitable for signing.
    """
    addr = bytes.fromhex(recipient_address.replace("0x", "").lower())
    struct_hash = keccak(NOZKREDEEM_TYPEHASH + addr.rjust(32, b"\x00") + deadline.to_bytes(32, "big"))
    domain_sep = eip712_domain_separator(chain_id, contract_address)
    return keccak(b"\x19\x01" + domain_sep + struct_hash)


# ==============================================================================
# DATA CLASSES
# ==============================================================================


@dataclass
class TokenKeypair:
    """A secp256k1 keypair used ONLY for deposit ID derivation.

    This is NOT a BLS keypair. The private key's raw bytes are reduced mod
    ``CURVE_ORDER`` to produce the blinding factor ``r``, and the derived
    Ethereum address serves as the on-chain ``depositId`` for the token.

    Attributes:
        priv: secp256k1 private key (eth_keys).
        pub_hex: Uncompressed public key hex string (``"0x04..."``).
        address: Checksummed Ethereum address derived from the public key.
        address_bytes: Raw 20-byte address.
    """

    priv: keys.PrivateKey
    pub_hex: str
    address: str
    address_bytes: bytes


@dataclass
class TokenSecrets:
    """All client-side secrets for a single NozKash token.

    Derived deterministically from ``(master_seed, token_index)`` so the wallet
    is fully recoverable by scanning on-chain events.

    **Standard BLS scheme:** public keys live in G1, signatures in G2.

    Two representations of the spend key are maintained because the blind
    signature protocol uses raw py_ecc G1 arithmetic while the AugSchemeMPL
    spend signature (at redemption) uses the chia_rs high-level API.

    Important distinction:
        - ``spend_bls_pub`` is the BLS12-381 **G1 point** that serves as the
          token's nullifier identity in the blind signature protocol. It is
          hashed to G2 during blinding and revealed at redemption time.
        - ``nullifier_id`` is ``keccak256(abi_encode_g1(spend_bls_pub))`` -- a
          32-byte hash used as the **on-chain mapping key** in the NozkVault
          contract's spent-nullifier set. These are NOT the same value:
          ``spend_bls_pub`` is a curve point, ``nullifier_id`` is its keccak
          digest for efficient EVM storage.

    Attributes:
        spend_bls_priv: BLS12-381 scalar (spend secret key).
        spend_bls_pub: py_ecc G1 point -- the nullifier identity curve point.
        spend_chia_sk: chia_rs ``PrivateKey`` -- same scalar, for AugSchemeMPL signing.
        spend_chia_pk: chia_rs ``G1Element`` -- same point, for AugSchemeMPL verification.
        nullifier_id: 32 bytes = ``keccak256(abi_encode_g1(spend_bls_pub))``,
            the on-chain mapping key (NOT the curve point itself).
        r: BLS12-381 scalar -- blinding factor for the blind signature protocol.
        deposit_id: Ethereum address used as the on-chain deposit identifier.
        deposit_blind_keypair: The secp256k1 keypair from which ``r`` and
            ``deposit_id`` are derived.
    """

    spend_bls_priv: int
    spend_bls_pub: G1Point  # py_ecc G1 -- the nullifier identity curve point
    spend_chia_sk: PrivateKey  # chia_rs PrivateKey for AugSchemeMPL sign/verify
    spend_chia_pk: G1Element  # chia_rs G1Element for AugSchemeMPL sign/verify
    nullifier_id: bytes  # keccak256(abi_encode_g1(spend_bls_pub)), NOT the point itself
    r: int
    deposit_id: str
    deposit_blind_keypair: TokenKeypair

    @property
    def nullifier_id_hex(self) -> str:
        return "0x" + self.nullifier_id.hex()


@dataclass
class BlindedPoints:
    """The pair of G2 points produced by the blinding step.

    During the blind signature protocol the client hashes its spend public key
    (a G1 point) to the G2 subgroup and then blinds the result with a random
    scalar ``r``.

    Attributes:
        Y: ``H_G2(abi_encode_g1(spend_bls_pub))`` -- the unblinded hash-to-curve
            point in G2. Kept locally; needed for signature verification later.
        B: ``r * Y`` -- the blinded point that is sent to the smart contract in
            the ``deposit()`` call and subsequently signed by the mint. The
            blinding factor ``r`` prevents the mint from learning the token's
            identity.
    """

    Y: G2Point  # H_G2(spend_bls_pub) -- unblinded hash-to-curve (G2 in standard scheme)
    B: G2Point  # r * Y -- blinded point sent to the contract / mint


@dataclass
class RedemptionProof:
    """Anti-MEV spend proof for token redemption.

    Contains a BLS signature produced by chia_rs ``AugSchemeMPL`` over the
    EIP-712 structured redemption hash. The signature (``sigma``) is a G2
    element because NozKash uses the standard BLS scheme (PK in G1, Sig in G2).

    AugSchemeMPL internally **augments** the signed message by prepending the
    compressed public key bytes before hashing, so the verifier must use
    ``AugSchemeMPL.verify`` (not basic scheme verify) with the same
    ``msg_hash``.

    Attributes:
        msg_hash: 32-byte EIP-712 typed structured hash
            (``keccak256("\\x19\\x01" || domainSep || structHash)``).
        sigma: chia_rs ``G2Element`` -- the AugSchemeMPL signature over
            ``msg_hash``.
        spend_pk: chia_rs ``G1Element`` -- the signer's public key, needed by
            the verifier.
    """

    msg_hash: bytes  # EIP-712 structured hash
    sigma: G2Element  # chia_rs G2 AugSchemeMPL signature
    spend_pk: G1Element  # chia_rs G1 public key of the signer


@dataclass
class MintKeypair:
    """BLS12-381 keypair for the NozKash mint authority.

    Uses the **standard BLS scheme** where the public key is a G1 point
    (``pk = sk * G1_gen``) and signatures are G2 points. This is the opposite
    of the "minimal-pubkey" scheme; the choice is dictated by EVM precompile
    gas costs for on-chain pairing verification.

    Attributes:
        sk: BLS12-381 scalar (mint secret key). Must be kept secret.
        pk: py_ecc G1 point (``sk * G1_gen``). Published on-chain and used by
            the pairing check during redemption verification.
    """

    sk: Scalar  # BLS12-381 scalar (mint secret key)
    pk: G1Point  # py_ecc G1 point = sk * G1_gen (public, stored on-chain)


# ==============================================================================
# HELPERS
# ==============================================================================


def _derive_blind_keypair(base_material: bytes) -> TokenKeypair:
    """Derive a secp256k1 keypair used for deposit ID and blinding factor.

    The private key is ``keccak256(b"blind" || base_material)`` -- a
    deterministic derivation with the ``"blind"`` domain separator. The
    resulting Ethereum address (``public_key.to_address()``) becomes the
    on-chain ``depositId``, and the private key bytes (reduced mod
    ``CURVE_ORDER``) become the BLS blinding factor ``r``.

    This is a secp256k1 keypair, NOT a BLS keypair.

    Args:
        base_material: Intermediate keying material
            (``keccak256(master_seed || index_be32)``).

    Returns:
        A :class:`TokenKeypair` with the derived secp256k1 key, address, etc.
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
    """Generate a random BLS12-381 mint keypair (standard scheme: PK in G1).

    Samples 32 random bytes, reduces mod ``CURVE_ORDER`` to obtain the secret
    scalar ``sk``, and computes the public key ``pk = sk * G1_gen``.

    Returns:
        A :class:`MintKeypair` with a fresh random secret and corresponding
        G1 public key.
    """
    sk = Scalar(int.from_bytes(os.urandom(64), "big") % CURVE_ORDER)
    pk = g1_scalar_mul(G1_GEN, sk)
    return MintKeypair(sk=sk, pk=pk)


# ==============================================================================
# 2. CLIENT OPERATIONS
# ==============================================================================


def derive_token_secrets(master_seed: bytes, token_index: int) -> TokenSecrets:
    """Deterministically derive all secrets for a single NozKash token.

    Derivation tree from ``(master_seed, token_index)``::

        base_material = keccak256(master_seed || index_be32)
            |
            +-- spend_priv  = keccak256(b"spend" || base_material) mod CURVE_ORDER
            |     +-- spend_bls_pub  = spend_priv * G1_gen          (py_ecc G1)
            |     +-- spend_chia_sk  = PrivateKey(spend_priv)       (chia_rs)
            |     +-- spend_chia_pk  = spend_chia_sk.get_g1()       (chia_rs G1Element)
            |     +-- nullifier_id   = keccak256(abi_encode_g1(spend_bls_pub))
            |
            +-- blind_kp   = _derive_blind_keypair(base_material)   (secp256k1)
                  +-- deposit_id  = blind_kp.address                (Ethereum address)
                  +-- r           = int(blind_kp.priv) mod CURVE_ORDER

    Standard BLS scheme: public keys in G1, signatures in G2.

    The G1 spend public key is the nullifier identity *curve point*. The
    ``nullifier_id`` (a 32-byte keccak hash of the ABI-encoded point) is a
    separate value used as the on-chain mapping key in the contract's
    spent-nullifier set.

    Args:
        master_seed: Wallet master seed (typically 32 bytes from
            ``keccak256(personal_sign_signature)``).
        token_index: Zero-based token index (must fit in 32 bits).

    Returns:
        A fully populated :class:`TokenSecrets` instance.

    Raises:
        DerivationError: If ``master_seed`` is empty, ``token_index`` is out of
            range, or a derived scalar is zero.
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
    """Compute the blinded token point for the deposit step.

    Performs two operations:

    1. **Hash-to-G2:** ABI-encodes the spend public key (G1) and hashes it to a
       G2 point using try-and-increment:
       ``Y = H_G2(abi_encode_g1(spend_bls_pub))``.
    2. **Blind:** Multiplies by the blinding scalar: ``B = r * Y``.

    The blinded point ``B`` is what the client sends to the NozkVault smart
    contract in the ``deposit(depositId, B)`` call. The mint later signs ``B``
    without learning which token it corresponds to.

    The unblinded point ``Y`` is kept locally and used during verification after
    unblinding the mint's signature.

    Args:
        spend_bls_pub: The token's BLS12-381 G1 public key (nullifier identity).
        r: Blinding factor scalar (derived from the blind keypair).

    Returns:
        A :class:`BlindedPoints` containing both ``Y`` and ``B``.

    Raises:
        DerivationError: If ``r`` is not in the valid range ``[1, CURVE_ORDER)``.
    """
    if not (0 < r < CURVE_ORDER):
        raise DerivationError("blinding factor r must be in [1, CURVE_ORDER)")
    Y = hash_to_g2(abi_encode_g1(spend_bls_pub))
    B = g2_scalar_mul(Y, Scalar(r))
    return BlindedPoints(Y=Y, B=B)


def unblind_signature(S_prime: G2Point, r: int) -> G2Point:
    """Remove the blinding factor from the mint's blind signature.

    Computes ``S = r^{-1} * S'`` where ``S'`` is the mint's blind signature
    (``sk * B = sk * r * Y``) and ``r^{-1}`` is the modular inverse of the
    blinding factor. The result ``S = sk * Y`` is the unblinded BLS signature
    in G2, verifiable via the standard pairing equation.

    Args:
        S_prime: The blind signature from the mint (G2 point).
        r: The blinding factor used during :func:`blind_token`.

    Returns:
        The unblinded signature ``S`` (G2 point).
    """
    if not (0 < r < CURVE_ORDER):
        raise DerivationError("blinding factor r must be in [1, CURVE_ORDER)")
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
    """Generate an anti-MEV BLS spend signature for token redemption.

    Signs the EIP-712 typed structured hash (see :func:`eip712_redemption_hash`)
    using chia_rs ``AugSchemeMPL.sign``. The resulting G2 signature binds the
    nullifier to a specific recipient address and deadline, preventing MEV bots
    from substituting a different beneficiary.

    **AugSchemeMPL note:** the augmented scheme internally prepends the
    compressed public key bytes to the message before hashing to G2, so the
    verifier must use ``AugSchemeMPL.verify(pk, msg_hash, sigma)`` -- not a
    basic-scheme verify -- with the *original* ``msg_hash`` (without the pk
    prefix). The library handles this transparently.

    Args:
        spend_chia_sk: chia_rs ``PrivateKey`` for the token's spend key.
        spend_chia_pk: Corresponding chia_rs ``G1Element`` public key.
        destination_address: Hex address of the ETH recipient.
        chain_id: EVM chain ID for EIP-712 domain separation.
        contract_address: Hex address of the deployed NozkVault contract.
        deadline: Unix timestamp after which the redemption expires.

    Returns:
        A :class:`RedemptionProof` containing the EIP-712 hash, the G2
        signature, and the signer's G1 public key.
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
    """Produce a blind signature on the client's blinded point.

    Computes ``S' = sk_mint * B`` where ``B`` is the blinded G2 point from the
    client's deposit. The mint performs this scalar multiplication without
    knowing the underlying token identity (which is hidden by the blinding
    factor ``r``).

    An identity check guards against degenerate inputs: if ``B`` encodes a
    point of small order or ``sk_mint`` is pathological, the result could be the
    G2 identity (point at infinity), which would be useless as a signature. This
    check raises :class:`ScalarMultiplicationError` in that case.

    Args:
        B: Blinded G2 point from the client (``r * H_G2(spend_pub)``).
        sk_mint: Mint's BLS12-381 secret scalar.

    Returns:
        The blind signature ``S'`` (G2 point).

    Raises:
        ScalarMultiplicationError: If the result is the G2 identity.
    """
    result = g2_scalar_mul(B, sk_mint)
    if is_g2_identity(result):
        raise ScalarMultiplicationError("Blind signature produced identity")
    return result


# ==============================================================================
# 4. VERIFICATION
# ==============================================================================


def verify_bls_mint_signature(S: G2Point, Y: G2Point, PK_mint: G1Point) -> bool:
    """Verify an unblinded mint BLS signature via the bilinear pairing.

    Checks the pairing equation:

        ``e(PK_mint, Y) == e(G1_gen, S)``

    where ``Y = H_G2(spend_pub)`` is the hash-to-curve point and
    ``S = sk_mint * Y`` is the unblinded signature. This is the standard BLS
    verification equation rearranged for the scheme where PK is in G1 and
    signatures are in G2.

    Delegates to :func:`bls12_381_crypto.verify_mint_pairing` which performs
    the actual ``ecPairing`` computation.

    Args:
        S: Unblinded mint signature (G2 point).
        Y: Hash-to-curve point ``H_G2(abi_encode_g1(spend_pub))`` (G2 point).
        PK_mint: Mint's public key (G1 point).

    Returns:
        ``True`` if the pairing check passes, ``False`` otherwise.
    """
    return verify_mint_pairing(S, Y, PK_mint)


def verify_bls_spend_signature(
    sigma: G2Element,
    msg_hash: bytes,
    spend_pk: G1Element,
) -> bool:
    """Verify a BLS spend signature produced by :func:`generate_redemption_proof`.

    Uses chia_rs ``AugSchemeMPL.verify`` which internally prepends the
    compressed public key to the message before hashing, matching the
    augmentation applied during signing.

    Args:
        sigma: chia_rs ``G2Element`` signature.
        msg_hash: The 32-byte EIP-712 hash that was signed.
        spend_pk: chia_rs ``G1Element`` public key of the signer.

    Returns:
        ``True`` if the signature is valid, ``False`` otherwise.
    """
    return AugSchemeMPL.verify(spend_pk, msg_hash, sigma)


# ==============================================================================
# 5. AGGREGATION
# ==============================================================================


def aggregate_reveal_sigma(unblinded_sigs: list[G2Point]) -> G2Point:
    """Aggregate multiple unblinded mint signatures for a batch reveal.

    Sums the individual G2 signature points using py_ecc G2 point addition.
    The aggregated signature can be verified in a single pairing check against
    the aggregated hash-to-curve points (see :func:`verify_aggregated_reveal`),
    saving gas on-chain compared to verifying each signature individually.

    Args:
        unblinded_sigs: List of unblinded G2 mint signatures to aggregate.

    Returns:
        The aggregated G2 signature point (sum of all inputs).

    Raises:
        ValueError: If ``unblinded_sigs`` is empty (mirrors Solidity ``EmptyBatch()``).
    """
    if not unblinded_sigs:
        raise ValueError("unblinded_sigs must not be empty (Solidity: EmptyBatch)")
    return aggregate_g2(unblinded_sigs)


def verify_aggregated_reveal(
    sigma: G2Point,
    spend_pubs: list[G1Point],
    pk_mint: G1Point,
) -> bool:
    """Verify a batch of unblinded mint signatures in a single pairing check.

    Reconstructs the aggregated hash-to-curve point by hashing each spend
    public key to G2 and summing, then verifies:

        ``e(PK_mint, Y_agg) == e(G1_gen, sigma)``

    where ``Y_agg = sum(H_G2(abi_encode_g1(pub)) for pub in spend_pubs)``.

    This allows verifying N mint signatures with a single pairing operation
    instead of N separate pairings.

    Args:
        sigma: Aggregated G2 mint signature (from :func:`aggregate_reveal_sigma`).
        spend_pubs: List of G1 spend public keys whose signatures were aggregated.
        pk_mint: Mint's G1 public key.

    Returns:
        ``True`` if the aggregated pairing check passes, ``False`` if
        ``spend_pubs`` is empty (mirrors Solidity ``EmptyBatch()``).
    """
    if not spend_pubs:
        return False
    ys = [hash_to_g2(abi_encode_g1(pub)) for pub in spend_pubs]
    y_agg = aggregate_g2(ys)
    return verify_mint_pairing(sigma, y_agg, pk_mint)


def aggregate_redeem_sigma(spend_sigs: list[G2Element]) -> G2Element:
    """Aggregate multiple AugSchemeMPL spend signatures for a batch redeem.

    Uses chia_rs ``AugSchemeMPL.aggregate`` to combine individual G2 spend
    signatures into a single aggregate signature. The aggregate can then be
    verified with :func:`verify_aggregated_redeem` using
    ``AugSchemeMPL.aggregate_verify``.

    Args:
        spend_sigs: List of chia_rs ``G2Element`` spend signatures.

    Returns:
        A single aggregated chia_rs ``G2Element``.

    Raises:
        ValueError: If ``spend_sigs`` is empty (mirrors Solidity ``EmptyBatch()``).
    """
    if not spend_sigs:
        raise ValueError("spend_sigs must not be empty (Solidity: EmptyBatch)")
    return AugSchemeMPL.aggregate(spend_sigs)


def verify_aggregated_redeem(
    sigma: G2Element,
    msg_hash: bytes,
    spend_pks: list[G1Element],
) -> bool:
    """Verify a batch of AugSchemeMPL spend signatures in one operation.

    All signers must have signed the *same* ``msg_hash`` (the EIP-712
    redemption hash). Uses chia_rs ``AugSchemeMPL.aggregate_verify`` which
    internally augments each message with the corresponding public key before
    verification.

    Args:
        sigma: Aggregated chia_rs ``G2Element`` (from
            :func:`aggregate_redeem_sigma`).
        msg_hash: The 32-byte EIP-712 hash that all signers signed.
        spend_pks: List of chia_rs ``G1Element`` public keys, one per signer,
            in the same order as the signatures were aggregated.

    Returns:
        ``True`` if the aggregate verification passes, ``False`` if
        ``spend_pks`` is empty (mirrors Solidity ``EmptyBatch()``).
    """
    if not spend_pks:
        return False
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
