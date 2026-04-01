import 'dotenv/config';
import mcl from 'mcl-wasm';
import { bytesToHex, CURVE_ORDER, getG2Generator, initBN254 } from './bn254-crypto.js';
import * as gl from './nozk-library.js';

// ==============================================================================
// FORMATTING HELPERS
// ==============================================================================

function printG1(name: string, point: mcl.G1) {
    const coords = point.getStr(16).split(' ');
    console.log(`    ${name} (X) : ${coords[1]}`);
    console.log(`    ${name} (Y) : ${coords[2]}`);
}

function printG2(name: string, point: mcl.G2) {
    const coords = point.getStr(16).split(' ');
    // mcl G2 getStr(16) returns: "1 X_real X_imag Y_real Y_imag"
    console.log(`    ${name} (X_real) : ${coords[1]}`);
    console.log(`    ${name} (X_imag) : ${coords[2]}`);
    console.log(`    ${name} (Y_real) : ${coords[3]}`);
    console.log(`    ${name} (Y_imag) : ${coords[4]}`);
}

// ==============================================================================
// MAIN
// ==============================================================================

async function main() {
    await initBN254();
    console.log('👻 TS CLIENT: FULL LIFECYCLE TEST (.ENV ENABLED) 👻\n');

    // ── 0. Mint setup ────────────────────────────────────────────────────────
    console.log('[0] Loading Mint Configuration from .env...');
    const skHex = process.env.MINT_BLS_PRIVKEY || process.env.MINT_BLS_PRIVKEY_INT;
    if (!skHex || !process.env.MASTER_SEED) {
        throw new Error('Missing MINT_BLS_PRIVKEY and/or MASTER_SEED in .env. Run generate_keys.py first.');
    }

    const skMint = BigInt(skHex.startsWith('0x') ? skHex : `0x${skHex}`) % CURVE_ORDER;

    // Derive PK_mint = sk · G2 using the standard BN254 generator
    const g2 = getG2Generator();
    const skFr = new mcl.Fr();
    skFr.setStr(skMint.toString(10), 10);
    const pkMint = mcl.mul(g2, skFr) as mcl.G2;

    console.log('    ✅ Mint Keys loaded securely.');
    printG2('PK_mint', pkMint);
    console.log();

    // ── 1. Token derivation ──────────────────────────────────────────────────
    console.log("[1] Deriving Token Secrets (User's Wallet)...");
    const masterSeed = new TextEncoder().encode(process.env.MASTER_SEED!);
    const tokenIndex = 42;

    const secrets = gl.deriveTokenSecrets(masterSeed, tokenIndex);

    console.log(`    Token Index        : ${tokenIndex}`);
    console.log(`    Spend address      : ${gl.getSpendAddress(secrets)}  (nullifier — revealed at redemption)`);
    console.log(`    Spend pub          : ${secrets.spend.pubHex.slice(0, 20)}...`);
    console.log(`    Blind address      : ${gl.getDepositId(secrets)}  (deposit ID — revealed at deposit)`);
    console.log(`    Blind pub          : ${secrets.blind.pubHex.slice(0, 20)}...`);
    console.log(`    Blinding scalar r  : 0x${gl.getR(secrets).toString(16)}`);
    console.log();

    // ── 2. Blinding ──────────────────────────────────────────────────────────
    console.log('[2] Client Blinding the Token...');
    const blinded = gl.blindToken(gl.getSpendAddressBytes(secrets), gl.getR(secrets));

    printG1('Y = H(spend_addr)', blinded.Y);
    printG1('B = r·Y (blinded)', blinded.B);
    console.log(`    Deposit ID (blind address) : ${gl.getDepositId(secrets)}`);
    console.log('    B + deposit_id sent to contract.\n');

    // ── 3. Blind signing ─────────────────────────────────────────────────────
    console.log('[3] Mint blindly signing the point...');
    const S_prime = gl.mintBlindSign(blinded.B, skMint);

    printG1("S' = sk·B (blind sig)", S_prime);
    console.log("    S' announced on-chain.\n");

    // ── 4. Unblinding ────────────────────────────────────────────────────────
    console.log('[4] Client unblinding the signature...');
    const S = gl.unblindSignature(S_prime, gl.getR(secrets));

    printG1("S = S'·r⁻¹ (token)", S);
    console.log('    Valid token (spend_address, S) obtained.\n');

    // ── 5. Redemption proof ──────────────────────────────────────────────────
    console.log('[5] Generating Redemption Proof for Smart Contract...');
    const destination = '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7';
    const chainId = Number(process.env.CHAIN_ID || '11155111');
    const contractAddress = process.env.CONTRACT_ADDRESS || '0x00000000000000000000000000000000DeaDBeef';
    const deadline = BigInt(2 ** 256) - 1n;
    const proof = await gl.generateRedemptionProof(
        gl.getSpendPriv(secrets),
        destination,
        chainId,
        contractAddress,
        deadline,
    );

    console.log(`    Destination      : ${destination}`);
    console.log(`    msg_hash         : ${bytesToHex(proof.msgHash)}`);
    console.log(`    compact_hex      : 0x${proof.compactHex}`);
    console.log(`    recovery_bit     : ${proof.recoveryBit}`);
    console.log();

    // ── 6. Verification ──────────────────────────────────────────────────────
    console.log('[6] EVM Verification (Redemption Transaction)...');

    // A. ECDSA MEV protection check
    const ecdsaOk = gl.verifyEcdsaMevProtection(proof, gl.getSpendAddress(secrets));
    console.log(`    [ecrecover] → ${gl.getSpendAddress(secrets)}`);
    if (!ecdsaOk) {
        throw new Error('ECDSA verification failed!');
    }
    console.log('    ✅ MEV Protection Verified!');

    // B. BLS pairing check
    const blsOk = gl.verifyBlsPairing(S, blinded.Y, pkMint);
    if (!blsOk) {
        throw new Error('BLS pairing failed!');
    }
    console.log('    ✅ BLS Pairing Verified! Mathematical proof is flawless.');

    console.log('\n🎉 TRANSACTION SUCCESS: TypeScript bridge is fully operational! 🎉');
}

main().catch(console.error);
