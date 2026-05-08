/**
 * E2E test: deploy NozkVaultV2 on local anvil, run full BLS12-381 lifecycle.
 *
 * Tests TypeScript crypto against the actual Solidity contract on a real EVM,
 * verifying hash-to-G2 parity, BLS pairing checks, and state transitions.
 *
 * Requires: anvil (Foundry), forge build artifacts.
 *
 * Usage:
 *   cd nozk_ts && npx vitest run --config vitest.e2e.config.ts
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { type Abi, type Address, createPublicClient, createWalletClient, getAddress, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bytesToHex, G1_GEN, g1ScalarMul, serializeG1Sol, serializeG2Sol } from './bls12-381-crypto.js';
import {
    blindToken,
    deriveTokenSecrets,
    eip712RedemptionHash,
    generateRedemptionProof,
    mintBlindSign,
    unblindSignature,
    verifyBlsPairing,
} from './nozk-library.js';

// ==============================================================================
// CONSTANTS
// ==============================================================================

const ANVIL_RPC = 'http://127.0.0.1:8545';
const CHAIN_ID = 31337;
const DENOMINATION = parseEther('0.001');
const MINT_SK = 42n;
const MINT_PK = g1ScalarMul(G1_GEN, MINT_SK);

// Anvil default accounts (well-known test keys, not real secrets)
import { DEPLOYER_KEY, DEPOSITOR_KEY, RECIPIENT } from './test-constants.js';

// ==============================================================================
// SETUP
// ==============================================================================

let anvilProcess: ChildProcess;
let publicClient: ReturnType<typeof createPublicClient>;
let deployerWallet: ReturnType<typeof createWalletClient>;
let depositorWallet: ReturnType<typeof createWalletClient>;
let vaultAddress: Address;
let abi: Abi;

const deployer = privateKeyToAccount(DEPLOYER_KEY);
const depositor = privateKeyToAccount(DEPOSITOR_KEY);

async function waitForRpc(timeout = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeout;
    const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
    while (Date.now() < deadline) {
        try {
            await client.getBlockNumber();
            return true;
        } catch {
            await new Promise((r) => setTimeout(r, 100));
        }
    }
    return false;
}

/** Decompress a 96-byte compressed G2 signature to 8 uint256 for Solidity. */
function decompressSigToCoords(
    sigma: Uint8Array,
): readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] {
    const sigPoint = bls12_381.longSignatures.Signature.fromBytes(sigma);
    return serializeG2Sol(sigPoint);
}

/**
 * Typed wrapper for writeContract calls. Viem's strict type inference cannot
 * resolve contract method signatures from a runtime-loaded Abi (as opposed to
 * a compile-time `const` ABI). This wrapper centralises the address/abi/chain
 * and suppresses the unresolvable generics once.
 */
async function writeVault(wallet: any, params: Record<string, any>): Promise<`0x${string}`> {
    return wallet.writeContract({ ...params, address: vaultAddress, abi, chain: foundry });
}

/** Helper: deposit + announce, returns (S, blinded). */
async function depositAndAnnounce(seed: Uint8Array, tokenIndex: number) {
    const secrets = deriveTokenSecrets(seed, tokenIndex);
    const blinded = blindToken(secrets.spendBlsPub, secrets.r);
    const bCoords = [...serializeG2Sol(blinded.B)] as const;
    const depositId = getAddress(secrets.depositId);

    // Deposit
    const depHash = await depositorWallet.writeContract({
        address: vaultAddress,
        abi,
        functionName: 'deposit',
        args: [depositId, bCoords],
        value: DENOMINATION,
    });
    const depReceipt = await publicClient.waitForTransactionReceipt({ hash: depHash });
    expect(depReceipt.status).toBe('success');

    // Announce
    const sPrime = mintBlindSign(blinded.B, MINT_SK);
    const sPrimeCoords = [...serializeG2Sol(sPrime)] as const;
    const annHash = await deployerWallet.writeContract({
        address: vaultAddress,
        abi,
        functionName: 'announce',
        args: [depositId, sPrimeCoords],
    });
    const annReceipt = await publicClient.waitForTransactionReceipt({ hash: annHash });
    expect(annReceipt.status).toBe('success');

    const S = unblindSignature(sPrime, secrets.r);
    return { secrets, blinded, S };
}

beforeAll(async () => {
    // Start anvil
    anvilProcess = spawn('anvil', ['--chain-id', String(CHAIN_ID), '--silent'], {
        stdio: 'ignore',
    });

    const ready = await waitForRpc();
    if (!ready) {
        anvilProcess.kill();
        throw new Error('anvil did not start within 10s');
    }

    // Create clients
    publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
    deployerWallet = createWalletClient({ account: deployer, chain: foundry, transport: http(ANVIL_RPC) });
    depositorWallet = createWalletClient({ account: depositor, chain: foundry, transport: http(ANVIL_RPC) });

    // Load ABI + bytecode from forge artifact
    const artifactPath = resolve('..', 'sol', 'out', 'NozkVaultV2.sol', 'NozkVaultV2.json');
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
    abi = artifact.abi as Abi;
    const bytecode = artifact.bytecode.object as `0x${string}`;

    // Deploy
    const pkCoords = [...serializeG1Sol(MINT_PK)] as const;
    const hash = await (deployerWallet as any).deployContract({
        abi,
        bytecode,
        args: [pkCoords, deployer.address],
        chain: foundry,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe('success');
    vaultAddress = receipt.contractAddress!;
}, 30_000);

afterAll(() => {
    anvilProcess?.kill();
});

// ==============================================================================
// TESTS
// ==============================================================================

describe('NozkVaultV2 E2E on Anvil', () => {
    it('contract deployed correctly', async () => {
        const denom = await publicClient.readContract({ address: vaultAddress, abi, functionName: 'DENOMINATION' });
        expect(denom).toBe(DENOMINATION);

        const authority = await publicClient.readContract({
            address: vaultAddress,
            abi,
            functionName: 'mintAuthority',
        });
        expect((authority as string).toLowerCase()).toBe(deployer.address.toLowerCase());

        const pkCoords = serializeG1Sol(MINT_PK);
        for (let i = 0; i < 4; i++) {
            const val = await publicClient.readContract({
                address: vaultAddress,
                abi,
                functionName: 'pkMint',
                args: [i],
            });
            expect(val).toBe(pkCoords[i]);
        }
    });

    it('full lifecycle: deposit -> announce -> reveal -> redeem', async () => {
        const seed = new TextEncoder().encode('e2e_test_seed_anvil');
        const { secrets, blinded, S } = await depositAndAnnounce(seed, 0);

        // Verify locally
        expect(verifyBlsPairing(S, blinded.Y, MINT_PK)).toBe(true);

        // Reveal
        const spendPubCoords = [...serializeG1Sol(secrets.spendBlsPub)] as const;
        const sCoords = [...serializeG2Sol(S)] as const;
        const revealHash = await writeVault(depositorWallet, {
            functionName: 'reveal',
            args: [spendPubCoords, sCoords],
        });
        const revealReceipt = await publicClient.waitForTransactionReceipt({ hash: revealHash });
        expect(revealReceipt.status).toBe('success');

        // Check nullifier state = REVEALED (1)
        const nid = await publicClient.readContract({
            address: vaultAddress,
            abi,
            functionName: 'nullifierId',
            args: [spendPubCoords],
        });
        const state1 = await publicClient.readContract({
            address: vaultAddress,
            abi,
            functionName: 'nullifierState',
            args: [nid],
        });
        expect(state1).toBe(1);

        // Redeem
        const deadline = (1n << 256n) - 1n;
        const proof = generateRedemptionProof(
            secrets.spendBlsPriv,
            secrets.spendPubCompressed,
            RECIPIENT,
            CHAIN_ID,
            vaultAddress,
            deadline,
        );
        const sigCoords = [...decompressSigToCoords(proof.sigma)] as const;

        const balBefore = await publicClient.getBalance({ address: RECIPIENT });
        const redeemHash = await writeVault(depositorWallet, {
            functionName: 'redeem',
            args: [RECIPIENT, sigCoords, nid, deadline],
        });
        const redeemReceipt = await publicClient.waitForTransactionReceipt({ hash: redeemHash });
        expect(redeemReceipt.status).toBe('success');

        // Check SPENT (2) and balance
        const state2 = await publicClient.readContract({
            address: vaultAddress,
            abi,
            functionName: 'nullifierState',
            args: [nid],
        });
        expect(state2).toBe(2);
        const balAfter = await publicClient.getBalance({ address: RECIPIENT });
        expect(balAfter - balBefore).toBe(DENOMINATION);
    });

    it('double reveal reverts', async () => {
        const seed = new TextEncoder().encode('e2e_test_seed_anvil');
        const { secrets, S } = await depositAndAnnounce(seed, 1);

        const spendPubCoords = [...serializeG1Sol(secrets.spendBlsPub)] as const;
        const sCoords = [...serializeG2Sol(S)] as const;

        // First reveal
        const hash1 = await writeVault(depositorWallet, {
            functionName: 'reveal',
            args: [spendPubCoords, sCoords],
        });
        const r1 = await publicClient.waitForTransactionReceipt({ hash: hash1 });
        expect(r1.status).toBe('success');

        // Second reveal should revert
        await expect(
            depositorWallet.writeContract({
                address: vaultAddress,
                abi,
                functionName: 'reveal',
                args: [spendPubCoords, sCoords],
            }),
        ).rejects.toThrow();
    });

    it('refund before announce succeeds', async () => {
        const seed = new TextEncoder().encode('refund_test_seed');
        const secrets = deriveTokenSecrets(seed, 10);
        const blinded = blindToken(secrets.spendBlsPub, secrets.r);
        const depositId = getAddress(secrets.depositId);

        // Deposit
        const depHash = await writeVault(depositorWallet, {
            functionName: 'deposit',
            args: [depositId, [...serializeG2Sol(blinded.B)]],
            value: DENOMINATION,
        });
        await publicClient.waitForTransactionReceipt({ hash: depHash });

        const pending = await publicClient.readContract({
            address: vaultAddress,
            abi,
            functionName: 'depositPending',
            args: [depositId],
        });
        expect(pending).toBe(true);

        // Refund
        const refHash = await writeVault(depositorWallet, {
            functionName: 'refund',
            args: [depositId],
        });
        const refReceipt = await publicClient.waitForTransactionReceipt({ hash: refHash });
        expect(refReceipt.status).toBe('success');

        const pendingAfter = await publicClient.readContract({
            address: vaultAddress,
            abi,
            functionName: 'depositPending',
            args: [depositId],
        });
        expect(pendingAfter).toBe(false);
    });

    it('refund after announce reverts', async () => {
        const seed = new TextEncoder().encode('refund_after_announce_seed');
        await depositAndAnnounce(seed, 11);
        const secrets = deriveTokenSecrets(seed, 11);
        const depositId = getAddress(secrets.depositId);

        await expect(
            depositorWallet.writeContract({
                address: vaultAddress,
                abi,
                functionName: 'refund',
                args: [depositId],
            }),
        ).rejects.toThrow();
    });

    it('multiple tokens through full lifecycle', async () => {
        const seed = new TextEncoder().encode('multi_token_seed');

        for (let idx = 0; idx < 3; idx++) {
            const { secrets, S } = await depositAndAnnounce(seed, idx);

            // Reveal
            const spendPubCoords = [...serializeG1Sol(secrets.spendBlsPub)] as const;
            const sCoords = [...serializeG2Sol(S)] as const;
            const revHash = await depositorWallet.writeContract({
                address: vaultAddress,
                abi,
                functionName: 'reveal',
                args: [spendPubCoords, sCoords],
            });
            const revReceipt = await publicClient.waitForTransactionReceipt({ hash: revHash });
            expect(revReceipt.status).toBe('success');

            // Redeem
            const nid = await publicClient.readContract({
                address: vaultAddress,
                abi,
                functionName: 'nullifierId',
                args: [spendPubCoords],
            });
            const deadline = (1n << 256n) - 1n;
            const proof = generateRedemptionProof(
                secrets.spendBlsPriv,
                secrets.spendPubCompressed,
                RECIPIENT,
                CHAIN_ID,
                vaultAddress,
                deadline,
            );
            const sigCoords = [...decompressSigToCoords(proof.sigma)] as const;
            const rdmHash = await depositorWallet.writeContract({
                address: vaultAddress,
                abi,
                functionName: 'redeem',
                args: [RECIPIENT, sigCoords, nid, deadline],
            });
            const rdmReceipt = await publicClient.waitForTransactionReceipt({ hash: rdmHash });
            expect(rdmReceipt.status).toBe('success');

            const state = await publicClient.readContract({
                address: vaultAddress,
                abi,
                functionName: 'nullifierState',
                args: [nid],
            });
            expect(state).toBe(2); // SPENT
        }
    });

    it('wrong mint signature reverts on reveal', async () => {
        const seed = new TextEncoder().encode('wrong_mint_seed');
        const secrets = deriveTokenSecrets(seed, 20);
        const blinded = blindToken(secrets.spendBlsPub, secrets.r);
        const depositId = getAddress(secrets.depositId);

        // Deposit
        const depHash = await writeVault(depositorWallet, {
            functionName: 'deposit',
            args: [depositId, [...serializeG2Sol(blinded.B)]],
            value: DENOMINATION,
        });
        await publicClient.waitForTransactionReceipt({ hash: depHash });

        // Announce with WRONG key
        const wrongSk = 999n;
        const sPrimeWrong = mintBlindSign(blinded.B, wrongSk);
        const annHash = await writeVault(deployerWallet, {
            functionName: 'announce',
            args: [depositId, [...serializeG2Sol(sPrimeWrong)]],
        });
        await publicClient.waitForTransactionReceipt({ hash: annHash });

        // Reveal should fail (BLS pairing mismatch)
        const S_wrong = unblindSignature(sPrimeWrong, secrets.r);
        await expect(
            depositorWallet.writeContract({
                address: vaultAddress,
                abi,
                functionName: 'reveal',
                args: [[...serializeG1Sol(secrets.spendBlsPub)], [...serializeG2Sol(S_wrong)]],
            }),
        ).rejects.toThrow();
    });

    it('deposit with wrong value reverts', async () => {
        const seed = new TextEncoder().encode('wrong_value_seed');
        const secrets = deriveTokenSecrets(seed, 30);
        const blinded = blindToken(secrets.spendBlsPub, secrets.r);
        const depositId = getAddress(secrets.depositId);

        await expect(
            depositorWallet.writeContract({
                address: vaultAddress,
                abi,
                functionName: 'deposit',
                args: [depositId, [...serializeG2Sol(blinded.B)]],
                value: parseEther('0.002'), // wrong value
            }),
        ).rejects.toThrow();
    });

    it('deposit id reuse reverts', async () => {
        const seed = new TextEncoder().encode('reuse_test_seed');
        const secrets = deriveTokenSecrets(seed, 40);
        const blinded = blindToken(secrets.spendBlsPub, secrets.r);
        const depositId = getAddress(secrets.depositId);

        // First deposit
        const hash1 = await writeVault(depositorWallet, {
            functionName: 'deposit',
            args: [depositId, [...serializeG2Sol(blinded.B)]],
            value: DENOMINATION,
        });
        const r1 = await publicClient.waitForTransactionReceipt({ hash: hash1 });
        expect(r1.status).toBe('success');

        // Second deposit with same ID should revert
        await expect(
            depositorWallet.writeContract({
                address: vaultAddress,
                abi,
                functionName: 'deposit',
                args: [depositId, [...serializeG2Sol(blinded.B)]],
                value: DENOMINATION,
            }),
        ).rejects.toThrow();
    });

    it('nullifier state transitions: UNREVEALED -> REVEALED -> SPENT', async () => {
        const seed = new TextEncoder().encode('state_transition_seed');
        const secrets = deriveTokenSecrets(seed, 50);
        const spendPubCoords = [...serializeG1Sol(secrets.spendBlsPub)] as const;

        const nid = await publicClient.readContract({
            address: vaultAddress,
            abi,
            functionName: 'nullifierId',
            args: [spendPubCoords],
        });

        // UNREVEALED (0)
        expect(
            await publicClient.readContract({
                address: vaultAddress,
                abi,
                functionName: 'nullifierState',
                args: [nid],
            }),
        ).toBe(0);

        // Deposit + announce + reveal
        const { S } = await depositAndAnnounce(seed, 50);
        const revHash = await writeVault(depositorWallet, {
            functionName: 'reveal',
            args: [spendPubCoords, [...serializeG2Sol(S)]],
        });
        const revReceipt = await publicClient.waitForTransactionReceipt({ hash: revHash });
        expect(revReceipt.status).toBe('success');

        // REVEALED (1)
        expect(
            await publicClient.readContract({
                address: vaultAddress,
                abi,
                functionName: 'nullifierState',
                args: [nid],
            }),
        ).toBe(1);

        // Redeem
        const deadline = (1n << 256n) - 1n;
        const proof = generateRedemptionProof(
            secrets.spendBlsPriv,
            secrets.spendPubCompressed,
            RECIPIENT,
            CHAIN_ID,
            vaultAddress,
            deadline,
        );
        const sigCoords = [...decompressSigToCoords(proof.sigma)] as const;
        const rdmHash = await writeVault(depositorWallet, {
            functionName: 'redeem',
            args: [RECIPIENT, sigCoords, nid, deadline],
        });
        const rdmReceipt = await publicClient.waitForTransactionReceipt({ hash: rdmHash });
        expect(rdmReceipt.status).toBe('success');

        // SPENT (2)
        expect(
            await publicClient.readContract({
                address: vaultAddress,
                abi,
                functionName: 'nullifierState',
                args: [nid],
            }),
        ).toBe(2);
    });

    it('eip712 hash matches solidity', async () => {
        const deadline = (1n << 256n) - 1n;

        // TypeScript computation
        const tsHash = eip712RedemptionHash(RECIPIENT, deadline, CHAIN_ID, vaultAddress);

        // Solidity computation
        const solHash = await publicClient.readContract({
            address: vaultAddress,
            abi,
            functionName: 'redemptionMessageHash',
            args: [RECIPIENT, deadline],
        });

        expect(`0x${bytesToHex(tsHash)}`).toBe(solHash);
    });
});
