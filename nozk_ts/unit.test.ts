import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    abiEncodeG1,
    blsGetPublicKey,
    blsSign,
    blsVerify,
    bytesToHex,
    CURVE_ORDER,
    compressG1,
    G1_GEN,
    G2_GEN,
    g1ScalarMul,
    g2ScalarMul,
    hashToG2,
    hexToBigint,
    hexToBytes,
    modInverse,
    nullifierId,
    parseG1Sol,
    parseG2Sol,
    serializeG1Sol,
    serializeG2Sol,
    verifyMintPairing,
} from './bls12-381-crypto.js';
import {
    aggregateRedeemSigma,
    aggregateRevealSigma,
    blindToken,
    DerivationError,
    deriveTokenSecrets,
    eip712DomainSeparator,
    eip712RedemptionHash,
    generateMintKeypair,
    generateRedemptionProof,
    mintBlindSign,
    unblindSignature,
    verifyAggregatedRedeem,
    verifyAggregatedReveal,
    verifyBlsPairing,
    verifyBlsSpendSignature,
} from './nozk-library.js';

// ==============================================================================
// MANIFEST + ALL VECTORS
// ==============================================================================

const VECTORS_DIR = resolve('../test_vectors');
const MANIFEST = JSON.parse(readFileSync(join(VECTORS_DIR, 'manifest.json'), 'utf-8'));

interface VectorFile {
    id: string;
    v: Record<string, any>;
}

function loadAllVectors(): VectorFile[] {
    const results: VectorFile[] = [];
    for (const kpDir of MANIFEST.keypairs as string[]) {
        const dirPath = join(VECTORS_DIR, kpDir);
        for (const file of readdirSync(dirPath)) {
            if (!file.startsWith('token_') || !file.endsWith('.json')) continue;
            const id = `${kpDir}/${file.replace('.json', '')}`;
            const v = JSON.parse(readFileSync(join(dirPath, file), 'utf-8'));
            results.push({ id, v });
        }
    }
    return results;
}

const ALL_VECTORS = loadAllVectors();

// ==============================================================================
// bytesToHex / hexToBytes
// ==============================================================================

describe('bytesToHex / hexToBytes', () => {
    it('converts a known byte array to hex', () => {
        expect(bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe('deadbeef');
    });

    it('handles empty array', () => {
        expect(bytesToHex(new Uint8Array(0))).toBe('');
    });

    it('pads single-digit bytes', () => {
        expect(bytesToHex(new Uint8Array([0x00, 0x01, 0x0f]))).toBe('00010f');
    });

    it('hexToBytes converts known hex to bytes', () => {
        expect(hexToBytes('deadbeef')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    });

    it('hexToBytes strips 0x prefix', () => {
        expect(hexToBytes('0xdeadbeef')).toEqual(hexToBytes('deadbeef'));
    });

    it('hexToBytes returns empty array for empty input', () => {
        expect(hexToBytes('')).toEqual(new Uint8Array(0));
    });

    it('round-trips correctly', () => {
        const original = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);
        expect(hexToBytes(bytesToHex(original))).toEqual(original);
    });
});

// ==============================================================================
// hexToBigint
// ==============================================================================

describe('hexToBigint', () => {
    it('parses 0x-prefixed hex', () => {
        expect(hexToBigint('0xff')).toBe(255n);
    });

    it('parses bare hex', () => {
        expect(hexToBigint('ff')).toBe(255n);
    });

    it('parses large hex values', () => {
        const hex = '0x4306a4d34fb2238bb0772a4ee493bbdfdd196f1f51a19bfc2119cbcc68352561';
        expect(hexToBigint(hex)).toBeGreaterThan(0n);
    });
});

// ==============================================================================
// modInverse
// ==============================================================================

describe('modInverse', () => {
    it('satisfies k * inv(k) % order == 1 for k=7', () => {
        const k = 7n;
        const inv = modInverse(k);
        expect((k * inv) % CURVE_ORDER).toBe(1n);
    });

    it('satisfies k * inv(k) % order == 1 for a large scalar', () => {
        const k = 0x123456789abcdef0123456789abcdef0n;
        const inv = modInverse(k);
        expect((k * inv) % CURVE_ORDER).toBe(1n);
    });

    it('inverse of 1 is 1', () => {
        expect(modInverse(1n)).toBe(1n);
    });
});

// ==============================================================================
// hashToG2
// ==============================================================================

describe('hashToG2', () => {
    it('produces a valid non-zero G2 point', () => {
        const msg = new TextEncoder().encode('test_message');
        const point = hashToG2(msg);
        expect(point.equals(bls12_381_G2_ZERO())).toBe(false);
    });

    it('is deterministic', () => {
        const msg = new TextEncoder().encode('test_message');
        const p1 = hashToG2(msg);
        const p2 = hashToG2(msg);
        expect(p1.equals(p2)).toBe(true);
    });

    it('different inputs yield different points', () => {
        const p1 = hashToG2(new TextEncoder().encode('a'));
        const p2 = hashToG2(new TextEncoder().encode('b'));
        expect(p1.equals(p2)).toBe(false);
    });

    it('matches blindToken Y for the same spend pub', () => {
        const seed = new TextEncoder().encode('h2c_blind_match');
        const secrets = deriveTokenSecrets(seed, 0);
        const directY = hashToG2(abiEncodeG1(secrets.spendBlsPub));
        const { Y } = blindToken(secrets.spendBlsPub, secrets.r);
        expect(directY.equals(Y)).toBe(true);
    });
});

// Helper to get the G2 zero/identity point
function bls12_381_G2_ZERO() {
    return parseG2Sol(0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n);
}

// ==============================================================================
// serializeG1Sol / parseG1Sol roundtrip
// ==============================================================================

describe('serializeG1Sol / parseG1Sol roundtrip', () => {
    it('round-trips the G1 generator', () => {
        const [xHi, xLo, yHi, yLo] = serializeG1Sol(G1_GEN);
        const reconstructed = parseG1Sol(xHi, xLo, yHi, yLo);
        expect(reconstructed.equals(G1_GEN)).toBe(true);
    });

    it('round-trips an arbitrary G1 point', () => {
        const point = g1ScalarMul(G1_GEN, 42n);
        const [xHi, xLo, yHi, yLo] = serializeG1Sol(point);
        const reconstructed = parseG1Sol(xHi, xLo, yHi, yLo);
        expect(reconstructed.equals(point)).toBe(true);
    });

    it('handles the identity (zero) point', () => {
        const zero = parseG1Sol(0n, 0n, 0n, 0n);
        const [xHi, xLo, yHi, yLo] = serializeG1Sol(zero);
        expect(xHi).toBe(0n);
        expect(xLo).toBe(0n);
        expect(yHi).toBe(0n);
        expect(yLo).toBe(0n);
    });
});

// ==============================================================================
// serializeG2Sol / parseG2Sol roundtrip
// ==============================================================================

describe('serializeG2Sol / parseG2Sol roundtrip', () => {
    it('round-trips the G2 generator', () => {
        const coords = serializeG2Sol(G2_GEN);
        const reconstructed = parseG2Sol(...coords);
        expect(reconstructed.equals(G2_GEN)).toBe(true);
    });

    it('round-trips an arbitrary G2 point', () => {
        const point = g2ScalarMul(G2_GEN, 42n);
        const coords = serializeG2Sol(point);
        const reconstructed = parseG2Sol(...coords);
        expect(reconstructed.equals(point)).toBe(true);
    });

    it('round-trips a hash-to-curve G2 point', () => {
        const msg = new TextEncoder().encode('roundtrip_g2_test');
        const point = hashToG2(msg);
        const coords = serializeG2Sol(point);
        const reconstructed = parseG2Sol(...coords);
        expect(reconstructed.equals(point)).toBe(true);
    });

    it('handles the identity (zero) point', () => {
        const zero = parseG2Sol(0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n);
        const coords = serializeG2Sol(zero);
        for (const c of coords) {
            expect(c).toBe(0n);
        }
    });
});

// ==============================================================================
// verifyMintPairing
// ==============================================================================

describe('verifyMintPairing', () => {
    it('valid triple returns true', () => {
        const msg = new TextEncoder().encode('pairing_test');
        const Y = hashToG2(msg);
        const sk = 42n;
        const S = g2ScalarMul(Y, sk);
        const pk = g1ScalarMul(G1_GEN, sk);

        expect(verifyMintPairing(S, Y, pk)).toBe(true);
    });

    it('wrong key returns false', () => {
        const msg = new TextEncoder().encode('pairing_test');
        const Y = hashToG2(msg);
        const S = g2ScalarMul(Y, 42n);
        const wrongPk = g1ScalarMul(G1_GEN, 999n);

        expect(verifyMintPairing(S, Y, wrongPk)).toBe(false);
    });
});

// ==============================================================================
// compressG1 + blsGetPublicKey
// ==============================================================================

describe('compressG1 / blsGetPublicKey', () => {
    it('compressG1 produces 48 bytes', () => {
        const compressed = compressG1(G1_GEN);
        expect(compressed.length).toBe(48);
    });

    it('blsGetPublicKey matches compressG1(sk * G1_gen)', () => {
        const sk = 12345n;
        const point = g1ScalarMul(G1_GEN, sk);
        const fromPoint = compressG1(point);
        const fromApi = blsGetPublicKey(sk);
        expect(bytesToHex(fromApi)).toBe(bytesToHex(fromPoint));
    });
});

// ==============================================================================
// blsSign / blsVerify
// ==============================================================================

describe('blsSign / blsVerify', () => {
    it('sign + verify round-trip', () => {
        const sk = 42n;
        const msg = new TextEncoder().encode('hello');
        const sigma = blsSign(msg, sk);
        const pk = blsGetPublicKey(sk);
        expect(sigma.length).toBe(96);
        expect(blsVerify(sigma, msg, pk)).toBe(true);
    });

    it('wrong key fails verify', () => {
        const sk = 42n;
        const msg = new TextEncoder().encode('hello');
        const sigma = blsSign(msg, sk);
        const wrongPk = blsGetPublicKey(43n);
        expect(blsVerify(sigma, msg, wrongPk)).toBe(false);
    });

    it('wrong message fails verify', () => {
        const sk = 42n;
        const msg = new TextEncoder().encode('hello');
        const sigma = blsSign(msg, sk);
        const pk = blsGetPublicKey(sk);
        const wrongMsg = new TextEncoder().encode('world');
        expect(blsVerify(sigma, wrongMsg, pk)).toBe(false);
    });
});

// ==============================================================================
// nullifierId — parametrized over ALL vectors
// ==============================================================================

describe.each(ALL_VECTORS.map(({ id, v }) => ({ id, v })))('nullifierId [$id]', ({ v }) => {
    it('matches vector nullifier_id', () => {
        const pubG1 = parseG1Sol(
            hexToBigint(v.SPEND_BLS.pub_G1.x_hi),
            hexToBigint(v.SPEND_BLS.pub_G1.x_lo),
            hexToBigint(v.SPEND_BLS.pub_G1.y_hi),
            hexToBigint(v.SPEND_BLS.pub_G1.y_lo),
        );
        const nid = bytesToHex(nullifierId(pubG1));
        expect(nid).toBe(v.SPEND_BLS.nullifier_id);
    });
});

// ==============================================================================
// generateMintKeypair
// ==============================================================================

describe('generateMintKeypair', () => {
    it('returns scalar in valid range', () => {
        const kp = generateMintKeypair();
        expect(kp.skMint).toBeGreaterThan(0n);
        expect(kp.skMint).toBeLessThan(CURVE_ORDER);
    });

    it('produces unique keypairs', () => {
        const kp1 = generateMintKeypair();
        const kp2 = generateMintKeypair();
        expect(kp1.skMint).not.toBe(kp2.skMint);
    });

    it('pkMint is on the G1 curve and non-zero', () => {
        const kp = generateMintKeypair();
        const coords = serializeG1Sol(kp.pkMint);
        const reconstructed = parseG1Sol(...coords);
        expect(reconstructed.equals(kp.pkMint)).toBe(true);
        expect(coords.some((c) => c !== 0n)).toBe(true);
    });
});

// ==============================================================================
// EIP-712 helpers — manifest params + parametrized over ALL vectors
// ==============================================================================

describe('EIP-712 helpers', () => {
    it('eip712DomainSeparator is deterministic', () => {
        const a = eip712DomainSeparator(MANIFEST.chain_id, MANIFEST.contract_address);
        const b = eip712DomainSeparator(MANIFEST.chain_id, MANIFEST.contract_address);
        expect(bytesToHex(a)).toBe(bytesToHex(b));
    });

    it('eip712DomainSeparator changes with chain_id', () => {
        const a = eip712DomainSeparator(1, MANIFEST.contract_address);
        const b = eip712DomainSeparator(11155111, MANIFEST.contract_address);
        expect(bytesToHex(a)).not.toBe(bytesToHex(b));
    });

    it('eip712RedemptionHash changes with different recipient', () => {
        const deadline = BigInt(MANIFEST.deadline);
        const chainId = MANIFEST.chain_id;
        const contract = MANIFEST.contract_address;
        const h1 = eip712RedemptionHash('0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa', deadline, chainId, contract);
        const h2 = eip712RedemptionHash('0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB', deadline, chainId, contract);
        expect(bytesToHex(h1)).not.toBe(bytesToHex(h2));
    });
});

describe.each(ALL_VECTORS.map(({ id, v }) => ({ id, v })))('EIP-712 parity [$id]', ({ v }) => {
    it('eip712RedemptionHash matches vector msg_hash', () => {
        const hash = eip712RedemptionHash(
            v.REDEEM_TX.recipient,
            BigInt(v.EIP712.deadline),
            v.EIP712.chain_id,
            v.EIP712.contract_address,
        );
        expect(bytesToHex(hash)).toBe(v.REDEEM_TX.msg_hash);
    });
});

// ==============================================================================
// G1 serialization from vectors — parametrized
// ==============================================================================

describe.each(ALL_VECTORS.map(({ id, v }) => ({ id, v })))('G1 serialization [$id]', ({ v }) => {
    it('parseG1Sol round-trips through serializeG1Sol for PK_MINT', () => {
        const pk = parseG1Sol(
            hexToBigint(v.PK_MINT.x_hi),
            hexToBigint(v.PK_MINT.x_lo),
            hexToBigint(v.PK_MINT.y_hi),
            hexToBigint(v.PK_MINT.y_lo),
        );
        const [xHi, xLo, yHi, yLo] = serializeG1Sol(pk);
        expect(xHi).toBe(hexToBigint(v.PK_MINT.x_hi));
        expect(xLo).toBe(hexToBigint(v.PK_MINT.x_lo));
        expect(yHi).toBe(hexToBigint(v.PK_MINT.y_hi));
        expect(yLo).toBe(hexToBigint(v.PK_MINT.y_lo));
    });

    it('serializeG1Sol returns valid bigints for spend_pub_G1', () => {
        const pub = parseG1Sol(
            hexToBigint(v.SPEND_BLS.pub_G1.x_hi),
            hexToBigint(v.SPEND_BLS.pub_G1.x_lo),
            hexToBigint(v.SPEND_BLS.pub_G1.y_hi),
            hexToBigint(v.SPEND_BLS.pub_G1.y_lo),
        );
        const [xHi, xLo, yHi, yLo] = serializeG1Sol(pub);
        expect(xHi).toBeGreaterThanOrEqual(0n);
        expect(xLo).toBeGreaterThan(0n);
        expect(yHi).toBeGreaterThanOrEqual(0n);
        expect(yLo).toBeGreaterThan(0n);
    });
});

// ==============================================================================
// G2 serialization from vectors — parametrized
// ==============================================================================

describe.each(ALL_VECTORS.map(({ id, v }) => ({ id, v })))('G2 serialization [$id]', ({ v }) => {
    it('parseG2Sol round-trips through serializeG2Sol for Y_HASH_TO_CURVE', () => {
        const y = v.Y_HASH_TO_CURVE;
        const point = parseG2Sol(
            hexToBigint(y.x_c0_hi),
            hexToBigint(y.x_c0_lo),
            hexToBigint(y.x_c1_hi),
            hexToBigint(y.x_c1_lo),
            hexToBigint(y.y_c0_hi),
            hexToBigint(y.y_c0_lo),
            hexToBigint(y.y_c1_hi),
            hexToBigint(y.y_c1_lo),
        );
        const coords = serializeG2Sol(point);
        expect(coords[0]).toBe(hexToBigint(y.x_c0_hi));
        expect(coords[1]).toBe(hexToBigint(y.x_c0_lo));
        expect(coords[2]).toBe(hexToBigint(y.x_c1_hi));
        expect(coords[3]).toBe(hexToBigint(y.x_c1_lo));
        expect(coords[4]).toBe(hexToBigint(y.y_c0_hi));
        expect(coords[5]).toBe(hexToBigint(y.y_c0_lo));
        expect(coords[6]).toBe(hexToBigint(y.y_c1_hi));
        expect(coords[7]).toBe(hexToBigint(y.y_c1_lo));
    });
});

// ==============================================================================
// deriveTokenSecrets validation
// ==============================================================================

describe('deriveTokenSecrets validation', () => {
    it('rejects negative index', () => {
        expect(() => deriveTokenSecrets(new Uint8Array(32), -1)).toThrow(DerivationError);
    });

    it('rejects oversized index', () => {
        expect(() => deriveTokenSecrets(new Uint8Array(32), 0x1_0000_0000)).toThrow(DerivationError);
    });

    it('rejects non-integer index', () => {
        expect(() => deriveTokenSecrets(new Uint8Array(32), 1.5)).toThrow(DerivationError);
    });
});

// ==============================================================================
// Full protocol lifecycle (standalone, no vectors)
// ==============================================================================

describe('standalone protocol lifecycle', () => {
    it('blindToken + mintBlindSign + unblindSignature verifies BLS pairing', () => {
        const seed = new TextEncoder().encode('lifecycle_unit_test_seed');
        const secrets = deriveTokenSecrets(seed, 0);

        const { Y, B } = blindToken(secrets.spendBlsPub, secrets.r);

        const kp = generateMintKeypair();
        const S_prime = mintBlindSign(B, kp.skMint);
        const S = unblindSignature(S_prime, secrets.r);

        expect(verifyBlsPairing(S, Y, kp.pkMint)).toBe(true);
    });

    it('BLS pairing fails with wrong mint key', () => {
        const seed = new TextEncoder().encode('wrong_key_test');
        const secrets = deriveTokenSecrets(seed, 0);

        const { Y, B } = blindToken(secrets.spendBlsPub, secrets.r);

        const kpReal = generateMintKeypair();
        const kpWrong = generateMintKeypair();
        const S_prime = mintBlindSign(B, kpReal.skMint);
        const S = unblindSignature(S_prime, secrets.r);

        expect(verifyBlsPairing(S, Y, kpWrong.pkMint)).toBe(false);
    });

    it('generateRedemptionProof + verifyBlsSpendSignature round-trip', () => {
        const seed = new TextEncoder().encode('bls_spend_lifecycle_test');
        const secrets = deriveTokenSecrets(seed, 0);
        const recipient = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';

        const proof = generateRedemptionProof(
            secrets.spendBlsPriv,
            secrets.spendPubCompressed,
            recipient,
            MANIFEST.chain_id,
            MANIFEST.contract_address,
            BigInt(MANIFEST.deadline),
        );

        expect(verifyBlsSpendSignature(proof)).toBe(true);
    });

    it('BLS spend signature fails with wrong key', () => {
        const seed = new TextEncoder().encode('wrong_spend_key_test');
        const secrets = deriveTokenSecrets(seed, 0);
        const wrongSecrets = deriveTokenSecrets(seed, 1);

        const proof = generateRedemptionProof(
            secrets.spendBlsPriv,
            secrets.spendPubCompressed,
            '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa',
            MANIFEST.chain_id,
            MANIFEST.contract_address,
            BigInt(MANIFEST.deadline),
        );

        // Tamper with the public key
        const badProof = { ...proof, spendPubCompressed: wrongSecrets.spendPubCompressed };
        expect(verifyBlsSpendSignature(badProof)).toBe(false);
    });

    it('aggregateRevealSigma + verifyAggregatedReveal', () => {
        const seed = new TextEncoder().encode('aggregation_test');
        const kp = generateMintKeypair();

        const secrets0 = deriveTokenSecrets(seed, 0);
        const secrets1 = deriveTokenSecrets(seed, 1);

        const { Y: Y0, B: B0 } = blindToken(secrets0.spendBlsPub, secrets0.r);
        const { Y: Y1, B: B1 } = blindToken(secrets1.spendBlsPub, secrets1.r);

        const S0 = unblindSignature(mintBlindSign(B0, kp.skMint), secrets0.r);
        const S1 = unblindSignature(mintBlindSign(B1, kp.skMint), secrets1.r);

        // Individual verify
        expect(verifyBlsPairing(S0, Y0, kp.pkMint)).toBe(true);
        expect(verifyBlsPairing(S1, Y1, kp.pkMint)).toBe(true);

        // Aggregate verify
        const sigmaAgg = aggregateRevealSigma([S0, S1]);
        expect(verifyAggregatedReveal(sigmaAgg, [secrets0.spendBlsPub, secrets1.spendBlsPub], kp.pkMint)).toBe(true);
    });

    it('BLS spend signature rejects tampered destination', () => {
        const seed = new TextEncoder().encode('tamper_dest_test');
        const secrets = deriveTokenSecrets(seed, 0);
        const alice = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
        const bob = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB';

        const proof = generateRedemptionProof(
            secrets.spendBlsPriv,
            secrets.spendPubCompressed,
            alice,
            MANIFEST.chain_id,
            MANIFEST.contract_address,
            BigInt(MANIFEST.deadline),
        );

        // Verify with original destination succeeds
        expect(verifyBlsSpendSignature(proof)).toBe(true);

        // Verify sigma against Bob's hash should fail
        const bobHash = eip712RedemptionHash(
            bob,
            BigInt(MANIFEST.deadline),
            MANIFEST.chain_id,
            MANIFEST.contract_address,
        );
        expect(blsVerify(proof.sigma, bobHash, proof.spendPubCompressed)).toBe(false);
    });

    it('BLS mint pairing rejects wrong token', () => {
        const seed = new TextEncoder().encode('wrong_token_test');
        const secretsA = deriveTokenSecrets(seed, 0);
        const secretsB = deriveTokenSecrets(seed, 1);
        const kp = generateMintKeypair();

        // Sign token A
        const { Y: yA, B: bA } = blindToken(secretsA.spendBlsPub, secretsA.r);
        const S = unblindSignature(mintBlindSign(bA, kp.skMint), secretsA.r);

        // Verify with token A's Y: should pass
        expect(verifyBlsPairing(S, yA, kp.pkMint)).toBe(true);

        // Verify with token B's Y: should fail
        const { Y: yB } = blindToken(secretsB.spendBlsPub, secretsB.r);
        expect(verifyBlsPairing(S, yB, kp.pkMint)).toBe(false);
    });

    it('aggregated reveal rejects extra nullifier', () => {
        const seed = new TextEncoder().encode('agg_extra_null_test');
        const kp = generateMintKeypair();

        const s0 = deriveTokenSecrets(seed, 0);
        const s1 = deriveTokenSecrets(seed, 1);
        const s2 = deriveTokenSecrets(seed, 2); // extra, not signed

        const S0 = unblindSignature(mintBlindSign(blindToken(s0.spendBlsPub, s0.r).B, kp.skMint), s0.r);
        const S1 = unblindSignature(mintBlindSign(blindToken(s1.spendBlsPub, s1.r).B, kp.skMint), s1.r);

        const sigmaAgg = aggregateRevealSigma([S0, S1]);
        // Verify with 3 spend pubs (includes unsigned s2) — should fail
        expect(verifyAggregatedReveal(sigmaAgg, [s0.spendBlsPub, s1.spendBlsPub, s2.spendBlsPub], kp.pkMint)).toBe(
            false,
        );
    });

    it('aggregated reveal rejects wrong mint key', () => {
        const seed = new TextEncoder().encode('agg_wrong_mint_test');
        const kpReal = generateMintKeypair();
        const kpWrong = generateMintKeypair();

        const s0 = deriveTokenSecrets(seed, 0);
        const s1 = deriveTokenSecrets(seed, 1);

        const S0 = unblindSignature(mintBlindSign(blindToken(s0.spendBlsPub, s0.r).B, kpReal.skMint), s0.r);
        const S1 = unblindSignature(mintBlindSign(blindToken(s1.spendBlsPub, s1.r).B, kpReal.skMint), s1.r);

        const sigmaAgg = aggregateRevealSigma([S0, S1]);
        expect(verifyAggregatedReveal(sigmaAgg, [s0.spendBlsPub, s1.spendBlsPub], kpWrong.pkMint)).toBe(false);
    });

    it('aggregated redeem 3 tokens succeeds', () => {
        const seed = new TextEncoder().encode('agg_redeem_3_test');
        const recipient = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
        const deadline = BigInt(MANIFEST.deadline);

        const sigs: Uint8Array[] = [];
        const pks: Uint8Array[] = [];
        for (let i = 0; i < 3; i++) {
            const secrets = deriveTokenSecrets(seed, i);
            const proof = generateRedemptionProof(
                secrets.spendBlsPriv,
                secrets.spendPubCompressed,
                recipient,
                MANIFEST.chain_id,
                MANIFEST.contract_address,
                deadline,
            );
            sigs.push(proof.sigma);
            pks.push(secrets.spendPubCompressed);
        }

        const aggSigma = aggregateRedeemSigma(sigs);
        const msgHash = eip712RedemptionHash(recipient, deadline, MANIFEST.chain_id, MANIFEST.contract_address);
        expect(verifyAggregatedRedeem(aggSigma, msgHash, pks)).toBe(true);
    });

    it('aggregated redeem rejects wrong message', () => {
        const seed = new TextEncoder().encode('agg_redeem_wrong_msg');
        const alice = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
        const bob = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB';
        const deadline = BigInt(MANIFEST.deadline);

        const sigs: Uint8Array[] = [];
        const pks: Uint8Array[] = [];
        for (let i = 0; i < 2; i++) {
            const secrets = deriveTokenSecrets(seed, i);
            const proof = generateRedemptionProof(
                secrets.spendBlsPriv,
                secrets.spendPubCompressed,
                alice,
                MANIFEST.chain_id,
                MANIFEST.contract_address,
                deadline,
            );
            sigs.push(proof.sigma);
            pks.push(secrets.spendPubCompressed);
        }

        const aggSigma = aggregateRedeemSigma(sigs);
        // Verify against Bob's hash — should fail
        const wrongHash = eip712RedemptionHash(bob, deadline, MANIFEST.chain_id, MANIFEST.contract_address);
        expect(verifyAggregatedRedeem(aggSigma, wrongHash, pks)).toBe(false);
    });

    it('aggregated redeem rejects extra key', () => {
        const seed = new TextEncoder().encode('agg_redeem_extra_key');
        const recipient = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
        const deadline = BigInt(MANIFEST.deadline);

        const sigs: Uint8Array[] = [];
        const pks: Uint8Array[] = [];
        for (let i = 0; i < 2; i++) {
            const secrets = deriveTokenSecrets(seed, i);
            const proof = generateRedemptionProof(
                secrets.spendBlsPriv,
                secrets.spendPubCompressed,
                recipient,
                MANIFEST.chain_id,
                MANIFEST.contract_address,
                deadline,
            );
            sigs.push(proof.sigma);
            pks.push(secrets.spendPubCompressed);
        }

        // Add a third key that didn't sign
        const extra = deriveTokenSecrets(seed, 99);
        pks.push(extra.spendPubCompressed);

        const aggSigma = aggregateRedeemSigma(sigs);
        const msgHash = eip712RedemptionHash(recipient, deadline, MANIFEST.chain_id, MANIFEST.contract_address);
        expect(verifyAggregatedRedeem(aggSigma, msgHash, pks)).toBe(false);
    });
});

// ==============================================================================
// deriveTokenSecrets isolation
// ==============================================================================

describe('deriveTokenSecrets isolation', () => {
    it('different indices yield different secrets', () => {
        const seed = new TextEncoder().encode('isolation_test_seed');
        const s0 = deriveTokenSecrets(seed, 0);
        const s1 = deriveTokenSecrets(seed, 1);
        expect(bytesToHex(s0.nullifierIdBytes)).not.toBe(bytesToHex(s1.nullifierIdBytes));
        expect(s0.depositId).not.toBe(s1.depositId);
        expect(s0.r).not.toBe(s1.r);
    });

    it('different seeds yield different secrets', () => {
        const seedA = new TextEncoder().encode('seed_a');
        const seedB = new TextEncoder().encode('seed_b');
        const sA = deriveTokenSecrets(seedA, 0);
        const sB = deriveTokenSecrets(seedB, 0);
        expect(bytesToHex(sA.nullifierIdBytes)).not.toBe(bytesToHex(sB.nullifierIdBytes));
        expect(sA.depositId).not.toBe(sB.depositId);
    });

    it('index boundary 256 differs from 0', () => {
        const seed = new TextEncoder().encode('boundary_test_seed');
        const s0 = deriveTokenSecrets(seed, 0);
        const s256 = deriveTokenSecrets(seed, 256);
        expect(bytesToHex(s0.nullifierIdBytes)).not.toBe(bytesToHex(s256.nullifierIdBytes));
        expect(s0.depositId).not.toBe(s256.depositId);
        expect(s0.r).not.toBe(s256.r);
    });
});
