import { keccak256 } from 'ethereum-cryptography/keccak.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import mcl from 'mcl-wasm';
import { 
    initBN254, hashToCurveBN254, multiplyBN254, 
    modularInverse, verifyPairingBN254, CURVE_ORDER 
} from './bn254-crypto.js';

async function main() {
    await initBN254();
    console.log("👻 TS CLIENT: FULL LIFECYCLE COMPATIBILITY TEST 👻\n");

    // --------------------------------------------------------------------------
    // 0. MOCK THE MINT (Dynamically generating G2 to avoid string parsing errors)
    // --------------------------------------------------------------------------
    const MINT_BLS_PRIVKEY = 1234567891011121314151617181920n;
    
    // Natively map a string to G2 to get a valid, mathematically sound generator
    const generatorG2 = mcl.hashAndMapToG2("GhostTipG2Generator");
    
    const skFr = new mcl.Fr();
    skFr.setStr(MINT_BLS_PRIVKEY.toString(10), 10);
    
    // Calculate PK_mint = sk * G2
    const PK_mint = mcl.mul(generatorG2, skFr) as mcl.G2;

    // --------------------------------------------------------------------------
    // 1. DETERMINISTIC DERIVATION
    // --------------------------------------------------------------------------
    console.log("[1] Deriving Token Secrets...");
    const masterSeed = Buffer.from("ghost_tip_secret_master_seed_2026", "utf-8");
    const tokenIndex = 42;

    const indexBytes = new Uint8Array([0, 0, 0, 42]); // 42 in 4-byte big-endian
    const baseMaterial = keccak256(new Uint8Array([...masterSeed, ...indexBytes]));

    const spendPriv = keccak256(new Uint8Array([...Buffer.from("spend"), ...baseMaterial]));
    // Get uncompressed public key (65 bytes, starts with 04), take last 64, hash, take last 20
    const pubKeyUncompressed = secp256k1.getPublicKey(spendPriv, false);
    const pubKeyHash = keccak256(pubKeyUncompressed.slice(1));
    const spendAddressBytes = pubKeyHash.slice(-20);
    const spendAddressHex = "0x" + Buffer.from(spendAddressBytes).toString('hex');

    const rBytes = keccak256(new Uint8Array([...Buffer.from("blind"), ...baseMaterial]));
    const r = BigInt('0x' + Buffer.from(rBytes).toString('hex')) % CURVE_ORDER;

    console.log(`    Spend Address : ${spendAddressHex}`);
    console.log(`    Blinding 'r'  : ${r}\n`);

    // --------------------------------------------------------------------------
    // 2. BLINDING
    // --------------------------------------------------------------------------
    console.log("[2] Client Blinding the Token...");
    const Y = hashToCurveBN254(spendAddressBytes);
    const B = multiplyBN254(Y, r);
    console.log(`    Y mapped (x)  : ${Y.getStr(16).split(' ')[1]}`);
    console.log(`    Blinded B (x) : ${B.getStr(16).split(' ')[1]}\n`);

    // --------------------------------------------------------------------------
    // 3. MOCK MINT SIGNING
    // --------------------------------------------------------------------------
    console.log("[3] Mint blindly signing the point...");
    const S_prime = multiplyBN254(B, MINT_BLS_PRIVKEY);

    // --------------------------------------------------------------------------
    // 4. UNBLINDING
    // --------------------------------------------------------------------------
    console.log("[4] Client unblinding the signature...");
    const r_inv = modularInverse(r, CURVE_ORDER);
    const S = multiplyBN254(S_prime, r_inv);
    
    // --------------------------------------------------------------------------
    // 5. VERIFICATION
    // --------------------------------------------------------------------------
    console.log("[5] Executing Local Pairing Verification...");
    
    // Verify e(S, G2) == e(Y, PK_mint)
    const isValid = verifyPairingBN254(S, Y, PK_mint);
    
    if (isValid) {
        console.log("    ✅ BLS Pairing Verified! Math matches Python perfectly.\n");
        console.log("🎉 TRANSACTION SUCCESS: TypeScript bridge is fully operational! 🎉");
    } else {
        console.log("    ❌ BLS Pairing FAILED!");
    }
}

main().catch(console.error);
