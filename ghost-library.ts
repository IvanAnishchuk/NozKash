import { keccak256 } from 'ethereum-cryptography/keccak.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import mcl from 'mcl-wasm';
import {
    hashToCurveBN254, multiplyBN254,
    modularInverse, verifyPairingBN254, CURVE_ORDER,
} from './bn254-crypto.js';

// ==============================================================================
// ERROR HIERARCHY
// ==============================================================================

export class GhostError extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}

export class DerivationError extends GhostError {}

export class VerificationError extends GhostError {}


// ==============================================================================
// TYPES
// ==============================================================================

/**
 * A secp256k1 keypair derived deterministically from the master seed.
 *
 * Both token keypairs (spend and blind) share this structure:
 *   spend keypair → address is the nullifier (revealed at redemption)
 *   blind keypair → address is the deposit ID (revealed at deposit)
 */
export interface TokenKeypair {
    priv:         Uint8Array;   // 32-byte private key
    pubHex:       string;       // 0x-prefixed uncompressed public key (65 bytes, starts with 04)
    address:      string;       // 0x-prefixed Ethereum address (20 bytes)
    addressBytes: Uint8Array;   // raw 20 bytes
}

export interface TokenSecrets {
    spend: TokenKeypair;
    blind: TokenKeypair;
}

export interface BlindedPoints {
    Y: mcl.G1;   // H(spend_address) — unblinded hash-to-curve
    B: mcl.G1;   // r·Y             — blinded point sent to mint
}

export interface MintKeypair {
    skMint: bigint;
    pkMint: mcl.G2;
}

export interface RedemptionProof {
    msgHash:            Uint8Array;
    signatureObj:       Uint8Array;   // raw 64-byte compact r||s
    compactHex:         string;       // 128-char hex of signatureObj
    recoveryBit:        0 | 1;        // v = recoveryBit + 27 in the 65-byte spend signature
    pubKeyUncompressed: Uint8Array;   // 65-byte uncompressed secp256k1 pubkey
}

// ==============================================================================
// HELPERS
// ==============================================================================

/** Derives the Ethereum address from a 65-byte uncompressed public key. */
function pubKeyToAddress(pubKeyUncompressed: Uint8Array): string {
    return '0x' + Buffer.from(
        keccak256(pubKeyUncompressed.slice(1)).slice(-20)
    ).toString('hex');
}

/**
 * Derives a secp256k1 TokenKeypair from a domain label and base material.
 * Domain labels: "spend", "blind"  (mirrors Python's b"spend" / b"blind").
 */
function deriveKeypair(domain: string, baseMaterial: Uint8Array): TokenKeypair {
    const priv            = keccak256(new Uint8Array([...Buffer.from(domain), ...baseMaterial]));
    const pubUncompressed = secp256k1.getPublicKey(priv, false);  // 65 bytes, includes 0x04 prefix
    const pubHex          = '0x' + Buffer.from(pubUncompressed).toString('hex');
    const address         = pubKeyToAddress(pubUncompressed);
    const addressBytes    = Buffer.from(address.slice(2), 'hex');

    return { priv, pubHex, address, addressBytes };
}

/**
 * Derives the BLS blinding scalar r from the blind keypair's private key.
 * Mirrors Python: Scalar(int.from_bytes(blind.priv.to_bytes(), "big") % curve_order)
 */
function toBlsScalar(priv: Uint8Array): bigint {
    return BigInt('0x' + Buffer.from(priv).toString('hex')) % CURVE_ORDER;
}

// ==============================================================================
// 1. CORE CRYPTOGRAPHY UTILS
// ==============================================================================

export function hashToCurve(messageBytes: Uint8Array): mcl.G1 {
    return hashToCurveBN254(messageBytes);
}

export function generateMintKeypair(): MintKeypair {
    const skBytes = secp256k1.utils.randomPrivateKey();
    const skMint  = BigInt('0x' + Buffer.from(skBytes).toString('hex')) % CURVE_ORDER;

    const generatorG2 = mcl.hashAndMapToG2('GhostTipG2Generator');
    const skFr = new mcl.Fr();
    skFr.setStr(skMint.toString(10), 10);

    const pkMint = mcl.mul(generatorG2, skFr) as mcl.G2;
    return { skMint, pkMint };
}

// ==============================================================================
// 2. CLIENT OPERATIONS (User Wallet)
// ==============================================================================

/**
 * Deterministically derives both token keypairs for a given index.
 *
 *   spend keypair: address = nullifier (revealed only at redemption)
 *   blind keypair: address = deposit ID (submitted with deposit tx)
 *                  priv as BN254 scalar = blinding factor r
 *
 * Mirrors Python's derive_token_secrets().
 *
 * Throws DerivationError for invalid inputs.
 */
export function deriveTokenSecrets(masterSeed: Uint8Array, tokenIndex: number): TokenSecrets {
    if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 0xFFFFFFFF) {
        throw new DerivationError(
            `tokenIndex must be a non-negative 32-bit integer, got ${tokenIndex}`
        );
    }

    // DataView ensures correct 32-bit big-endian encoding — Uint8Array constructor
    // would silently truncate indices >= 256, breaking parity with Python.
    const indexBuf = new ArrayBuffer(4);
    new DataView(indexBuf).setUint32(0, tokenIndex, false);
    const baseMaterial = keccak256(
        new Uint8Array([...masterSeed, ...new Uint8Array(indexBuf)])
    );

    return {
        spend: deriveKeypair('spend', baseMaterial),
        blind: deriveKeypair('blind', baseMaterial),
    };
}

/** Convenience accessors matching the Python compat properties on TokenSecrets. */
export function getSpendPriv(secrets: TokenSecrets): Uint8Array    { return secrets.spend.priv; }
export function getSpendAddress(secrets: TokenSecrets): string      { return secrets.spend.address; }
export function getSpendAddressBytes(secrets: TokenSecrets): Uint8Array { return secrets.spend.addressBytes; }
export function getDepositId(secrets: TokenSecrets): string         { return secrets.blind.address; }
export function getR(secrets: TokenSecrets): bigint                 { return toBlsScalar(secrets.blind.priv); }

export function blindToken(spendAddressBytes: Uint8Array, r: bigint): BlindedPoints {
    const Y = hashToCurve(spendAddressBytes);
    const B = multiplyBN254(Y, r);
    return { Y, B };
}

export function unblindSignature(S_prime: mcl.G1, r: bigint): mcl.G1 {
    const r_inv = modularInverse(r, CURVE_ORDER);
    return multiplyBN254(S_prime, r_inv);
}

// ==============================================================================
// 3. MINT OPERATIONS
// ==============================================================================

/** Returns S' = sk·B. Mirrors Python's mint_blind_sign(). */
export function mintBlindSign(B: mcl.G1, skMint: bigint): mcl.G1 {
    return multiplyBN254(B, skMint);
}

// ==============================================================================
// 4. REDEMPTION PROOF
// ==============================================================================

/**
 * Generates the anti-MEV ECDSA signature binding the token to a destination.
 * Mirrors Python's generate_redemption_proof().
 */
export async function generateRedemptionProof(
    spendPriv: Uint8Array,
    destinationAddress: string,
): Promise<RedemptionProof> {
    const payloadStr = `Pay to: ${destinationAddress}`;
    const msgHash    = keccak256(Buffer.from(payloadStr, 'utf-8'));

    const pubKeyUncompressed = secp256k1.getPublicKey(spendPriv, false);  // 65 bytes with 0x04
    const expectedAddress    = pubKeyToAddress(pubKeyUncompressed);

    // @noble/curves sign() returns a Signature object with .r, .s, .recovery
    const sig: any = secp256k1.sign(msgHash, spendPriv, { lowS: true, prehash: false });

    let signatureObj: Uint8Array;
    let recoveryBit: 0 | 1;

    // ── Diagnostic block: inspect what sign() actually returned ──────────
    const sigProto    = Object.getPrototypeOf(sig);
    const sigProtoKeys = sigProto ? Object.getOwnPropertyNames(sigProto) : [];
    const sigOwnKeys   = Object.getOwnPropertyNames(sig);
    console.log('\n=== generateRedemptionProof DIAGNOSTICS ===');
    console.log('[sig] typeof:              ', typeof sig);
    console.log('[sig] constructor.name:    ', sig?.constructor?.name);
    console.log('[sig] instanceof Uint8Array:', sig instanceof Uint8Array);
    console.log('[sig] own keys:            ', JSON.stringify(sigOwnKeys.filter(k => !/^\d+$/.test(k))));
    console.log('[sig] proto keys:          ', JSON.stringify(sigProtoKeys));
    console.log('[sig] .recovery:           ', sig.recovery, '(typeof:', typeof sig.recovery + ')');
    console.log('[sig] .r:                  ', sig.r, '(typeof:', typeof sig.r + ')');
    console.log('[sig] .s:                  ', sig.s, '(typeof:', typeof sig.s + ')');
    console.log('[sig] .toCompactRawBytes?: ', typeof sig.toCompactRawBytes);
    console.log('[sig] .toCompactHex?:      ', typeof sig.toCompactHex);
    console.log('[sig] .addRecoveryBit?:    ', typeof sig.addRecoveryBit);
    console.log('[sig] .recoverPublicKey?:  ', typeof sig.recoverPublicKey);
    console.log('[sig] length:              ', sig.length);

    // Check what secp256k1 module-level APIs are available for recovery
    console.log('[secp256k1] .sign:                ', typeof secp256k1.sign);
    console.log('[secp256k1] .verify:              ', typeof secp256k1.verify);
    console.log('[secp256k1] .recoverPublicKey:    ', typeof (secp256k1 as any).recoverPublicKey);
    console.log('[secp256k1] .Signature:           ', typeof (secp256k1 as any).Signature);
    console.log('[secp256k1] .Signature?.fromCompact:', typeof (secp256k1 as any).Signature?.fromCompact);

    // Try calling toCompactRawBytes if it exists
    if (typeof sig.toCompactRawBytes === 'function') {
        const compact = sig.toCompactRawBytes();
        console.log('[sig] toCompactRawBytes() length:', compact.length);
        console.log('[sig] toCompactRawBytes() hex:   ', Buffer.from(compact).toString('hex'));
    }

    // ── End diagnostic block ─────────────────────────────────────────────

    if (typeof sig.recovery === 'number' && typeof sig.r === 'bigint') {
        // @noble/curves Signature object with recovery info
        console.log('[path] Using sig.r / sig.s / sig.recovery directly');
        const rHex = (sig.r as bigint).toString(16).padStart(64, '0');
        const sHex = (sig.s as bigint).toString(16).padStart(64, '0');
        signatureObj = Buffer.from(rHex + sHex, 'hex');
        recoveryBit  = sig.recovery as 0 | 1;
    } else if (typeof sig.toCompactRawBytes === 'function' && typeof sig.recovery === 'number') {
        // Signature object that has toCompactRawBytes + recovery but no .r/.s as bigints
        console.log('[path] Using sig.toCompactRawBytes() + sig.recovery');
        signatureObj = sig.toCompactRawBytes();
        recoveryBit  = sig.recovery as 0 | 1;
    } else {
        // Raw 64-byte compact sig with no recovery — must do trial recovery
        console.log('[path] Falling back to trial recovery');
        signatureObj = (sig as Uint8Array).slice(0, 64);

        // ── Trial recovery: try both bits, see which recovers the expected address ──
        const sigHex = Buffer.from(signatureObj).toString('hex');
        console.log('[trial] expectedAddress:', expectedAddress);

        let foundBit: 0 | 1 | null = null;
        for (const bit of [0, 1] as const) {
            try {
                const recovered = secp256k1.recoverPublicKey(msgHash, signatureObj, bit);
                const recoveredAddr = pubKeyToAddress(recovered);
                console.log(`[trial] bit=${bit} → recoveredAddr: ${recoveredAddr}`);
                if (recoveredAddr.toLowerCase() === expectedAddress.toLowerCase()) {
                    foundBit = bit;
                    console.log(`[trial] bit=${bit} MATCHES expected address`);
                    break;
                } else {
                    console.log(`[trial] bit=${bit} does NOT match`);
                }
            } catch (err: any) {
                console.log(`[trial] bit=${bit} threw: ${err.message}`);
            }
        }

        if (foundBit === null) {
            // Last resort: try the old y-parity heuristic
            console.log('[trial] Neither bit matched! Falling back to y-parity heuristic');
            recoveryBit = deriveRecoveryBitByYParity(signatureObj);
            console.log(`[trial] y-parity heuristic → ${recoveryBit}`);
        } else {
            recoveryBit = foundBit;
        }
    }

    const compactHex = Buffer.from(signatureObj).toString('hex');
    console.log('[result] recoveryBit:', recoveryBit);
    console.log('[result] compactHex: ', compactHex);
    console.log('=== END DIAGNOSTICS ===\n');
    return { msgHash, signatureObj, compactHex, recoveryBit, pubKeyUncompressed };
}

/**
 * DEPRECATED: y-parity heuristic. This does NOT correctly determine the recovery bit.
 * The recovery bit is NOT simply the y-parity of the R point — it depends on which
 * of the two candidate public keys matches the actual signer. Kept only as a
 * last-resort fallback for logging/diagnosis.
 */
function deriveRecoveryBitByYParity(
    signatureObj: Uint8Array,
): 0 | 1 {
    const p = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
    const r = BigInt('0x' + Buffer.from(signatureObj.slice(0, 32)).toString('hex'));
    const y_squared = (r * r % p * r % p + 7n) % p;
    const y = modPow(y_squared, (p + 1n) / 4n, p);
    return (y % 2n === 0n ? 0 : 1) as 0 | 1;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    let result = 1n;
    base = base % mod;
    while (exp > 0n) {
        if (exp % 2n === 1n) result = result * base % mod;
        exp = exp / 2n;
        base = base * base % mod;
    }
    return result;
}

// ==============================================================================
// 5. VERIFICATION
// ==============================================================================

export function verifyBlsPairing(S: mcl.G1, Y: mcl.G1, pkMint: mcl.G2): boolean {
    return verifyPairingBN254(S, Y, pkMint);
}

/**
 * Simulates EVM ecrecover — derives the signer address from the proof's
 * stored public key to verify the signature, then checks the address matches.
 *
 * Throws VerificationError for structurally invalid input (wrong hex length).
 * Returns false for cryptographically invalid signatures.
 * Mirrors Python's verify_ecdsa_mev_protection().
 */
export function verifyEcdsaMevProtection(
    proof: RedemptionProof,
    expectedAddressHex: string,
): boolean {
    if (proof.compactHex.length !== 128) {
        throw new VerificationError(
            `compactHex must be 128 hex chars (64 bytes), got ${proof.compactHex.length}`
        );
    }

    try {
        // Mirrors Python verify_ecdsa_mev_protection and the contract's ecrecover check:
        //   1. Verify signature validity against the known spend public key
        //   2. Confirm that public key hashes to the expected nullifier address
        // Both must pass — same as ecrecover returning expectedAddressHex.
        if (!secp256k1.verify(proof.signatureObj, proof.msgHash, proof.pubKeyUncompressed)) {
            return false;
        }
        return pubKeyToAddress(proof.pubKeyUncompressed).toLowerCase() === expectedAddressHex.toLowerCase();
    } catch {
        return false;
    }
}

