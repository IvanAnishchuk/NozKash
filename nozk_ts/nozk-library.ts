import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak256 } from 'ethereum-cryptography/keccak.js';
import {
    abiEncodeG1,
    aggregateG2,
    aggregateSignatures,
    blsAggregateVerify,
    blsGetPublicKey,
    blsSign,
    blsVerify,
    bytesToHex,
    CURVE_ORDER,
    G1_GEN,
    type G1Point,
    type G2Point,
    g1ScalarMul,
    g2ScalarMul,
    hashToG2,
    hexToBytes,
    modInverse,
    nullifierId,
    verifyMintPairing,
} from './bls12-381-crypto.js';

// Re-export types for downstream consumers
export type { G1Point, G2Point };

// ==============================================================================
// ERROR HIERARCHY
// ==============================================================================

export class NozkError extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}

export class DerivationError extends NozkError {}

export class VerificationError extends NozkError {}

// ==============================================================================
// TYPES
// ==============================================================================

/**
 * A secp256k1 keypair used for deposit ID derivation and blinding factor.
 *
 * NOT a BLS keypair. The private key bytes reduced mod CURVE_ORDER give
 * the BLS blinding factor r, and the Ethereum address is the on-chain depositId.
 */
export interface BlindKeypair {
    priv: Uint8Array; // 32-byte secp256k1 private key
    pubHex: string; // 0x-prefixed uncompressed public key (65 bytes, starts with 04)
    address: string; // 0x-prefixed Ethereum address (20 bytes)
    addressBytes: Uint8Array; // raw 20 bytes
}

/**
 * All client-side secrets for a single NozKash token.
 *
 * Standard BLS scheme: public keys in G1, signatures in G2.
 * Derived deterministically from (masterSeed, tokenIndex).
 */
export interface TokenSecrets {
    spendBlsPriv: bigint; // BLS12-381 scalar (spend secret key)
    spendBlsPub: G1Point; // G1 nullifier identity (projective)
    spendPubCompressed: Uint8Array; // 48-byte compressed G1 for AugSchemeMPL
    nullifierIdBytes: Uint8Array; // keccak256(abiEncodeG1(spendBlsPub))
    r: bigint; // blinding factor (blind priv reduced mod CURVE_ORDER)
    depositId: string; // Ethereum address from blind keypair
    blind: BlindKeypair; // secp256k1 keypair for deposit ID + r derivation
}

export interface BlindedPoints {
    Y: G2Point; // H(abiEncode(spendPub)) — unblinded hash-to-curve (G2 in BLS12-381)
    B: G2Point; // r·Y                    — blinded point sent to mint (G2)
}

export interface MintKeypair {
    skMint: bigint;
    pkMint: G1Point; // PK in G1 (standard BLS scheme)
}

/**
 * Anti-MEV BLS spend proof for token redemption.
 *
 * Contains an AugSchemeMPL signature (G2) over the EIP-712 redemption hash.
 * Mirrors Python's RedemptionProof dataclass.
 */
export interface RedemptionProof {
    msgHash: Uint8Array; // 32-byte EIP-712 structured hash
    sigma: Uint8Array; // compressed G2 AugSchemeMPL signature (96 bytes)
    spendPubCompressed: Uint8Array; // compressed G1 public key (48 bytes)
}

// ==============================================================================
// HELPERS
// ==============================================================================

/** Derives the Ethereum address from a 65-byte uncompressed public key. */
function pubKeyToAddress(pubKeyUncompressed: Uint8Array): string {
    return `0x${bytesToHex(keccak256(pubKeyUncompressed.slice(1)).slice(-20))}`;
}

/**
 * Derives a secp256k1 BlindKeypair from base material.
 * Domain label "blind" mirrors Python's b"blind".
 */
function deriveBlindKeypair(baseMaterial: Uint8Array): BlindKeypair {
    const domainBytes = new TextEncoder().encode('blind');
    const priv = keccak256(new Uint8Array([...domainBytes, ...baseMaterial]));
    const pubUncompressed = secp256k1.getPublicKey(priv, false);
    const pubHex = `0x${bytesToHex(pubUncompressed)}`;
    const address = pubKeyToAddress(pubUncompressed);
    const addressBytes = hexToBytes(address.slice(2));
    return { priv, pubHex, address, addressBytes };
}

/**
 * Derives the BLS scalar from raw private key bytes.
 * Mirrors Python: int.from_bytes(priv_bytes, "big") % CURVE_ORDER
 */
function toBlsScalar(priv: Uint8Array): bigint {
    return BigInt(`0x${bytesToHex(priv)}`) % CURVE_ORDER;
}

// ==============================================================================
// 1. CORE CRYPTOGRAPHY UTILS
// ==============================================================================

export function hashToCurve(messageBytes: Uint8Array): G2Point {
    return hashToG2(messageBytes);
}

export function generateMintKeypair(): MintKeypair {
    let skMint = 0n;
    while (skMint === 0n) {
        const skBytes = new Uint8Array(64);
        crypto.getRandomValues(skBytes);
        skMint = BigInt(`0x${bytesToHex(skBytes)}`) % CURVE_ORDER;
    }

    // Standard BLS scheme: PK in G1
    const pkMint = g1ScalarMul(G1_GEN, skMint);
    return { skMint, pkMint };
}

// ==============================================================================
// 2. CLIENT OPERATIONS (User Wallet)
// ==============================================================================

/**
 * Deterministically derives all secrets for a single NozKash token.
 *
 * Derivation tree from (masterSeed, tokenIndex):
 *   base_material = keccak256(masterSeed || index_be32)
 *     +-- spend_bls_priv  = keccak256("spend" || base_material) % CURVE_ORDER
 *     |     +-- spend_bls_pub     = spend_bls_priv * G1_gen
 *     |     +-- spend_pub_compressed (48-byte compressed G1)
 *     |     +-- nullifier_id      = keccak256(abiEncodeG1(spend_bls_pub))
 *     +-- blind_kp = deriveBlindKeypair(base_material)      (secp256k1)
 *           +-- deposit_id  = blind_kp.address
 *           +-- r           = int(blind_kp.priv) % CURVE_ORDER
 *
 * Mirrors Python's derive_token_secrets().
 * Throws DerivationError for invalid inputs.
 */
export function deriveTokenSecrets(masterSeed: Uint8Array, tokenIndex: number): TokenSecrets {
    if (masterSeed.length === 0) {
        throw new DerivationError('masterSeed must be non-empty');
    }
    if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 0xffffffff) {
        throw new DerivationError(`tokenIndex must be a non-negative 32-bit integer, got ${tokenIndex}`);
    }

    const indexBuf = new ArrayBuffer(4);
    new DataView(indexBuf).setUint32(0, tokenIndex, false);
    const baseMaterial = keccak256(new Uint8Array([...masterSeed, ...new Uint8Array(indexBuf)]));

    // BLS12-381 spend key
    const spendDomain = new TextEncoder().encode('spend');
    const spendPrivBytes = keccak256(new Uint8Array([...spendDomain, ...baseMaterial]));
    const spendBlsPriv = BigInt(`0x${bytesToHex(spendPrivBytes)}`) % CURVE_ORDER;
    if (spendBlsPriv === 0n) {
        throw new DerivationError('spend_bls_priv derived as zero');
    }

    const spendBlsPub = g1ScalarMul(G1_GEN, spendBlsPriv);
    const spendPubCompressed = blsGetPublicKey(spendBlsPriv);
    const nullifierIdBytes = nullifierId(spendBlsPub);

    // Blind keypair (secp256k1 for deposit ID + blinding factor)
    const blind = deriveBlindKeypair(baseMaterial);
    const r = toBlsScalar(blind.priv);
    if (r === 0n) {
        throw new DerivationError('blinding factor r derived as zero');
    }

    return {
        spendBlsPriv,
        spendBlsPub,
        spendPubCompressed,
        nullifierIdBytes,
        r,
        depositId: blind.address,
        blind,
    };
}

/** Get the deposit ID (blind keypair Ethereum address). */
export function getDepositId(secrets: TokenSecrets): string {
    return secrets.depositId;
}
/** Get the blinding factor r. */
export function getR(secrets: TokenSecrets): bigint {
    return secrets.r;
}
/** Get the nullifier ID as hex string (no prefix). */
export function getNullifierIdHex(secrets: TokenSecrets): string {
    return bytesToHex(secrets.nullifierIdBytes);
}

/**
 * Blinds a token for deposit.
 *
 * In BLS12-381 standard scheme:
 *   Y = hashToG2(abiEncodeG1(spendPub))   — hash the G1 spend pubkey's ABI encoding to G2
 *   B = r · Y                              — blind on G2
 */
export function blindToken(spendPub: G1Point, r: bigint): BlindedPoints {
    if (r <= 0n || r >= CURVE_ORDER) {
        throw new DerivationError(`blinding factor r must be in [1, CURVE_ORDER), got ${r}`);
    }
    const Y = hashToG2(abiEncodeG1(spendPub));
    const B = g2ScalarMul(Y, r);
    return { Y, B };
}

export function unblindSignature(S_prime: G2Point, r: bigint): G2Point {
    if (r <= 0n || r >= CURVE_ORDER) {
        throw new VerificationError(`blinding factor r must be in [1, CURVE_ORDER), got ${r}`);
    }
    const r_inv = modInverse(r);
    return g2ScalarMul(S_prime, r_inv);
}

// ==============================================================================
// 3. MINT OPERATIONS
// ==============================================================================

/** Returns S' = sk·B. Mirrors Python's mint_blind_sign(). */
export function mintBlindSign(B: G2Point, skMint: bigint): G2Point {
    return g2ScalarMul(B, skMint);
}

// ==============================================================================
// 4. REDEMPTION PROOF
// ==============================================================================

// ==============================================================================
// EIP-712 HELPERS
// ==============================================================================

const EIP712_DOMAIN_TYPEHASH = keccak256(
    new TextEncoder().encode('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
);
const NOZKREDEEM_TYPEHASH = keccak256(new TextEncoder().encode('NozkRedeem(address recipient,uint256 deadline)'));

function uint256BE(n: bigint): Uint8Array {
    const buf = new Uint8Array(32);
    for (let i = 31; i >= 0; i--) {
        buf[i] = Number(n & 0xffn);
        n >>= 8n;
    }
    return buf;
}

function addressPadded(addr: string): Uint8Array {
    const raw = hexToBytes(addr.replace('0x', '').toLowerCase());
    const out = new Uint8Array(32);
    out.set(raw, 12); // left-pad to 32 bytes
    return out;
}

export function eip712DomainSeparator(chainId: number, contractAddress: string): Uint8Array {
    const nameHash = keccak256(new TextEncoder().encode('NozkVault'));
    const versionHash = keccak256(new TextEncoder().encode('1'));
    return keccak256(
        new Uint8Array([
            ...EIP712_DOMAIN_TYPEHASH,
            ...nameHash,
            ...versionHash,
            ...uint256BE(BigInt(chainId)),
            ...addressPadded(contractAddress),
        ]),
    );
}

export function eip712RedemptionHash(
    recipientAddress: string,
    deadline: bigint,
    chainId: number,
    contractAddress: string,
): Uint8Array {
    const structHash = keccak256(
        new Uint8Array([...NOZKREDEEM_TYPEHASH, ...addressPadded(recipientAddress), ...uint256BE(deadline)]),
    );
    const domainSep = eip712DomainSeparator(chainId, contractAddress);
    return keccak256(new Uint8Array([0x19, 0x01, ...domainSep, ...structHash]));
}

/**
 * Generate an anti-MEV BLS spend signature for token redemption.
 *
 * Signs the EIP-712 typed structured hash using AugSchemeMPL (BLS12-381).
 * The G2 signature binds the nullifier to a specific recipient and deadline,
 * preventing MEV front-running.
 *
 * Mirrors Python's generate_redemption_proof().
 */
export function generateRedemptionProof(
    spendBlsPriv: bigint,
    spendPubCompressed: Uint8Array,
    destinationAddress: string,
    chainId: number,
    contractAddress: string,
    deadline: bigint,
): RedemptionProof {
    const msgHash = eip712RedemptionHash(destinationAddress, deadline, chainId, contractAddress);
    const sigma = blsSign(msgHash, spendBlsPriv);
    return { msgHash, sigma, spendPubCompressed };
}

// ==============================================================================
// 5. VERIFICATION
// ==============================================================================

export function verifyBlsPairing(S: G2Point, Y: G2Point, pkMint: G1Point): boolean {
    return verifyMintPairing(S, Y, pkMint);
}

/**
 * Verify a BLS spend signature produced by generateRedemptionProof().
 *
 * Uses AugSchemeMPL verify: internally prepends the compressed public key
 * to the message before hashing, matching the augmentation applied during signing.
 *
 * Mirrors Python's verify_bls_spend_signature().
 */
export function verifyBlsSpendSignature(proof: RedemptionProof): boolean {
    try {
        return blsVerify(proof.sigma, proof.msgHash, proof.spendPubCompressed);
    } catch {
        return false;
    }
}

// ==============================================================================
// 6. AGGREGATION
// ==============================================================================

/**
 * Aggregate multiple unblinded mint signatures for a batch reveal.
 * Sums the individual G2 signature points.
 * Mirrors Python's aggregate_reveal_sigma().
 */
export function aggregateRevealSigma(unblindedSigs: G2Point[]): G2Point {
    if (unblindedSigs.length === 0) {
        throw new VerificationError('unblindedSigs must not be empty');
    }
    return aggregateG2(unblindedSigs);
}

/**
 * Verify a batch of unblinded mint signatures in a single pairing check.
 *
 * Reconstructs the aggregated hash-to-curve point by hashing each spend
 * public key to G2 and summing, then verifies:
 *   e(PK_mint, Y_agg) == e(G1_gen, sigma)
 *
 * Mirrors Python's verify_aggregated_reveal().
 */
export function verifyAggregatedReveal(sigma: G2Point, spendPubs: G1Point[], pkMint: G1Point): boolean {
    if (spendPubs.length === 0) {
        return false;
    }
    const ys = spendPubs.map((pub) => hashToG2(abiEncodeG1(pub)));
    const yAgg = aggregateG2(ys);
    return verifyMintPairing(sigma, yAgg, pkMint);
}

/**
 * Aggregate multiple AugSchemeMPL spend signatures for a batch redeem.
 * Mirrors Python's aggregate_redeem_sigma().
 *
 * @param sigs - Array of compressed G2 signatures (96 bytes each).
 * @returns Aggregated compressed G2 signature (96 bytes).
 */
export function aggregateRedeemSigma(sigs: Uint8Array[]): Uint8Array {
    if (sigs.length === 0) {
        throw new VerificationError('sigs must not be empty');
    }
    return aggregateSignatures(sigs);
}

/**
 * Verify a batch of AugSchemeMPL spend signatures in one operation.
 * All signers must have signed the same msgHash.
 * Mirrors Python's verify_aggregated_redeem().
 */
export function verifyAggregatedRedeem(
    sigma: Uint8Array,
    msgHash: Uint8Array,
    spendPksCompressed: Uint8Array[],
): boolean {
    if (spendPksCompressed.length === 0) {
        return false;
    }
    return blsAggregateVerify(sigma, msgHash, spendPksCompressed);
}
