import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import mcl from 'mcl-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { bytesToHex, getG2Generator, initBN254 } from './bn254-crypto.js';
import * as gl from './nozk-library.js';

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
    const vectorsDir = resolve('../test_vectors');
    if (!existsSync(vectorsDir)) return [];

    const results: VectorFile[] = [];
    for (const keypairDir of readdirSync(vectorsDir, { withFileTypes: true })) {
        if (!keypairDir.isDirectory()) continue;
        const keypairPath = join(vectorsDir, keypairDir.name);
        for (const file of readdirSync(keypairPath)) {
            if (!file.endsWith('.json')) continue;
            const id = `${keypairDir.name}/${file.replace('.json', '')}`;
            const v = JSON.parse(readFileSync(join(keypairPath, file), 'utf-8'));
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

describe.each(ALL_VECTORS.map(({ id, v }) => ({ id, v })))('👻 Nozk Vectors [$id]', ({ v }) => {
    it('should derive spend and blind keypairs deterministically', () => {
        const masterSeedBytes = new TextEncoder().encode(v.MASTER_SEED);
        const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);

        expect(gl.getSpendAddress(secrets).toLowerCase()).toBe(v.SPEND_KEYPAIR.address.toLowerCase());
        expect(gl.getDepositId(secrets).toLowerCase()).toBe(v.BLIND_KEYPAIR.address.toLowerCase());
        expect(gl.getR(secrets).toString(16)).toBe(BigInt(v.BLIND_KEYPAIR.r).toString(16));
    });

    it('should derive public keys matching vector', () => {
        const masterSeedBytes = new TextEncoder().encode(v.MASTER_SEED);
        const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);

        expect(secrets.spend.pubHex.toLowerCase()).toBe(v.SPEND_KEYPAIR.pub.toLowerCase());
        expect(secrets.blind.pubHex.toLowerCase()).toBe(v.BLIND_KEYPAIR.pub.toLowerCase());
    });

    it('should blind the token matching G1 vectors', () => {
        const masterSeedBytes = new TextEncoder().encode(v.MASTER_SEED);
        const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);
        const { Y, B } = gl.blindToken(gl.getSpendAddressBytes(secrets), gl.getR(secrets));

        const yCoords = Y.getStr(16).split(' ');
        expect(yCoords[1]).toBe(v.Y_HASH_TO_CURVE.X);
        expect(yCoords[2]).toBe(v.Y_HASH_TO_CURVE.Y);

        const bCoords = B.getStr(16).split(' ');
        expect(bCoords[1]).toBe(v.B_BLINDED.X);
        expect(bCoords[2]).toBe(v.B_BLINDED.Y);
    });

    it('should generate the exact blind signature S_prime', () => {
        const masterSeedBytes = new TextEncoder().encode(v.MASTER_SEED);
        const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);
        const { B } = gl.blindToken(gl.getSpendAddressBytes(secrets), gl.getR(secrets));
        const skMint = BigInt(v.MINT_BLS_PRIVKEY);
        const S_prime = gl.mintBlindSign(B, skMint);

        const coords = S_prime.getStr(16).split(' ');
        expect(coords[1]).toBe(v.S_PRIME.X);
        expect(coords[2]).toBe(v.S_PRIME.Y);
    });

    it('should unblind to the exact final signature S', () => {
        const masterSeedBytes = new TextEncoder().encode(v.MASTER_SEED);
        const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);
        const { B } = gl.blindToken(gl.getSpendAddressBytes(secrets), gl.getR(secrets));
        const skMint = BigInt(v.MINT_BLS_PRIVKEY);
        const S_prime = gl.mintBlindSign(B, skMint);
        const S = gl.unblindSignature(S_prime, gl.getR(secrets));

        const coords = S.getStr(16).split(' ');
        expect(coords[1]).toBe(v.S_UNBLINDED.X);
        expect(coords[2]).toBe(v.S_UNBLINDED.Y);
    });

    it('should verify the MEV protection payload (EIP-712)', async () => {
        const masterSeedBytes = new TextEncoder().encode(v.MASTER_SEED);
        const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);
        const redeem = v.REDEEM_TX;
        const eip712 = v.EIP712;

        const spendPriv = gl.getSpendPriv(secrets);
        const proof = await gl.generateRedemptionProof(
            spendPriv,
            redeem.recipient,
            eip712.chain_id,
            eip712.contract_address,
            BigInt(eip712.deadline),
        );

        expect(bytesToHex(proof.msgHash)).toBe(redeem.msg_hash);
        expect(proof.compactHex).toBe(redeem.compact_hex);
        expect(proof.recoveryBit).toBe(redeem.recovery_bit);
        const v_hex = (proof.recoveryBit + 27).toString(16).padStart(2, '0');
        expect(proof.compactHex + v_hex).toBe(redeem.spend_signature);
        expect(gl.verifyEcdsaMevProtection(proof, gl.getSpendAddress(secrets))).toBe(true);
    });

    it('should satisfy the BLS pairing e(S, G2) == e(Y, PK_mint)', () => {
        const masterSeedBytes = new TextEncoder().encode(v.MASTER_SEED);
        const secrets = gl.deriveTokenSecrets(masterSeedBytes, v.TOKEN_INDEX);
        const { Y, B } = gl.blindToken(gl.getSpendAddressBytes(secrets), gl.getR(secrets));
        const skMint = BigInt(v.MINT_BLS_PRIVKEY);
        const S_prime = gl.mintBlindSign(B, skMint);
        const S = gl.unblindSignature(S_prime, gl.getR(secrets));

        // Derive PK = sk * G2_gen
        const g2Gen = getG2Generator();
        const skFr = new mcl.Fr();
        skFr.setStr(skMint.toString(16), 16);
        const pkDerived = mcl.mul(g2Gen, skFr) as mcl.G2;

        // Load PK directly from vector coordinates
        const vecPK = v.PK_MINT;
        const pkFromVec = new mcl.G2();
        pkFromVec.setStr(`1 ${vecPK.X_real} ${vecPK.X_imag} ${vecPK.Y_real} ${vecPK.Y_imag}`, 16);

        expect(pkDerived.isEqual(pkFromVec)).toBe(true);
        expect(gl.verifyBlsPairing(S, Y, pkFromVec)).toBe(true);
    });
});
