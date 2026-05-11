/**
 * Contract API signature tests.
 *
 * Validates that all client-side contract call patterns match the ABI.
 * Catches arg count/type mismatches at test time without needing anvil.
 *
 * Uses the shared ABI from abi/nozk_vault_v2_abi.json as the single source of truth.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Abi, encodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const abiPath = resolve(REPO_ROOT, 'abi', 'nozk_vault_v2_abi.json');
const NOZK_VAULT_ABI = JSON.parse(readFileSync(abiPath, 'utf-8')) as Abi;

// Dummy values for encoding tests
const ZERO_ADDR = '0x0000000000000000000000000000000000000001' as const;
const ZERO_G1: readonly [bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n];
const ZERO_G2: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
    0n,
    0n,
    0n,
    0n,
    0n,
    0n,
    0n,
    0n,
];
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

// ==============================================================================
// Test: ABI function input counts
// ==============================================================================

describe('ABI function signatures', () => {
    const expectedInputs: Record<string, number> = {
        deposit: 2,
        announce: 2,
        reveal: 2,
        redeem: 4,
        refund: 1,
        revealAggregated: 2,
        redeemAggregated: 4,
        revealBatch: 2,
    };

    for (const [fnName, expected] of Object.entries(expectedInputs)) {
        it(`${fnName} has ${expected} inputs in ABI`, () => {
            const entry = (NOZK_VAULT_ABI as any[]).find((e) => e.type === 'function' && e.name === fnName);
            expect(entry).toBeDefined();
            expect(entry.inputs.length).toBe(expected);
        });
    }
});

// ==============================================================================
// Test: correct arg counts encode successfully
// ==============================================================================

describe('correct arg counts encode', () => {
    it('deposit(address, uint256[8])', () => {
        const data = encodeFunctionData({
            abi: NOZK_VAULT_ABI,
            functionName: 'deposit',
            args: [ZERO_ADDR, [...ZERO_G2]],
        });
        expect(data).toMatch(/^0x/);
    });

    it('announce(address, uint256[8])', () => {
        const data = encodeFunctionData({
            abi: NOZK_VAULT_ABI,
            functionName: 'announce',
            args: [ZERO_ADDR, [...ZERO_G2]],
        });
        expect(data).toMatch(/^0x/);
    });

    it('reveal(uint256[4], uint256[8])', () => {
        const data = encodeFunctionData({
            abi: NOZK_VAULT_ABI,
            functionName: 'reveal',
            args: [[...ZERO_G1], [...ZERO_G2]],
        });
        expect(data).toMatch(/^0x/);
    });

    it('redeem(address, uint256[8], bytes32, uint256) — 4 args', () => {
        const data = encodeFunctionData({
            abi: NOZK_VAULT_ABI,
            functionName: 'redeem',
            args: [ZERO_ADDR, [...ZERO_G2], ZERO_BYTES32, 0n],
        });
        expect(data).toMatch(/^0x/);
    });

    it('refund(address)', () => {
        const data = encodeFunctionData({
            abi: NOZK_VAULT_ABI,
            functionName: 'refund',
            args: [ZERO_ADDR],
        });
        expect(data).toMatch(/^0x/);
    });

    it('redeemAggregated(address, uint256[8], bytes32[], uint256)', () => {
        const data = encodeFunctionData({
            abi: NOZK_VAULT_ABI,
            functionName: 'redeemAggregated',
            args: [ZERO_ADDR, [...ZERO_G2], [ZERO_BYTES32], 0n],
        });
        expect(data).toMatch(/^0x/);
    });

    it('revealAggregated(uint256[4][], uint256[8])', () => {
        const data = encodeFunctionData({
            abi: NOZK_VAULT_ABI,
            functionName: 'revealAggregated',
            args: [[[...ZERO_G1]], [...ZERO_G2]],
        });
        expect(data).toMatch(/^0x/);
    });

    it('revealBatch(uint256[4][], uint256[8][])', () => {
        const data = encodeFunctionData({
            abi: NOZK_VAULT_ABI,
            functionName: 'revealBatch',
            args: [[[...ZERO_G1]], [[...ZERO_G2]]],
        });
        expect(data).toMatch(/^0x/);
    });
});

// ==============================================================================
// Test: wrong arg counts fail to encode
// ==============================================================================

describe('wrong arg counts rejected', () => {
    it('redeem with 5 args (extra spend_pk) throws', () => {
        expect(() =>
            encodeFunctionData({
                abi: NOZK_VAULT_ABI,
                functionName: 'redeem',
                // 5 args: recipient, sig, spend_pk (EXTRA), nullifier, deadline
                args: [ZERO_ADDR, [...ZERO_G2], [...ZERO_G1], ZERO_BYTES32, 0n] as any,
            }),
        ).toThrow();
    });

    it('reveal with 3 args throws', () => {
        expect(() =>
            encodeFunctionData({
                abi: NOZK_VAULT_ABI,
                functionName: 'reveal',
                args: [[...ZERO_G1], [...ZERO_G2], [...ZERO_G2]] as any,
            }),
        ).toThrow();
    });

    it('deposit with 3 args throws', () => {
        expect(() =>
            encodeFunctionData({
                abi: NOZK_VAULT_ABI,
                functionName: 'deposit',
                args: [ZERO_ADDR, [...ZERO_G2], 0n] as any,
            }),
        ).toThrow();
    });
});

// ==============================================================================
// Test: client.ts redeem uses correct 4 args (regression guard)
// ==============================================================================

describe('client call patterns', () => {
    it('client.ts redeem pattern — 4 args', () => {
        // Matches client.ts line 641-642:
        //   args: [recipientAddr, [...sigCoords], nullifierIdHex, deadline]
        const data = encodeFunctionData({
            abi: NOZK_VAULT_ABI,
            functionName: 'redeem',
            args: [ZERO_ADDR, [...ZERO_G2], ZERO_BYTES32, BigInt(2 ** 256) - 1n],
        });
        expect(data).toMatch(/^0x/);
    });
});
