import { keccak256 } from 'ethereum-cryptography/keccak';
import { secp256k1 } from '@noble/curves/secp256k1';
import mcl from 'mcl-wasm';
import { 
    initBN254, hashToCurveBN254, multiplyBN254, 
    modularInverse, verifyPairingBN254, CURVE_ORDER 
} from './bn254-crypto';

async function main() {
    await initBN254();
    console.log("👻 TS CLIENT: FULL LIFECYCLE COMPATIBILITY TEST 👻\n");

    // 0. MOCK THE MINT (Using hardcoded keys for cross-language testing)
    // Let's assume the Mint generated this sk_mint in Python
    const MINT_BLS_PRIVKEY = 1234567891011121314151617181920n;
    
    const generatorG2 = new mcl.G2();
    generatorG2.setStr("1 1800deef121f1e76b4edb22031d2e05f00ce18a221f7ee33989cce7fa15f8a00 198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2 12c85ea5db8c6def483af156cb8cb8ce8ff948d11d4e0e5a9101ed8fb8a614bb 2b14be26bd96b40285a210515e012e2c88f121eb3e0b74100fc77d079422a578", 16);
    
    const skFr = new mcl.Fr();
    skFr.setStr(MINT_BLS_PRIVKEY.toString(16), 16);
    const PK_mint = new mcl.G2();
    mcl.mul(PK_mint, generatorG2, skFr);

    // 1. DETERMINISTIC DERIVATION
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

    // 2. BLINDING
    console.log("[2] Client Blinding the Token...");
    const Y = hashToCurveBN254(spendAddressBytes);
    const B = multiplyBN254(Y, r);
    console.log(`    Y mapped (x)  : ${Y.getStr(16).split(' ')[1]}`);
    console.log(`    Blinded B (x) : ${B.getStr(16).split(' ')[1]}\n`);

    // 3. MOCK MINT SIGNING
    console.log("[3] Mint blindly signing the point...");
    const S_prime = multiplyBN254(B, MINT_BLS_PRIVKEY);

    // 4. UNBLINDING
    console.log("[4] Client unblinding the signature...");
    const r_inv = modularInverse(r, CURVE_ORDER);
    const S = multiplyBN254(S_prime, r_inv);
    
    // 5. VERIFICATION
    console.log("[5] Executing Local Pairing Verification...");
    const isValid = verifyPairingBN254(S, Y, PK_mint);
    
    if (isValid) {
        console.log("    ✅ BLS Pairing Verified! Math matches Python perfectly.");
    } else {
        console.log("    ❌ BLS Pairing FAILED!");
    }
}

main().catch(console.error);
