import mcl from 'mcl-wasm';
import { keccak256 } from 'ethereum-cryptography/keccak.js';

// BN254 Curve Constants
export const FIELD_MODULUS = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
export const CURVE_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Must be called when the app starts to load the WASM binary.
 */
export async function initBN254() {
    await mcl.init(mcl.BN_SNARK1);
}

// --- BigInt Math Helpers ---
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    let res = 1n;
    base = base % mod;
    while (exp > 0n) {
        if (exp % 2n === 1n) res = (res * base) % mod;
        exp = exp / 2n;
        base = (base * base) % mod;
    }
    return res;
}

export function modularInverse(k: bigint, mod: bigint): bigint {
    // Fermat's Little Theorem: k^(mod - 2) % mod
    return modPow(k, mod - 2n, mod);
}

// --- Protocol Helpers ---

/**
 * 1:1 Port of the Python Try-And-Increment Hash to Curve
 */
export function hashToCurveBN254(messageBytes: Uint8Array): mcl.G1 {
    let counter = 0;
    while (true) {
        // Append 4-byte big-endian counter
        const counterBytes = new Uint8Array([
            (counter >> 24) & 255,
            (counter >> 16) & 255,
            (counter >> 8) & 255,
            counter & 255
        ]);
        
        const payload = new Uint8Array([...messageBytes, ...counterBytes]);
        const h = keccak256(payload);
        
        const x = BigInt('0x' + Buffer.from(h).toString('hex')) % FIELD_MODULUS;
        const y_squared = (modPow(x, 3n, FIELD_MODULUS) + 3n) % FIELD_MODULUS;
        
        // Euler's criterion
        if (modPow(y_squared, (FIELD_MODULUS - 1n) / 2n, FIELD_MODULUS) === 1n) {
            const y = modPow(y_squared, (FIELD_MODULUS + 1n) / 4n, FIELD_MODULUS);
            
            // Load into mcl-wasm G1 Point
            const point = new mcl.G1();
            // mcl expects base 16 strings in format "1 <x> <y>"
            point.setStr(`1 ${x.toString(16)} ${y.toString(16)}`, 16);
            return point;
        }
        counter++;
    }
}

/**
 * Multiplies a G1 Point by a Scalar
 */

export function multiplyBN254(point: mcl.G1, scalar: bigint): mcl.G1 {
    const fr = new mcl.Fr();
    fr.setStr(scalar.toString(16), 16);
    return mcl.mul(point, fr) as mcl.G1; // Returns the point directly
}

/**
 * Verifies e(S, G2) == e(Y, PK_mint)
 */
export function verifyPairingBN254(S: mcl.G1, Y: mcl.G1, PK_mint: mcl.G2): boolean {
    const generatorG2 = new mcl.G2();
    // Standard generator for BN254 G2 (alt_bn128)
    generatorG2.setStr("1 1800deef121f1e76b4edb22031d2e05f00ce18a221f7ee33989cce7fa15f8a00 198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2 12c85ea5db8c6def483af156cb8cb8ce8ff948d11d4e0e5a9101ed8fb8a614bb 2b14be26bd96b40285a210515e012e2c88f121eb3e0b74100fc77d079422a578", 16);

    // Calculate pairings
    const e1 = mcl.pairing(S, generatorG2);
    const e2 = mcl.pairing(Y, PK_mint);

    return e1.isEqual(e2);
}

/**
 * Formats mcl.G1 point to [uint256, uint256] array for Solidity
 */
export function formatG1ForSolidity(point: mcl.G1): [string, string] {
    const hexStr = point.getStr(16).substring(2); // remove "1 " prefix
    const parts = hexStr.split(' ');
    // Return base 10 strings for ethers.js/viem
    return [
        BigInt('0x' + parts[0]).toString(10),
        BigInt('0x' + parts[1]).toString(10)
    ];
}
