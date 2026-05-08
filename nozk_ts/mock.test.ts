/**
 * Mock infrastructure tests — mirrors Python mock_test.py.
 *
 * Tests MockMint (blind signing) and MockRedeemer (state machine
 * simulating reveal/redeem with BLS verification).
 */

import { describe, expect, it } from 'vitest';
import { CURVE_ORDER, serializeG2Sol } from './bls12-381-crypto.js';
import { MockMint, MockMintError } from './mint-mock.js';
import {
    blindToken,
    deriveTokenSecrets,
    generateRedemptionProof,
    getNullifierIdHex,
    mintBlindSign,
    unblindSignature,
} from './nozk-library.js';
import { MockRedeemer, NullifierState } from './redeem-mock.js';

// ==============================================================================
// SHARED CONSTANTS
// ==============================================================================

const TEST_CHAIN_ID = 11155111;
const TEST_CONTRACT = '0x00000000000000000000000000000000DeaDBeef';
const TEST_DEADLINE = (1n << 256n) - 1n;

// ==============================================================================
// HELPERS
// ==============================================================================

function setupLifecycle(keypairSk: bigint) {
    const seed = new TextEncoder().encode('mock_test_lifecycle_seed');
    const secrets = deriveTokenSecrets(seed, 0);
    const { Y, B } = blindToken(secrets.spendBlsPub, secrets.r);
    const S_prime = mintBlindSign(B, keypairSk);
    const S = unblindSignature(S_prime, secrets.r);
    const recipient = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
    const proof = generateRedemptionProof(
        secrets.spendBlsPriv,
        secrets.spendPubCompressed,
        recipient,
        TEST_CHAIN_ID,
        TEST_CONTRACT,
        TEST_DEADLINE,
    );
    return { secrets, Y, B, S, recipient, proof };
}

// ==============================================================================
// MockMint constructors
// ==============================================================================

describe('MockMint constructors', () => {
    it('fromSk with valid scalar', () => {
        const mint = MockMint.fromSk(42n);
        expect(mint.sk).toBe(42n);
    });

    it('fromSk with zero throws', () => {
        expect(() => MockMint.fromSk(0n)).toThrow(MockMintError);
    });

    it('fromSk with CURVE_ORDER throws', () => {
        expect(() => MockMint.fromSk(CURVE_ORDER)).toThrow(MockMintError);
    });

    it('fromHex with 0x prefix', () => {
        const mint = MockMint.fromHex('0x2a');
        expect(mint.sk).toBe(42n);
    });

    it('fromHex with invalid string throws', () => {
        expect(() => MockMint.fromHex('not_hex')).toThrow(MockMintError);
    });
});

// ==============================================================================
// MockMint signing
// ==============================================================================

describe('MockMint signing', () => {
    it('sign returns G2 point', () => {
        const mint = MockMint.fromSk(42n);
        const seed = new TextEncoder().encode('sign_test');
        const secrets = deriveTokenSecrets(seed, 0);
        const { B } = blindToken(secrets.spendBlsPub, secrets.r);
        const sPrime = mint.sign(B);
        const coords = serializeG2Sol(sPrime);
        expect(coords.some((c) => c !== 0n)).toBe(true);
    });

    it('signAndSerialize returns 8 bigints', () => {
        const mint = MockMint.fromSk(42n);
        const seed = new TextEncoder().encode('serialize_test');
        const secrets = deriveTokenSecrets(seed, 0);
        const { B } = blindToken(secrets.spendBlsPub, secrets.r);
        const coords = mint.signAndSerialize(B);
        expect(coords.length).toBe(8);
        expect(coords.every((c) => typeof c === 'bigint')).toBe(true);
    });
});

// ==============================================================================
// MockRedeemer reveal
// ==============================================================================

describe('MockRedeemer reveal', () => {
    it('valid reveal succeeds', () => {
        const sk = 42n;
        const redeemer = MockRedeemer.fromSk(sk);
        const { secrets, S } = setupLifecycle(sk);

        const result = redeemer.reveal(secrets.spendBlsPub, S);
        expect(result.success).toBe(true);
        expect(result.blsPairingOk).toBe(true);
        expect(redeemer.isRevealed(result.nullifierId)).toBe(true);
    });

    it('already revealed fails', () => {
        const sk = 42n;
        const redeemer = MockRedeemer.fromSk(sk);
        const { secrets, S } = setupLifecycle(sk);

        const first = redeemer.reveal(secrets.spendBlsPub, S);
        expect(first.success).toBe(true);

        const second = redeemer.reveal(secrets.spendBlsPub, S);
        expect(second.success).toBe(false);
        expect(second.reason).toContain('already');
    });

    it('wrong mint key fails BLS pairing', () => {
        const realSk = 42n;
        const wrongSk = 999n;
        const redeemer = MockRedeemer.fromSk(wrongSk); // wrong key
        const { secrets, S } = setupLifecycle(realSk); // signed with real key

        const result = redeemer.reveal(secrets.spendBlsPub, S);
        expect(result.success).toBe(false);
        expect(result.blsPairingOk).toBe(false);
    });
});

// ==============================================================================
// MockRedeemer redeem
// ==============================================================================

describe('MockRedeemer redeem', () => {
    it('redeem after reveal succeeds', () => {
        const sk = 42n;
        const redeemer = MockRedeemer.fromSk(sk);
        const { secrets, S, recipient, proof } = setupLifecycle(sk);

        redeemer.reveal(secrets.spendBlsPub, S);

        const nid = getNullifierIdHex(secrets);
        const result = redeemer.redeem({
            recipient,
            sigma: proof.sigma,
            spendPubCompressed: proof.spendPubCompressed,
            nullifierId: nid,
            chainId: TEST_CHAIN_ID,
            contractAddress: TEST_CONTRACT,
            deadline: TEST_DEADLINE,
        });
        expect(result.success).toBe(true);
        expect(result.blsSpendOk).toBe(true);
        expect(redeemer.isSpent(nid)).toBe(true);
    });

    it('redeem without reveal fails', () => {
        const sk = 42n;
        const redeemer = MockRedeemer.fromSk(sk);
        const { secrets, recipient, proof } = setupLifecycle(sk);

        const nid = getNullifierIdHex(secrets);
        const result = redeemer.redeem({
            recipient,
            sigma: proof.sigma,
            spendPubCompressed: proof.spendPubCompressed,
            nullifierId: nid,
            chainId: TEST_CHAIN_ID,
            contractAddress: TEST_CONTRACT,
            deadline: TEST_DEADLINE,
        });
        expect(result.success).toBe(false);
        expect(result.reason).toContain('not revealed');
    });

    it('double spend fails', () => {
        const sk = 42n;
        const redeemer = MockRedeemer.fromSk(sk);
        const { secrets, S, recipient, proof } = setupLifecycle(sk);

        redeemer.reveal(secrets.spendBlsPub, S);

        const nid = getNullifierIdHex(secrets);
        const params = {
            recipient,
            sigma: proof.sigma,
            spendPubCompressed: proof.spendPubCompressed,
            nullifierId: nid,
            chainId: TEST_CHAIN_ID,
            contractAddress: TEST_CONTRACT,
            deadline: TEST_DEADLINE,
        };

        const first = redeemer.redeem(params);
        expect(first.success).toBe(true);

        const second = redeemer.redeem(params);
        expect(second.success).toBe(false);
        expect(second.nullifierSpent).toBe(true);
    });

    it('isSpent + reset', () => {
        const sk = 42n;
        const redeemer = MockRedeemer.fromSk(sk);
        const { secrets, S, recipient, proof } = setupLifecycle(sk);

        redeemer.reveal(secrets.spendBlsPub, S);
        const nid = getNullifierIdHex(secrets);
        redeemer.redeem({
            recipient,
            sigma: proof.sigma,
            spendPubCompressed: proof.spendPubCompressed,
            nullifierId: nid,
            chainId: TEST_CHAIN_ID,
            contractAddress: TEST_CONTRACT,
            deadline: TEST_DEADLINE,
        });

        expect(redeemer.isSpent(nid)).toBe(true);
        expect(redeemer.getState(nid)).toBe(NullifierState.SPENT);

        redeemer.reset();
        expect(redeemer.isSpent(nid)).toBe(false);
        expect(redeemer.getState(nid)).toBe(NullifierState.UNREVEALED);
    });
});
