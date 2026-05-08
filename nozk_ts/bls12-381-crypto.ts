/**
 * Low-level BLS12-381 curve primitives for the Nozk protocol.
 *
 * Standard BLS scheme: PK in G1, Signature in G2.
 *
 * Uses @noble/curves (pure JS, no WASM, no init step) for all BLS12-381
 * operations. This library is the TypeScript equivalent of Python's
 * `bls12_381_crypto.py`.
 *
 * Hash-to-G2 uses RFC 9380 with DST:
 *   BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_
 *
 * Verified byte-identical to:
 *   - Python py_ecc hash_to_G2
 *   - Python chia_rs AugSchemeMPL.g2_from_message
 *   - Solidity BLS12HashToCurve.hashToCurveG2 (EIP-2537 precompiles)
 */

import { bls12_381 } from '@noble/curves/bls12-381.js';
import { keccak256 } from 'ethereum-cryptography/keccak.js';

// ==============================================================================
// Types
// ==============================================================================

/** G1 point (projective coordinates). */
export type G1Point = typeof bls12_381.G1.Point.BASE;
/** G2 point (projective coordinates). */
export type G2Point = typeof bls12_381.G2.Point.BASE;

// ==============================================================================
// Constants
// ==============================================================================

/** BLS12-381 subgroup order r. */
export const CURVE_ORDER = bls12_381.fields.Fr.ORDER;
/** BLS12-381 base field modulus p. */
export const FIELD_MODULUS = bls12_381.fields.Fp.ORDER;
/** G1 generator. */
export const G1_GEN = bls12_381.G1.Point.BASE;
/** G2 generator. */
export const G2_GEN = bls12_381.G2.Point.BASE;
/** AugSchemeMPL DST for hash-to-G2. */
export const H2C_DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_';


// ==============================================================================
// Hash-to-curve (RFC 9380)
// ==============================================================================

/**
 * Hash arbitrary bytes to a BLS12-381 G2 point per RFC 9380.
 *
 * Uses the AugSchemeMPL DST. Produces byte-identical output to:
 * - Python: `bls12_381_crypto.hash_to_g2(message)`
 * - Solidity: `BLS12HashToCurve.hashToCurveG2(message, DST)`
 */
export function hashToG2(message: Uint8Array): G2Point {
    return bls12_381.G2.hashToCurve(message, { DST: H2C_DST });
}

// ==============================================================================
// Point arithmetic
// ==============================================================================

/** G1 scalar multiplication. */
export function g1ScalarMul(point: G1Point, scalar: bigint): G1Point {
    return point.multiply(scalar);
}

/** G2 scalar multiplication. */
export function g2ScalarMul(point: G2Point, scalar: bigint): G2Point {
    return point.multiply(scalar);
}

/** Modular inverse: k^{-1} mod CURVE_ORDER. */
export function modInverse(k: bigint): bigint {
    return bls12_381.fields.Fr.inv(k);
}

// ==============================================================================
// Serialization — EIP-2537 uncompressed (uint256 tuples for Solidity)
// ==============================================================================

/** Split a field element into (hi, lo) uint256 pair (EIP-2537 64-byte encoding). */
function fpToUint256Pair(val: bigint): [bigint, bigint] {
    const hi = val >> 256n;
    const lo = val & ((1n << 256n) - 1n);
    return [hi, lo];
}

/** Reconstruct a field element from (hi, lo) uint256 pair. */
function uint256PairToFp(hi: bigint, lo: bigint): bigint {
    return (hi << 256n) | lo;
}

/** Serialize a G1 point to 4 uint256 (EIP-2537 uncompressed). */
export function serializeG1Sol(point: G1Point): [bigint, bigint, bigint, bigint] {
    if (point.equals(bls12_381.G1.Point.ZERO)) return [0n, 0n, 0n, 0n];
    const aff = point.toAffine();
    const [xHi, xLo] = fpToUint256Pair(aff.x);
    const [yHi, yLo] = fpToUint256Pair(aff.y);
    return [xHi, xLo, yHi, yLo];
}

/** Reconstruct a G1 point from 4 uint256. */
export function parseG1Sol(xHi: bigint, xLo: bigint, yHi: bigint, yLo: bigint): G1Point {
    const x = uint256PairToFp(xHi, xLo);
    const y = uint256PairToFp(yHi, yLo);
    if (x === 0n && y === 0n) return bls12_381.G1.Point.ZERO;
    return bls12_381.G1.Point.fromAffine({ x, y });
}

/** Serialize a G2 point to 8 uint256 (EIP-2537 uncompressed). */
export function serializeG2Sol(point: G2Point): [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] {
    if (point.equals(bls12_381.G2.Point.ZERO)) return [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
    const aff = point.toAffine();
    // Fp2 = c0 + c1*u
    const [xC0Hi, xC0Lo] = fpToUint256Pair(aff.x.c0);
    const [xC1Hi, xC1Lo] = fpToUint256Pair(aff.x.c1);
    const [yC0Hi, yC0Lo] = fpToUint256Pair(aff.y.c0);
    const [yC1Hi, yC1Lo] = fpToUint256Pair(aff.y.c1);
    return [xC0Hi, xC0Lo, xC1Hi, xC1Lo, yC0Hi, yC0Lo, yC1Hi, yC1Lo];
}

/** Reconstruct a G2 point from 8 uint256. */
export function parseG2Sol(
    xC0Hi: bigint,
    xC0Lo: bigint,
    xC1Hi: bigint,
    xC1Lo: bigint,
    yC0Hi: bigint,
    yC0Lo: bigint,
    yC1Hi: bigint,
    yC1Lo: bigint,
): G2Point {
    const xC0 = uint256PairToFp(xC0Hi, xC0Lo);
    const xC1 = uint256PairToFp(xC1Hi, xC1Lo);
    const yC0 = uint256PairToFp(yC0Hi, yC0Lo);
    const yC1 = uint256PairToFp(yC1Hi, yC1Lo);
    if (xC0 === 0n && xC1 === 0n && yC0 === 0n && yC1 === 0n) return bls12_381.G2.Point.ZERO;
    return bls12_381.G2.Point.fromAffine({
        x: bls12_381.fields.Fp2.create({ c0: xC0, c1: xC1 }),
        y: bls12_381.fields.Fp2.create({ c0: yC0, c1: yC1 }),
    });
}

// ==============================================================================
// ABI encoding (for nullifier ID)
// ==============================================================================

/** ABI-encode a G1 point as 4 uint256 (128 bytes) for nullifier ID. */
export function abiEncodeG1(point: G1Point): Uint8Array {
    const coords = serializeG1Sol(point);
    const buf = new Uint8Array(128);
    for (let i = 0; i < 4; i++) {
        const bytes = bigintToBytes32(coords[i]);
        buf.set(bytes, i * 32);
    }
    return buf;
}

/** Compute nullifier ID: keccak256(abiEncodeG1(spendPub)). */
export function nullifierId(spendPub: G1Point): Uint8Array {
    return keccak256(abiEncodeG1(spendPub));
}

// ==============================================================================
// Pairing verification
// ==============================================================================

/**
 * Verify mint BLS blind signature: e(PK, Y) == e(G1_gen, S)
 *
 * @param sigG2 - Unblinded mint signature (G2)
 * @param msgG2 - Hash-to-curve point Y = H(spendPub) (G2)
 * @param pkG1  - Mint public key (G1)
 */
export function verifyMintPairing(sigG2: G2Point, msgG2: G2Point, pkG1: G1Point): boolean {
    const lhs = bls12_381.pairing(pkG1, msgG2);
    const rhs = bls12_381.pairing(G1_GEN, sigG2);
    return bls12_381.fields.Fp12.eql(lhs, rhs);
}

// ==============================================================================
// Helpers
// ==============================================================================

/** Convert a bigint to a 32-byte big-endian Uint8Array. */
export function bigintToBytes32(n: bigint): Uint8Array {
    const hex = n.toString(16).padStart(64, '0');
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

/** Convert a hex string (with or without 0x) to bigint. */
export function hexToBigint(hex: string): bigint {
    return BigInt(hex.startsWith('0x') ? hex : `0x${hex}`);
}

/** Convert a Uint8Array to hex string (no prefix). */
export function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/** Convert a hex string to Uint8Array. */
export function hexToBytes(hex: string): Uint8Array {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

// ==============================================================================
// G1 Compression
// ==============================================================================

/** Compress a G1 point to 48 bytes (BLS12-381 standard compressed format). */
export function compressG1(point: G1Point): Uint8Array {
    return point.toBytes();
}

// ==============================================================================
// AugSchemeMPL — BLS sign / verify (signatures in G2)
// ==============================================================================

/** Access to longSignatures (PK in G1, Sig in G2) scheme. */
const augScheme = bls12_381.longSignatures;

/**
 * AugSchemeMPL sign: prepend compressed PK to message, hash to G2, then scalar-mul.
 *
 * Matches chia_rs `AugSchemeMPL.sign(sk, msg)`.
 * DST: BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_
 *
 * @param message - Raw message bytes (e.g. 32-byte EIP-712 hash).
 * @param sk - BLS12-381 secret scalar.
 * @returns Compressed G2 signature (96 bytes).
 */
export function blsSign(message: Uint8Array, sk: bigint): Uint8Array {
    const skBytes = bigintToBytes32(sk);
    const pk = augScheme.getPublicKey(skBytes);
    const pkCompressed = pk.toBytes();
    const augMsg = new Uint8Array([...pkCompressed, ...message]);
    const hashPoint = bls12_381.G2.hashToCurve(augMsg, { DST: H2C_DST });
    const sig = augScheme.sign(hashPoint, skBytes);
    return sig.toBytes();
}

/**
 * AugSchemeMPL verify: check that sigma was produced by the holder of pkCompressed.
 *
 * Matches chia_rs `AugSchemeMPL.verify(pk, msg, sigma)`.
 *
 * @param sigma - Compressed G2 signature (96 bytes).
 * @param message - The original message that was signed.
 * @param pkCompressed - Compressed G1 public key (48 bytes).
 * @returns True if the signature is valid.
 */
export function blsVerify(sigma: Uint8Array, message: Uint8Array, pkCompressed: Uint8Array): boolean {
    const pk = bls12_381.G1.Point.fromBytes(pkCompressed);
    const augMsg = new Uint8Array([...pkCompressed, ...message]);
    const hashPoint = bls12_381.G2.hashToCurve(augMsg, { DST: H2C_DST });
    const sigPoint = augScheme.Signature.fromBytes(sigma);
    return augScheme.verify(sigPoint, hashPoint, pk);
}

/**
 * Get the compressed G1 public key for a BLS secret scalar.
 *
 * @param sk - BLS12-381 secret scalar.
 * @returns Compressed G1 public key (48 bytes).
 */
export function blsGetPublicKey(sk: bigint): Uint8Array {
    return augScheme.getPublicKey(bigintToBytes32(sk)).toBytes();
}

// ==============================================================================
// G2 Point aggregation (for batch reveal)
// ==============================================================================

/** Add two G2 points. */
export function g2Add(a: G2Point, b: G2Point): G2Point {
    return a.add(b);
}

/** Aggregate (sum) multiple G2 points. */
export function aggregateG2(points: G2Point[]): G2Point {
    if (points.length === 0) throw new Error('Cannot aggregate empty list');
    let acc = points[0];
    for (let i = 1; i < points.length; i++) {
        acc = acc.add(points[i]);
    }
    return acc;
}

/**
 * Aggregate compressed G2 signatures (for AugSchemeMPL batch redeem).
 *
 * Matches chia_rs `AugSchemeMPL.aggregate(sigs)`.
 *
 * @param sigs - Array of compressed G2 signatures (96 bytes each).
 * @returns Aggregated compressed G2 signature (96 bytes).
 */
export function aggregateSignatures(sigs: Uint8Array[]): Uint8Array {
    if (sigs.length === 0) throw new Error('Cannot aggregate empty list');
    let acc = augScheme.Signature.fromBytes(sigs[0]);
    for (let i = 1; i < sigs.length; i++) {
        acc = acc.add(augScheme.Signature.fromBytes(sigs[i]));
    }
    return acc.toBytes();
}

/**
 * AugSchemeMPL aggregate_verify: verify an aggregated signature against
 * multiple (pk, msg) pairs where all signers signed the same message.
 *
 * @param sigma - Aggregated compressed G2 signature (96 bytes).
 * @param message - The shared message all signers signed.
 * @param pksCompressed - Array of compressed G1 public keys (48 bytes each).
 * @returns True if the aggregate signature is valid.
 */
export function blsAggregateVerify(sigma: Uint8Array, message: Uint8Array, pksCompressed: Uint8Array[]): boolean {
    const sigPoint = augScheme.Signature.fromBytes(sigma);
    const pks = pksCompressed.map((pk) => bls12_381.G1.Point.fromBytes(pk));
    const hashPoints = pksCompressed.map((pkBytes) => {
        const augMsg = new Uint8Array([...pkBytes, ...message]);
        return bls12_381.G2.hashToCurve(augMsg, { DST: H2C_DST });
    });

    // e(pk1, H1) * e(pk2, H2) * ... == e(G1_gen, sigma)
    // noble-curves pairingBatch: [{g1: pk, g2: hash}, ...] vs [{g1: -G1_gen, g2: sigma}]
    const pairs: { g1: G1Point; g2: G2Point }[] = pks.map((pk, i) => ({
        g1: pk,
        g2: hashPoints[i],
    }));
    pairs.push({ g1: G1_GEN.negate(), g2: sigPoint });
    const result = bls12_381.pairingBatch(pairs);
    return bls12_381.fields.Fp12.eql(result, bls12_381.fields.Fp12.ONE);
}
