import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    bytesToHex,
    G1_GEN,
    g1ScalarMul,
    hexToBigint,
    parseG1Sol,
    parseG2Sol,
    serializeG2Sol,
} from './bls12-381-crypto.js';
import * as gl from './nozk-library.js';

// ==============================================================================
// VECTOR DISCOVERY
// Loads all token_*.json files from test_vectors/<keypair_dir>/.
// If test_vectors/ is empty, collects zero tests — run generate_vectors.py first.
// ==============================================================================

interface VectorFile {
    id: string;
    v: Record<string, any>;
}

function loadAllVectors(): VectorFile[] {
    const vectorsDir = resolve('../test_vectors');
    if (!existsSync(vectorsDir)) return [];

    const results: VectorFile[] = [];
    for (const keypairDir of readdirSync(vectorsDir, { withFileTypes: true })) {
        if (!keypairDir.isDirectory()) continue;
        const keypairPath = join(vectorsDir, keypairDir.name);
        for (const file of readdirSync(keypairPath)) {
            if (!file.startsWith('token_') || !file.endsWith('.json')) continue;
            const id = `${keypairDir.name}/${file.replace('.json', '')}`;
            const v = JSON.parse(readFileSync(join(keypairPath, file), 'utf-8'));
            results.push({ id, v });
        }
    }
    return results;
}

const ALL_VECTORS = loadAllVectors();

// ==============================================================================
// HELPERS
// ==============================================================================

/** Parse a G1 point from vector's {x_hi, x_lo, y_hi, y_lo} format. */
function parseG1FromVector(obj: { x_hi: string; x_lo: string; y_hi: string; y_lo: string }) {
    return parseG1Sol(hexToBigint(obj.x_hi), hexToBigint(obj.x_lo), hexToBigint(obj.y_hi), hexToBigint(obj.y_lo));
}

/** Parse a G2 point from vector's {x_c0_hi, x_c0_lo, ..., y_c1_lo} format. */
function parseG2FromVector(obj: {
    x_c0_hi: string;
    x_c0_lo: string;
    x_c1_hi: string;
    x_c1_lo: string;
    y_c0_hi: string;
    y_c0_lo: string;
    y_c1_hi: string;
    y_c1_lo: string;
}) {
    return parseG2Sol(
        hexToBigint(obj.x_c0_hi),
        hexToBigint(obj.x_c0_lo),
        hexToBigint(obj.x_c1_hi),
        hexToBigint(obj.x_c1_lo),
        hexToBigint(obj.y_c0_hi),
        hexToBigint(obj.y_c0_lo),
        hexToBigint(obj.y_c1_hi),
        hexToBigint(obj.y_c1_lo),
    );
}

// ==============================================================================
// PARAMETRIZED TESTS
// ==============================================================================

describe.each(ALL_VECTORS.map(({ id, v }) => ({ id, v })))('Nozk Vectors [$id]', ({ v }) => {
    it('should derive blind keypair deterministically', () => {
        const masterSeedBytes = new TextEncoder().encode(v.MASTER_SEED);
        const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);

        expect(gl.getDepositId(secrets).toLowerCase()).toBe(v.BLIND_KEYPAIR.address.toLowerCase());
        expect(gl.getR(secrets).toString(16)).toBe(BigInt(v.BLIND_KEYPAIR.r).toString(16));
    });

    it('should derive spend BLS keypair matching vector', () => {
        const masterSeedBytes = new TextEncoder().encode(v.MASTER_SEED);
        const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);

        expect(secrets.spendBlsPriv).toBe(BigInt(v.SPEND_BLS.priv));

        const expectedPubG1 = parseG1FromVector(v.SPEND_BLS.pub_G1);
        expect(secrets.spendBlsPub.equals(expectedPubG1)).toBe(true);

        // Compressed G1 public key
        expect(bytesToHex(secrets.spendPubCompressed)).toBe(v.SPEND_BLS.pub_compressed);

        // Nullifier ID: keccak256(abiEncodeG1(spendBlsPub))
        expect(bytesToHex(secrets.nullifierIdBytes)).toBe(v.SPEND_BLS.nullifier_id);
    });

    it('should blind the token matching G2 vectors', () => {
        const masterSeedBytes = new TextEncoder().encode(v.MASTER_SEED);
        const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);
        const { Y, B } = gl.blindToken(secrets.spendBlsPub, secrets.r);

        const expectedY = parseG2FromVector(v.Y_HASH_TO_CURVE);
        expect(Y.equals(expectedY)).toBe(true);

        // Verify serialization roundtrip matches vector coordinates
        const ySol = serializeG2Sol(Y);
        expect(ySol[0]).toBe(hexToBigint(v.Y_HASH_TO_CURVE.x_c0_hi));
        expect(ySol[1]).toBe(hexToBigint(v.Y_HASH_TO_CURVE.x_c0_lo));
        expect(ySol[2]).toBe(hexToBigint(v.Y_HASH_TO_CURVE.x_c1_hi));
        expect(ySol[3]).toBe(hexToBigint(v.Y_HASH_TO_CURVE.x_c1_lo));
        expect(ySol[4]).toBe(hexToBigint(v.Y_HASH_TO_CURVE.y_c0_hi));
        expect(ySol[5]).toBe(hexToBigint(v.Y_HASH_TO_CURVE.y_c0_lo));
        expect(ySol[6]).toBe(hexToBigint(v.Y_HASH_TO_CURVE.y_c1_hi));
        expect(ySol[7]).toBe(hexToBigint(v.Y_HASH_TO_CURVE.y_c1_lo));

        const expectedB = parseG2FromVector(v.B_BLINDED);
        expect(B.equals(expectedB)).toBe(true);
    });

    it('should generate the exact blind signature S_prime', () => {
        const masterSeedBytes = new TextEncoder().encode(v.MASTER_SEED);
        const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);
        const { B } = gl.blindToken(secrets.spendBlsPub, secrets.r);

        const skMint = BigInt(v.MINT_BLS_PRIVKEY);
        const S_prime = gl.mintBlindSign(B, skMint);

        const expectedSPrime = parseG2FromVector(v.S_PRIME);
        expect(S_prime.equals(expectedSPrime)).toBe(true);
    });

    it('should unblind to the exact final signature S', () => {
        const masterSeedBytes = new TextEncoder().encode(v.MASTER_SEED);
        const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);
        const { B } = gl.blindToken(secrets.spendBlsPub, secrets.r);

        const skMint = BigInt(v.MINT_BLS_PRIVKEY);
        const S_prime = gl.mintBlindSign(B, skMint);
        const S = gl.unblindSignature(S_prime, secrets.r);

        const expectedS = parseG2FromVector(v.S_UNBLINDED);
        expect(S.equals(expectedS)).toBe(true);
    });

    it('should produce the exact BLS spend signature (AugSchemeMPL)', () => {
        const masterSeedBytes = new TextEncoder().encode(v.MASTER_SEED);
        const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);
        const redeem = v.REDEEM_TX;
        const eip712 = v.EIP712;

        const proof = gl.generateRedemptionProof(
            secrets.spendBlsPriv,
            secrets.spendPubCompressed,
            redeem.recipient,
            eip712.chain_id,
            eip712.contract_address,
            BigInt(eip712.deadline),
        );

        // msg_hash must match vector
        expect(bytesToHex(proof.msgHash)).toBe(redeem.msg_hash);

        // spend_pub_compressed must match vector
        expect(bytesToHex(proof.spendPubCompressed)).toBe(redeem.spend_pub_compressed);

        // sigma_compressed must be byte-identical to Python's AugSchemeMPL.sign output
        expect(bytesToHex(proof.sigma)).toBe(redeem.sigma_compressed);

        // BLS spend signature must verify
        expect(gl.verifyBlsSpendSignature(proof)).toBe(true);
    });

    it('should satisfy the BLS pairing e(PK, Y) == e(G1_gen, S)', () => {
        const masterSeedBytes = new TextEncoder().encode(v.MASTER_SEED);
        const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);
        const { Y, B } = gl.blindToken(secrets.spendBlsPub, secrets.r);

        const skMint = BigInt(v.MINT_BLS_PRIVKEY);
        const S_prime = gl.mintBlindSign(B, skMint);
        const S = gl.unblindSignature(S_prime, secrets.r);

        const pkDerived = g1ScalarMul(G1_GEN, skMint);
        const pkFromVec = parseG1FromVector(v.PK_MINT);

        expect(pkDerived.equals(pkFromVec)).toBe(true);
        expect(gl.verifyBlsPairing(S, Y, pkFromVec)).toBe(true);
    });

    it('should match REVEAL_TX fields', () => {
        const masterSeedBytes = new TextEncoder().encode(v.MASTER_SEED);
        const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);
        const { B } = gl.blindToken(secrets.spendBlsPub, secrets.r);

        const skMint = BigInt(v.MINT_BLS_PRIVKEY);
        const S_prime = gl.mintBlindSign(B, skMint);
        const S = gl.unblindSignature(S_prime, secrets.r);

        // REVEAL_TX.spend_pub_G1 should match derived spend pub
        const revealSpendPub = parseG1FromVector(v.REVEAL_TX.spend_pub_G1);
        expect(secrets.spendBlsPub.equals(revealSpendPub)).toBe(true);

        // REVEAL_TX.S_G2 should match unblinded signature
        const revealS = parseG2FromVector(v.REVEAL_TX.S_G2);
        expect(S.equals(revealS)).toBe(true);

        // REVEAL_TX.nullifier_id should match
        expect(bytesToHex(secrets.nullifierIdBytes)).toBe(v.REVEAL_TX.nullifier_id);
    });
});

// ==============================================================================
// AGGREGATION VECTOR TESTS
// ==============================================================================

interface AggVector {
    id: string;
    v: Record<string, any>;
}

function loadAggregationVectors(): AggVector[] {
    const vectorsDir = resolve('../test_vectors');
    if (!existsSync(vectorsDir)) return [];

    const results: AggVector[] = [];
    for (const keypairDir of readdirSync(vectorsDir, { withFileTypes: true })) {
        if (!keypairDir.isDirectory()) continue;
        const aggPath = join(vectorsDir, keypairDir.name, 'aggregation.json');
        if (existsSync(aggPath)) {
            results.push({
                id: keypairDir.name,
                v: JSON.parse(readFileSync(aggPath, 'utf-8')),
            });
        }
    }
    return results;
}

const AGG_VECTORS = loadAggregationVectors();

describe.each(AGG_VECTORS.map(({ id, v }) => ({ id, v })))('Aggregation Vectors [$id]', ({ v }) => {
    it('aggregated reveal vector has valid structure', () => {
        const reveal = v.AGGREGATED_REVEAL;
        const indices = v.token_indices;

        // sigma_G2 should parse as a non-zero G2 point
        const sigma = parseG2FromVector(reveal.sigma_G2);
        const coords = serializeG2Sol(sigma);
        expect(coords.some((c: bigint) => c !== 0n)).toBe(true);

        // Array lengths match token count
        expect(reveal.nullifier_ids.length).toBe(indices.length);
        expect(reveal.spend_pubs_G1.length).toBe(indices.length);

        // Each spend pub is parseable as G1 with non-zero coordinates
        for (const pub of reveal.spend_pubs_G1) {
            const point = parseG1FromVector(pub);
            expect(point.is0()).toBe(false);
        }
    });

    it('aggregated redeem vector has valid structure', () => {
        const redeem = v.AGGREGATED_REDEEM;
        const indices = v.token_indices;

        // sigma_compressed should be 96 bytes (192 hex chars)
        expect(redeem.sigma_compressed.length).toBe(192);

        // Array lengths match
        expect(redeem.nullifier_ids.length).toBe(indices.length);
        expect(redeem.spend_pubs_compressed.length).toBe(indices.length);

        // Each compressed pub is 48 bytes (96 hex chars)
        for (const pub of redeem.spend_pubs_compressed) {
            expect(pub.length).toBe(96);
        }

        // msg_hash exists and is 32 bytes
        expect(redeem.msg_hash.length).toBe(64);
    });
});
