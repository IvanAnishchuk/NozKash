import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import mcl from 'mcl-wasm';
import * as gl from './ghost-library.js';
import { initBN254, verifyPairingBN254 } from './bn254-crypto.js';

// ==============================================================================
// VECTOR DISCOVERY
// Loads all *.json files from test_vectors/<keypair_dir>/token_<index>.json.
// If test_vectors/ is empty, collects zero tests — run generate_vectors.py first.
// ==============================================================================

interface VectorFile {
    id: string;
    v: Record<string, any>;
}

function loadAllVectors(): VectorFile[] {
    const vectorsDir = resolve('./test_vectors');
    if (!existsSync(vectorsDir)) return [];

    const results: VectorFile[] = [];
    for (const keypairDir of readdirSync(vectorsDir, { withFileTypes: true })) {
        if (!keypairDir.isDirectory()) continue;
        const keypairPath = join(vectorsDir, keypairDir.name);
        for (const file of readdirSync(keypairPath)) {
            if (!file.endsWith('.json')) continue;
            const id = `${keypairDir.name}/${file.replace('.json', '')}`;
            const v  = JSON.parse(readFileSync(join(keypairPath, file), 'utf-8'));
            results.push({ id, v });
        }
    }
    return results;
}

const ALL_VECTORS = loadAllVectors();

// ==============================================================================
// PARAMETRIZED TESTS
// ==============================================================================

beforeAll(async () => {
    await initBN254();
});

describe.each(ALL_VECTORS.map(({ id, v }) => ({ id, v })))(
    '👻 Ghost-Tip Vectors [$id]',
    ({ v }) => {

        it('should derive spend and blind keypairs deterministically', () => {
            const masterSeedBytes = Buffer.from(v.MASTER_SEED, 'utf-8');
            const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);

            expect(gl.getSpendAddress(secrets).toLowerCase())
                .toBe(v.SPEND_KEYPAIR.address.toLowerCase());
            expect(gl.getDepositId(secrets).toLowerCase())
                .toBe(v.BLIND_KEYPAIR.address.toLowerCase());
            expect(gl.getR(secrets).toString(16))
                .toBe(BigInt(v.BLIND_KEYPAIR.r).toString(16));
        });

        it('should derive public keys matching vector', () => {
            const masterSeedBytes = Buffer.from(v.MASTER_SEED, 'utf-8');
            const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);

            expect(secrets.spend.pubHex.toLowerCase())
                .toBe(v.SPEND_KEYPAIR.pub.toLowerCase());
            expect(secrets.blind.pubHex.toLowerCase())
                .toBe(v.BLIND_KEYPAIR.pub.toLowerCase());
        });

        it('should blind the token matching G1 vectors', () => {
            const masterSeedBytes = Buffer.from(v.MASTER_SEED, 'utf-8');
            const secrets  = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);
            const { Y, B } = gl.blindToken(gl.getSpendAddressBytes(secrets), gl.getR(secrets));

            const yCoords = Y.getStr(16).split(' ');
            expect(yCoords[1]).toBe(v.Y_HASH_TO_CURVE.X);
            expect(yCoords[2]).toBe(v.Y_HASH_TO_CURVE.Y);

            const bCoords = B.getStr(16).split(' ');
            expect(bCoords[1]).toBe(v.B_BLINDED.X);
            expect(bCoords[2]).toBe(v.B_BLINDED.Y);
        });

        it('should generate the exact blind signature S_prime', () => {
            const masterSeedBytes = Buffer.from(v.MASTER_SEED, 'utf-8');
            const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);
            const { B }   = gl.blindToken(gl.getSpendAddressBytes(secrets), gl.getR(secrets));
            const skMint  = BigInt(v.MINT_BLS_PRIVKEY);
            const S_prime = gl.mintBlindSign(B, skMint);

            const coords = S_prime.getStr(16).split(' ');
            expect(coords[1]).toBe(v.S_PRIME.X);
            expect(coords[2]).toBe(v.S_PRIME.Y);
        });

        it('should unblind to the exact final signature S', () => {
            const masterSeedBytes = Buffer.from(v.MASTER_SEED, 'utf-8');
            const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);
            const { B }   = gl.blindToken(gl.getSpendAddressBytes(secrets), gl.getR(secrets));
            const skMint  = BigInt(v.MINT_BLS_PRIVKEY);
            const S_prime = gl.mintBlindSign(B, skMint);
            const S       = gl.unblindSignature(S_prime, gl.getR(secrets));

            const coords = S.getStr(16).split(' ');
            expect(coords[1]).toBe(v.S_UNBLINDED.X);
            expect(coords[2]).toBe(v.S_UNBLINDED.Y);
        });

        it('should verify the MEV protection payload', async () => {
            const masterSeedBytes = Buffer.from(v.MASTER_SEED, 'utf-8');
            const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);
            const proof   = await gl.generateRedemptionProof(
                gl.getSpendPriv(secrets),
                '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7',
            );

            expect(gl.verifyEcdsaMevProtection(proof, gl.getSpendAddress(secrets))).toBe(true);
        });

        it('should satisfy the BLS pairing e(S, G2) == e(Y, PK_mint)', () => {
            const masterSeedBytes = Buffer.from(v.MASTER_SEED, 'utf-8');
            const secrets  = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);
            const { Y, B } = gl.blindToken(gl.getSpendAddressBytes(secrets), gl.getR(secrets));
            const skMint   = BigInt(v.MINT_BLS_PRIVKEY);
            const S_prime  = gl.mintBlindSign(B, skMint);
            const S        = gl.unblindSignature(S_prime, gl.getR(secrets));

            const generatorG2 = mcl.hashAndMapToG2('GhostTipG2Generator');
            const skFr = new mcl.Fr();
            skFr.setStr(skMint.toString(10), 10);
            const pkMint = mcl.mul(generatorG2, skFr) as mcl.G2;

            expect(verifyPairingBN254(S, Y, pkMint)).toBe(true);
        });
    }
);
