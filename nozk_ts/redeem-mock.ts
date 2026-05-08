/**
 * MockRedeemer — offline contract verifier for testing.
 *
 * TypeScript equivalent of Python's redeem_mock.py.
 * Simulates the NozkVault contract's reveal() and redeem() checks
 * without any on-chain interaction.
 */

import {
    abiEncodeG1,
    blsVerify,
    bytesToHex,
    G1_GEN,
    type G1Point,
    type G2Point,
    g1ScalarMul,
    hashToG2,
    nullifierId,
    verifyMintPairing,
} from './bls12-381-crypto.js';
import { eip712RedemptionHash } from './nozk-library.js';

export enum NullifierState {
    UNREVEALED = 'UNREVEALED',
    REVEALED = 'REVEALED',
    SPENT = 'SPENT',
}

export interface RevealResult {
    success: boolean;
    nullifierId: string;
    blsPairingOk: boolean;
    reason?: string;
}

export interface RedeemResult {
    success: boolean;
    recipient: string;
    nullifierId?: string;
    blsSpendOk: boolean;
    nullifierSpent: boolean;
    reason?: string;
}

export class MockRedeemer {
    readonly pkMint: G1Point;
    private nullifierStates: Map<string, NullifierState> = new Map();

    constructor(pkMint: G1Point) {
        this.pkMint = pkMint;
    }

    static fromSk(sk: bigint): MockRedeemer {
        const pk = g1ScalarMul(G1_GEN, sk);
        return new MockRedeemer(pk);
    }

    reveal(spendPub: G1Point, S: G2Point): RevealResult {
        const nid = bytesToHex(nullifierId(spendPub));
        const result: RevealResult = { success: false, nullifierId: nid, blsPairingOk: false };

        const state = this.nullifierStates.get(nid) ?? NullifierState.UNREVEALED;
        if (state !== NullifierState.UNREVEALED) {
            result.reason = `Nullifier already ${state}`;
            return result;
        }

        const Y = hashToG2(abiEncodeG1(spendPub));
        result.blsPairingOk = verifyMintPairing(S, Y, this.pkMint);
        if (!result.blsPairingOk) {
            result.reason = 'BLS mint pairing check failed';
            return result;
        }

        this.nullifierStates.set(nid, NullifierState.REVEALED);
        result.success = true;
        return result;
    }

    redeem(params: {
        recipient: string;
        sigma: Uint8Array;
        spendPubCompressed: Uint8Array;
        nullifierId: string;
        chainId: number;
        contractAddress: string;
        deadline: bigint;
    }): RedeemResult {
        const result: RedeemResult = {
            success: false,
            recipient: params.recipient,
            nullifierId: params.nullifierId,
            blsSpendOk: false,
            nullifierSpent: false,
        };

        const state = this.nullifierStates.get(params.nullifierId) ?? NullifierState.UNREVEALED;
        if (state === NullifierState.SPENT) {
            result.nullifierSpent = true;
            result.reason = 'Token already spent';
            return result;
        }
        if (state !== NullifierState.REVEALED) {
            result.reason = `Nullifier not revealed (state: ${state})`;
            return result;
        }

        const msgHash = eip712RedemptionHash(params.recipient, params.deadline, params.chainId, params.contractAddress);
        result.blsSpendOk = blsVerify(params.sigma, msgHash, params.spendPubCompressed);
        if (!result.blsSpendOk) {
            result.reason = 'BLS spend signature verification failed';
            return result;
        }

        this.nullifierStates.set(params.nullifierId, NullifierState.SPENT);
        result.success = true;
        return result;
    }

    getState(nid: string): NullifierState {
        return this.nullifierStates.get(nid) ?? NullifierState.UNREVEALED;
    }

    isSpent(nid: string): boolean {
        return this.getState(nid) === NullifierState.SPENT;
    }

    isRevealed(nid: string): boolean {
        return this.getState(nid) === NullifierState.REVEALED;
    }

    reset(): void {
        this.nullifierStates.clear();
    }
}
