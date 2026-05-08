/**
 * MockMint — offline blind signature authority for testing.
 *
 * TypeScript equivalent of Python's mint_mock.py.
 * Signs blinded G2 points without any on-chain interaction.
 */

import { CURVE_ORDER, type G2Point, serializeG2Sol } from './bls12-381-crypto.js';
import { mintBlindSign, NozkError } from './nozk-library.js';

export class MockMintError extends NozkError {}

export class MockMint {
    readonly sk: bigint;

    private constructor(sk: bigint) {
        this.sk = sk;
    }

    static fromSk(sk: bigint): MockMint {
        if (sk <= 0n || sk >= CURVE_ORDER) {
            throw new MockMintError(`BLS scalar must be in (0, CURVE_ORDER), got ${sk}`);
        }
        return new MockMint(sk);
    }

    static fromHex(hex: string): MockMint {
        const cleaned = hex.startsWith('0x') ? hex : `0x${hex}`;
        let sk: bigint;
        try {
            sk = BigInt(cleaned);
        } catch {
            throw new MockMintError(`Invalid hex scalar: ${hex}`);
        }
        return MockMint.fromSk(sk);
    }

    /** S' = sk · B */
    sign(B: G2Point): G2Point {
        return mintBlindSign(B, this.sk);
    }

    /** S' serialized as 8 uint256 (for Solidity). */
    signAndSerialize(B: G2Point): [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] {
        return serializeG2Sol(this.sign(B));
    }
}
