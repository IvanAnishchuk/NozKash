import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mcl from 'mcl-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    bytesToHex,
    CURVE_ORDER,
    formatG1ForSolidity,
    g1FromHexCoords,
    getG2Generator,
    hashToCurveBN254,
    hexToBytes,
    initBN254,
    modularInverse,
    multiplyBN254,
    padHex64,
    verifyPairingBN254,
} from './bn254-crypto.js';
import {
    blindToken,
    DerivationError,
    deriveTokenSecrets,
    eip712DomainSeparator,
    eip712RedemptionHash,
    generateMintKeypair,
    generateRedemptionProof,
    getR,
    getSpendAddress,
    getSpendAddressBytes,
    getSpendPriv,
    mintBlindSign,
    unblindSignature,
    verifyBlsPairing,
    verifyEcdsaMevProtection,
} from './nozk-library.js';

// ==============================================================================
// TEST VECTOR
// ==============================================================================

const VECTOR_PATH = resolve('../test_vectors/fb609bc5_c7e9cab4/token_0.json');
const VEC = JSON.parse(readFileSync(VECTOR_PATH, 'utf-8'));

// ==============================================================================
// padHex64
// ==============================================================================

describe('padHex64', () => {
    it('pads a short string to 64 characters', () => {
        expect(padHex64('abc')).toBe(`${'0'.repeat(61)}abc`);
    });

    it('returns a 64-char string unchanged', () => {
        const s = 'a'.repeat(64);
        expect(padHex64(s)).toBe(s);
    });

    it('handles empty string', () => {
        expect(padHex64('')).toBe('0'.repeat(64));
    });

    it('does not truncate strings longer than 64', () => {
        const s = 'f'.repeat(65);
        expect(padHex64(s)).toBe(s);
    });
});

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

    it('hexToBytes throws on odd-length hex', () => {
        expect(() => hexToBytes('abc')).toThrow(/odd-length/i);
    });

    it('hexToBytes throws on non-hex characters', () => {
        expect(() => hexToBytes('zzzz')).toThrow(/non-hex/i);
    });
});

// ==============================================================================
// modularInverse
// ==============================================================================

describe('modularInverse', () => {
    it('satisfies k * inv(k) % mod == 1 for k=7', () => {
        const k = 7n;
        const inv = modularInverse(k, CURVE_ORDER);
        expect((k * inv) % CURVE_ORDER).toBe(1n);
    });

    it('satisfies k * inv(k) % mod == 1 for a large scalar', () => {
        const k = 0x123456789abcdef0123456789abcdef0n;
        const inv = modularInverse(k, CURVE_ORDER);
        expect((k * inv) % CURVE_ORDER).toBe(1n);
    });

    it('inverse of 1 is 1', () => {
        expect(modularInverse(1n, CURVE_ORDER)).toBe(1n);
    });
});

// ==============================================================================
// BN254 G1 helpers (require mcl)
// ==============================================================================

describe('BN254 G1 helpers', () => {
    beforeAll(async () => {
        await initBN254();
    });

    it('g1FromHexCoords round-trips through formatG1ForSolidity', () => {
        const xHex = VEC.Y_HASH_TO_CURVE.X;
        const yHex = VEC.Y_HASH_TO_CURVE.Y;
        const point = g1FromHexCoords(xHex, yHex);
        const [xDec, yDec] = formatG1ForSolidity(point);
        // BigInt.toString(16) strips leading zeros, so pad back to compare
        expect(padHex64(BigInt(xDec).toString(16))).toBe(padHex64(xHex));
        expect(padHex64(BigInt(yDec).toString(16))).toBe(padHex64(yHex));
    });

    it('g1FromHexCoords with and without leading zeros yields same point', () => {
        // Use real vector coordinates — X has a leading zero when padded to 64
        const xShort = VEC.Y_HASH_TO_CURVE.X; // may lack leading zeros
        const xPadded = padHex64(xShort);
        const yHex = VEC.Y_HASH_TO_CURVE.Y;
        const p1 = g1FromHexCoords(xShort, yHex);
        const p2 = g1FromHexCoords(xPadded, yHex);
        expect(p1.isEqual(p2)).toBe(true);
    });

    it('formatG1ForSolidity returns valid decimal strings', () => {
        const point = g1FromHexCoords(VEC.B_BLINDED.X, VEC.B_BLINDED.Y);
        const [xDec, yDec] = formatG1ForSolidity(point);
        expect(BigInt(xDec)).toBeGreaterThan(0n);
        expect(BigInt(yDec)).toBeGreaterThan(0n);
    });
});

// ==============================================================================
// hashToCurveBN254 / multiplyBN254
// ==============================================================================

describe('hashToCurveBN254 / multiplyBN254', () => {
    beforeAll(async () => {
        await initBN254();
    });

    it('hashToCurveBN254 is deterministic', () => {
        const msg = new TextEncoder().encode('test_message');
        const p1 = hashToCurveBN254(msg);
        const p2 = hashToCurveBN254(msg);
        expect(p1.isEqual(p2)).toBe(true);
    });

    it('hashToCurveBN254 different inputs yield different points', () => {
        const p1 = hashToCurveBN254(new TextEncoder().encode('a'));
        const p2 = hashToCurveBN254(new TextEncoder().encode('b'));
        expect(p1.isEqual(p2)).toBe(false);
    });

    it('multiplyBN254 by scalar 1 returns the same point', () => {
        const msg = new TextEncoder().encode('identity_test');
        const point = hashToCurveBN254(msg);
        const result = multiplyBN254(point, 1n);
        expect(result.isEqual(point)).toBe(true);
    });
});

// ==============================================================================
// getG2Generator / verifyPairingBN254
// ==============================================================================

describe('getG2Generator / verifyPairingBN254', () => {
    beforeAll(async () => {
        await initBN254();
    });

    it('getG2Generator is deterministic and non-zero', () => {
        const g1 = getG2Generator();
        const g2 = getG2Generator();
        expect(g1.isEqual(g2)).toBe(true);
        expect(g1.isZero()).toBe(false);
    });

    it('verifyPairingBN254 valid triple returns true', () => {
        const msg = new TextEncoder().encode('pairing_test');
        const Y = hashToCurveBN254(msg);
        const sk = 42n;
        const S = multiplyBN254(Y, sk);

        const g2 = getG2Generator();
        const skFr = new mcl.Fr();
        skFr.setStr(sk.toString(16), 16);
        const pk = mcl.mul(g2, skFr) as mcl.G2;

        expect(verifyPairingBN254(S, Y, pk)).toBe(true);
    });

    it('verifyPairingBN254 wrong key returns false', () => {
        const msg = new TextEncoder().encode('pairing_test');
        const Y = hashToCurveBN254(msg);
        const S = multiplyBN254(Y, 42n);

        const g2 = getG2Generator();
        const wrongFr = new mcl.Fr();
        wrongFr.setStr('999', 10);
        const wrongPk = mcl.mul(g2, wrongFr) as mcl.G2;

        expect(verifyPairingBN254(S, Y, wrongPk)).toBe(false);
    });
});

// ==============================================================================
// generateMintKeypair
// ==============================================================================

describe('generateMintKeypair', () => {
    beforeAll(async () => {
        await initBN254();
    });

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
});

// ==============================================================================
// EIP-712 helpers
// ==============================================================================

describe('EIP-712 helpers', () => {
    it('eip712DomainSeparator is deterministic', () => {
        const a = eip712DomainSeparator(11155111, '0x00000000000000000000000000000000DeaDBeef');
        const b = eip712DomainSeparator(11155111, '0x00000000000000000000000000000000DeaDBeef');
        expect(bytesToHex(a)).toBe(bytesToHex(b));
    });

    it('eip712RedemptionHash matches test vector msg_hash', () => {
        const hash = eip712RedemptionHash(
            VEC.REDEEM_TX.recipient,
            BigInt(VEC.EIP712.deadline),
            VEC.EIP712.chain_id,
            VEC.EIP712.contract_address,
        );
        expect(bytesToHex(hash)).toBe(VEC.REDEEM_TX.msg_hash);
    });

    it('eip712RedemptionHash changes with different recipient', () => {
        const deadline = BigInt(VEC.EIP712.deadline);
        const chainId = VEC.EIP712.chain_id;
        const contract = VEC.EIP712.contract_address;
        const h1 = eip712RedemptionHash('0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa', deadline, chainId, contract);
        const h2 = eip712RedemptionHash('0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB', deadline, chainId, contract);
        expect(bytesToHex(h1)).not.toBe(bytesToHex(h2));
    });
});

// ==============================================================================
// deriveTokenSecrets validation
// ==============================================================================

describe('deriveTokenSecrets validation', () => {
    beforeAll(async () => {
        await initBN254();
    });

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
    beforeAll(async () => {
        await initBN254();
    });

    it('blindToken + mintBlindSign + unblindSignature verifies BLS pairing', () => {
        const seed = new TextEncoder().encode('lifecycle_unit_test_seed');
        const secrets = deriveTokenSecrets(seed, 0);
        const r = getR(secrets);
        const { Y, B } = blindToken(getSpendAddressBytes(secrets), r);

        const kp = generateMintKeypair();
        const S_prime = mintBlindSign(B, kp.skMint);
        const S = unblindSignature(S_prime, r);

        expect(verifyBlsPairing(S, Y, kp.pkMint)).toBe(true);
    });

    it('BLS pairing fails with wrong mint key', () => {
        const seed = new TextEncoder().encode('wrong_key_test');
        const secrets = deriveTokenSecrets(seed, 0);
        const r = getR(secrets);
        const { Y, B } = blindToken(getSpendAddressBytes(secrets), r);

        const kpReal = generateMintKeypair();
        const kpWrong = generateMintKeypair();
        const S_prime = mintBlindSign(B, kpReal.skMint);
        const S = unblindSignature(S_prime, r);

        expect(verifyBlsPairing(S, Y, kpWrong.pkMint)).toBe(false);
    });

    it('generateRedemptionProof + verifyEcdsaMevProtection round-trip', async () => {
        const seed = new TextEncoder().encode('ecdsa_lifecycle_test');
        const secrets = deriveTokenSecrets(seed, 0);
        const recipient = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';

        const proof = await generateRedemptionProof(
            getSpendPriv(secrets),
            recipient,
            11155111,
            '0x00000000000000000000000000000000DeaDBeef',
            BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
        );

        expect(verifyEcdsaMevProtection(proof, getSpendAddress(secrets))).toBe(true);
    });
});
