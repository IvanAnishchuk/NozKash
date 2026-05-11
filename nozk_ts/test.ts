/**
 * Nozk Protocol: Full Lifecycle Smoke Test (BLS12-381)
 *
 * Runs through the complete token lifecycle using values from .env:
 *   1. Load mint keys
 *   2. Derive token secrets
 *   3. Blind token (G2)
 *   4. Mint blind sign
 *   5. Unblind signature
 *   6. Generate BLS spend signature (AugSchemeMPL)
 *   7. Verify BLS pairing + BLS spend signature
 *
 * Usage:
 *   npx tsx test.ts
 */

import 'dotenv/config';
import { bytesToHex, CURVE_ORDER, G1_GEN, g1ScalarMul, serializeG1Sol, serializeG2Sol } from './bls12-381-crypto.js';
import * as gl from './nozk-library.js';

// ==============================================================================
// FORMATTING HELPERS
// ==============================================================================

function printG1(name: string, coords: [bigint, bigint, bigint, bigint]) {
    console.log(`    ${name} (x_hi) : ${coords[0].toString(16)}`);
    console.log(`    ${name} (x_lo) : ${coords[1].toString(16)}`);
    console.log(`    ${name} (y_hi) : ${coords[2].toString(16)}`);
    console.log(`    ${name} (y_lo) : ${coords[3].toString(16)}`);
}

function printG2(name: string, coords: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]) {
    console.log(`    ${name} (x_c0_hi) : ${coords[0].toString(16)}`);
    console.log(`    ${name} (x_c0_lo) : ${coords[1].toString(16)}`);
    console.log(`    ${name} (x_c1_hi) : ${coords[2].toString(16)}`);
    console.log(`    ${name} (x_c1_lo) : ${coords[3].toString(16)}`);
    console.log(`    ${name} (y_c0_hi) : ${coords[4].toString(16)}`);
    console.log(`    ${name} (y_c0_lo) : ${coords[5].toString(16)}`);
    console.log(`    ${name} (y_c1_hi) : ${coords[6].toString(16)}`);
    console.log(`    ${name} (y_c1_lo) : ${coords[7].toString(16)}`);
}

// ==============================================================================
// MAIN
// ==============================================================================

function main() {
    console.log('NOZK TS: FULL LIFECYCLE TEST (BLS12-381, .ENV ENABLED)\n');

    // -- 0. Mint setup --------------------------------------------------------
    console.log('[0] Loading Mint Configuration from .env...');
    const skHex = process.env.MINT_BLS_PRIVKEY;
    if (!skHex || !process.env.MASTER_SEED) {
        throw new Error('Missing MINT_BLS_PRIVKEY and/or MASTER_SEED in .env. Run generate_keys.py first.');
    }

    const skMint = BigInt(skHex.startsWith('0x') ? skHex : `0x${skHex}`) % CURVE_ORDER;

    // Derive PK_mint = sk * G1_gen (standard BLS: PK in G1)
    const pkMint = g1ScalarMul(G1_GEN, skMint);

    console.log('    Mint Keys loaded securely.');
    printG1('PK_mint', serializeG1Sol(pkMint));
    console.log();

    // -- 1. Token derivation --------------------------------------------------
    console.log("[1] Deriving Token Secrets (User's Wallet)...");
    const masterSeed = new TextEncoder().encode(process.env.MASTER_SEED!);
    const tokenIndex = 42;

    const secrets = gl.deriveTokenSecrets(masterSeed, tokenIndex);

    console.log(`    Token Index        : ${tokenIndex}`);
    console.log(`    Nullifier ID       : 0x${gl.getNullifierIdHex(secrets)}`);
    console.log(`    Spend pub (compr)  : ${bytesToHex(secrets.spendPubCompressed).slice(0, 20)}...`);
    console.log(`    Deposit ID         : ${gl.getDepositId(secrets)}`);
    console.log(`    Blinding scalar r  : 0x${secrets.r.toString(16)}`);
    console.log();

    // -- 2. Blinding ----------------------------------------------------------
    console.log('[2] Client Blinding the Token...');
    const blinded = gl.blindToken(secrets.spendBlsPub, secrets.r);

    printG2('Y = H(spendPub)', serializeG2Sol(blinded.Y));
    printG2('B = r*Y (blinded)', serializeG2Sol(blinded.B));
    console.log(`    Deposit ID : ${gl.getDepositId(secrets)}`);
    console.log('    B + deposit_id sent to contract.\n');

    // -- 3. Blind signing -----------------------------------------------------
    console.log('[3] Mint blindly signing the point...');
    const S_prime = gl.mintBlindSign(blinded.B, skMint);

    printG2("S' = sk*B (blind sig)", serializeG2Sol(S_prime));
    console.log("    S' announced on-chain.\n");

    // -- 4. Unblinding --------------------------------------------------------
    console.log('[4] Client unblinding the signature...');
    const S = gl.unblindSignature(S_prime, secrets.r);

    printG2("S = S'*r^-1 (token)", serializeG2Sol(S));
    console.log('    Valid token (nullifier, S) obtained.\n');

    // -- 5. Redemption proof --------------------------------------------------
    console.log('[5] Generating BLS Spend Signature for Redemption...');
    const destination = '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7';
    const chainId = Number(process.env.CHAIN_ID || '11155111');
    const contractAddress = process.env.CONTRACT_ADDRESS || '0x00000000000000000000000000000000DeaDBeef';
    const deadline = 2n ** 256n - 1n;
    const proof = gl.generateRedemptionProof(
        secrets.spendBlsPriv,
        secrets.spendPubCompressed,
        destination,
        chainId,
        contractAddress,
        deadline,
    );

    console.log(`    Destination      : ${destination}`);
    console.log(`    msg_hash         : ${bytesToHex(proof.msgHash)}`);
    console.log(`    sigma (compr)    : ${bytesToHex(proof.sigma).slice(0, 40)}...`);
    console.log(`    spend_pub (compr): ${bytesToHex(proof.spendPubCompressed).slice(0, 40)}...`);
    console.log();

    // -- 6. Verification ------------------------------------------------------
    console.log('[6] Verification...');

    // A. BLS spend signature check (AugSchemeMPL)
    const blsSpendOk = gl.verifyBlsSpendSignature(proof);
    console.log(`    [BLS spend sig] valid = ${blsSpendOk}`);
    if (!blsSpendOk) {
        throw new Error('BLS spend signature verification failed!');
    }
    console.log('    BLS Spend Signature Verified!');

    // B. BLS pairing check (mint blind signature)
    const blsPairingOk = gl.verifyBlsPairing(S, blinded.Y, pkMint);
    if (!blsPairingOk) {
        throw new Error('BLS pairing failed!');
    }
    console.log('    BLS Pairing Verified! Mathematical proof is flawless.');

    console.log('\nTRANSACTION SUCCESS: TypeScript BLS12-381 bridge is fully operational!');
}

main();
