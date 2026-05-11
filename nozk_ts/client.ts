/**
 * Nozk Protocol: TypeScript CLI Client (BLS12-381)
 *
 * TypeScript equivalent of client.py. Interacts with the deployed NozkVaultV2
 * contract on Sepolia using viem for chain interaction.
 *
 * Commands:
 *   deposit   Blind a token and submit a deposit transaction
 *   scan      Scan chain events to find and recover pending/spendable tokens
 *   reveal    Submit reveal() to register nullifier + BLS on-chain
 *   redeem    Submit redeem() to transfer funds to recipient
 *   balance   Query on-chain ETH balance
 *
 * Usage:
 *   npx tsx client.ts deposit --index 0
 *   npx tsx client.ts scan
 *   npx tsx client.ts reveal --index 0
 *   npx tsx client.ts redeem --index 0 --to 0xRecipient
 *   npx tsx client.ts balance
 */

import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: resolve('..', '.env') });

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    type Address,
    createPublicClient,
    createWalletClient,
    defineChain,
    formatEther,
    getAddress,
    type Hex,
    http,
    parseEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
    bytesToHex,
    CURVE_ORDER,
    G1_GEN,
    type G1Point,
    g1ScalarMul,
    hexToBigint,
    parseG1Sol,
    parseG2Sol,
    serializeG1Sol,
    serializeG2Sol,
} from './bls12-381-crypto.js';
import * as gl from './nozk-library.js';

// ==============================================================================
// CONFIG
// ==============================================================================

const DENOMINATION = parseEther('0.001');
const WALLET_STATE_FILE = process.env.NOZK_WALLET_STATE_FILE || resolve('..', '.nozk_wallet.json');
const ABI_PATH = process.env.NOZK_VAULT_ABI_PATH || resolve('..', 'abi', 'nozk_vault_v2_abi.json');

interface Config {
    masterSeed: Uint8Array;
    walletKey: Hex;
    walletAddress: Address;
    contractAddress: Address;
    rpcUrl: string;
    scanFromBlock: bigint;
    mintBlsPubkey: G1Point | null; // G1 in standard BLS scheme
}

function loadConfig(): Config {
    const seed = process.env.MASTER_SEED;
    if (!seed) throw new Error('Missing MASTER_SEED in .env');

    const walletKey = process.env.WALLET_KEY;
    const walletAddr = process.env.WALLET_ADDRESS;
    const contract = process.env.CONTRACT_ADDRESS;
    const rpc = process.env.RPC_HTTP_URL;

    if (!walletKey || !walletAddr || !contract || !rpc) {
        throw new Error('Missing WALLET_KEY, WALLET_ADDRESS, CONTRACT_ADDRESS, or RPC_HTTP_URL in .env');
    }

    // Parse mint BLS pubkey from env (4 uint256 = G1 in EIP-2537 format)
    let mintBlsPubkey: G1Point | null = null;
    const pkStr = process.env.MINT_BLS_PUBKEY || '';
    if (pkStr) {
        const parts = pkStr.split(',').map((p) => p.trim());
        if (parts.length === 4) {
            // G1 point as 4 uint256: [x_hi, x_lo, y_hi, y_lo]
            mintBlsPubkey = parseG1Sol(
                hexToBigint(parts[0]),
                hexToBigint(parts[1]),
                hexToBigint(parts[2]),
                hexToBigint(parts[3]),
            );
        }
    }
    // Fallback: derive from privkey
    if (!mintBlsPubkey) {
        const skHex = process.env.MINT_BLS_PRIVKEY || '';
        if (skHex) {
            const sk = BigInt(skHex.startsWith('0x') ? skHex : `0x${skHex}`) % CURVE_ORDER;
            mintBlsPubkey = g1ScalarMul(G1_GEN, sk);
        }
    }

    const key = walletKey.startsWith('0x') ? (walletKey as Hex) : (`0x${walletKey}` as Hex);

    return {
        masterSeed: Buffer.from(seed, 'utf-8'),
        walletKey: key,
        walletAddress: getAddress(walletAddr),
        contractAddress: getAddress(contract),
        rpcUrl: rpc,
        scanFromBlock: BigInt(process.env.SCAN_FROM_BLOCK || '0'),
        mintBlsPubkey,
    };
}

// ==============================================================================
// WALLET STATE
// ==============================================================================

interface TokenRecord {
    index: number;
    nullifier_id: string | null;
    deposit_id: string;
    deposit_tx: string | null;
    deposit_block: number | null;
    // Unblinded mint signature S (G2) stored as 8 hex uint256
    s_unblinded: string[] | null;
    reveal_tx: string | null;
    redeem_tx: string | null;
    spent: boolean;
}

interface WalletState {
    tokens: Record<string, TokenRecord>;
    last_scanned_block: number;
}

function loadWalletState(): WalletState {
    if (!existsSync(WALLET_STATE_FILE)) {
        return { tokens: {}, last_scanned_block: 0 };
    }
    return JSON.parse(readFileSync(WALLET_STATE_FILE, 'utf-8'));
}

function saveWalletState(state: WalletState): void {
    writeFileSync(WALLET_STATE_FILE, JSON.stringify(state, null, 2));
}

function tokenStatus(rec: TokenRecord): string {
    if (rec.spent) return 'SPENT';
    if (rec.redeem_tx) return 'REDEEMED';
    if (rec.reveal_tx) return 'REVEALED';
    if (rec.s_unblinded) return 'READY_TO_REVEAL';
    if (rec.deposit_tx) return 'AWAITING_MINT';
    return 'FRESH';
}

// ==============================================================================
// CONTRACT ABI
// ==============================================================================

const NOZK_VAULT_ABI = JSON.parse(readFileSync(ABI_PATH, 'utf-8'));

// ==============================================================================
// HELPERS
// ==============================================================================

function log(msg: string) {
    console.log(`  ${msg}`);
}
function ok(msg: string) {
    console.log(`  [ok] ${msg}`);
}
function err(msg: string) {
    console.log(`  [err] ${msg}`);
}
function kv(k: string, v: string) {
    console.log(`    ${k.padEnd(24)} ${v}`);
}
function section(title: string) {
    console.log(`\n---- ${title} ----`);
}
function shortHex(hex: string, head = 18, tail = 8): string {
    if (hex.length <= head + tail + 3) return hex;
    return `${hex.slice(0, head)}...${hex.slice(-tail)}`;
}

async function buildClients(config: Config) {
    const account = privateKeyToAccount(config.walletKey);
    const transport = http(config.rpcUrl);

    const tempClient = createPublicClient({ transport });
    const chainId = await tempClient.getChainId();

    const chain = defineChain({
        id: chainId,
        name: `Chain ${chainId}`,
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [config.rpcUrl] } },
    });

    console.log(`  [chain] Connected to chain ID ${chainId} via ${config.rpcUrl}`);

    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });

    return { publicClient, walletClient, account };
}

// ==============================================================================
// COMMAND: deposit
// ==============================================================================

async function cmdDeposit(config: Config, tokenIndex: number) {
    console.log('\n  NOZK TS CLIENT\n');
    section(`DEPOSIT - Token #${tokenIndex}`);

    const state = loadWalletState();

    section('Step 1 - Derive Token Secrets');
    const secrets = gl.deriveTokenSecrets(config.masterSeed, tokenIndex);

    kv('Token index', String(tokenIndex));
    kv('Nullifier ID', shortHex(`0x${gl.getNullifierIdHex(secrets)}`));
    kv('Deposit ID', gl.getDepositId(secrets));

    section('Step 2 - Blind Token -> G2');
    const blinded = gl.blindToken(secrets.spendBlsPub, secrets.r);
    const bCoords = serializeG2Sol(blinded.B);

    kv('B (G2, 8 uint256)', shortHex(`0x${bCoords[0].toString(16)}`));
    kv('Deposit ID', gl.getDepositId(secrets));

    section('Step 3 - Build deposit() Transaction');
    const { publicClient, walletClient } = await buildClients(config);
    const depositId = getAddress(gl.getDepositId(secrets));

    const balance = await publicClient.getBalance({ address: config.walletAddress });
    kv('Wallet address', config.walletAddress);
    kv('Balance', `${formatEther(balance)} ETH`);
    kv('Deposit amount', '0.001 ETH');

    if (balance < DENOMINATION) {
        err('Insufficient balance: need at least 0.001 ETH');
        process.exit(1);
    }

    section('Step 4 - Broadcast');
    try {
        const hash = await walletClient.writeContract({
            address: config.contractAddress,
            abi: NOZK_VAULT_ABI,
            functionName: 'deposit',
            args: [depositId, [...bCoords]],
            value: DENOMINATION,
        });

        kv('Transaction sent', hash);
        log('Waiting for confirmation...');

        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
        if (receipt.status !== 'success') {
            err(`Transaction REVERTED tx=${hash}`);
            process.exit(1);
        }

        kv('Confirmed block', String(receipt.blockNumber));
        kv('Gas used', String(receipt.gasUsed));

        state.tokens[String(tokenIndex)] = {
            index: tokenIndex,
            nullifier_id: `0x${gl.getNullifierIdHex(secrets)}`,
            deposit_id: gl.getDepositId(secrets),
            deposit_tx: hash,
            deposit_block: Number(receipt.blockNumber),
            s_unblinded: null,
            reveal_tx: null,
            redeem_tx: null,
            spent: false,
        };
        saveWalletState(state);
        ok('Deposit complete. Next: run scan to recover the signed token.');
    } catch (e: any) {
        err(`Contract error: ${e.shortMessage || e.message}`);
        process.exit(1);
    }
}

// ==============================================================================
// COMMAND: scan
// ==============================================================================

async function cmdScan(config: Config, indexFrom: number, indexTo: number) {
    console.log('\n  NOZK TS CLIENT\n');
    section(`SCAN - Tokens ${indexFrom}..${indexTo}`);

    const state = loadWalletState();
    const { publicClient } = await buildClients(config);

    const startBlock = BigInt(state.last_scanned_block) || config.scanFromBlock;
    const latestBlock = await publicClient.getBlockNumber();

    kv('Scanning blocks', `${startBlock} -> ${latestBlock}`);
    kv('Token indices', `${indexFrom} .. ${indexTo}`);

    section('Step 1 - Fetch MintFulfilled Events');
    const logs = await publicClient.getContractEvents({
        address: config.contractAddress,
        abi: NOZK_VAULT_ABI,
        eventName: 'MintFulfilled',
        fromBlock: startBlock,
        toBlock: latestBlock,
    });
    kv('Events found', String(logs.length));

    // Map depositId -> S_prime G2 coords (8 uint256)
    const fulfilled = new Map<string, bigint[]>();
    for (const log of logs) {
        const args = (log as any).args;
        const did = getAddress(args.depositId);
        const sPrime = (args.S_prime as bigint[]).map((v: bigint) => BigInt(v));
        fulfilled.set(did, sPrime);
    }

    section('Step 2 - Match Tokens by Deposit ID');
    let recovered = 0;

    for (let idx = indexFrom; idx <= indexTo; idx++) {
        const secrets = gl.deriveTokenSecrets(config.masterSeed, idx);
        const depositId = getAddress(gl.getDepositId(secrets));

        // Ensure record exists
        if (!state.tokens[String(idx)]) {
            state.tokens[String(idx)] = {
                index: idx,
                nullifier_id: `0x${gl.getNullifierIdHex(secrets)}`,
                deposit_id: gl.getDepositId(secrets),
                deposit_tx: null,
                deposit_block: null,
                s_unblinded: null,
                reveal_tx: null,
                redeem_tx: null,
                spent: false,
            };
        }

        const rec = state.tokens[String(idx)];
        const status = tokenStatus(rec);

        if (status === 'FRESH') continue;
        if (status === 'SPENT' || status === 'REDEEMED' || status === 'REVEALED' || status === 'READY_TO_REVEAL') {
            log(`\n  Token ${idx}  -  ${status}`);
            continue;
        }

        // AWAITING_MINT
        log(`\n  Token ${idx}  -  AWAITING_MINT`);

        if (!fulfilled.has(depositId)) {
            log(`    No MintFulfilled yet for ${shortHex(depositId)}`);
            continue;
        }

        const sPrimeCoords = fulfilled.get(depositId)!;
        log("    Unblinding: S = S' * r^-1 mod q ...");

        // Parse S' as G2 point
        const sPrime = parseG2Sol(
            sPrimeCoords[0],
            sPrimeCoords[1],
            sPrimeCoords[2],
            sPrimeCoords[3],
            sPrimeCoords[4],
            sPrimeCoords[5],
            sPrimeCoords[6],
            sPrimeCoords[7],
        );

        const S = gl.unblindSignature(sPrime, secrets.r);
        const sCoords = serializeG2Sol(S);

        // Local BLS verification
        if (config.mintBlsPubkey) {
            const { Y } = gl.blindToken(secrets.spendBlsPub, secrets.r);
            const blsOk = gl.verifyBlsPairing(S, Y, config.mintBlsPubkey);
            if (blsOk) {
                ok('BLS pairing verified locally');
            } else {
                err('BLS pairing FAILED - check MINT_BLS_PUBKEY');
            }
        }

        rec.s_unblinded = sCoords.map((c) => `0x${c.toString(16)}`);
        recovered++;

        log(`  -> ${tokenStatus(rec)}`);
    }

    state.last_scanned_block = Number(latestBlock);
    saveWalletState(state);

    console.log(`\n  Scan complete: ${recovered} token(s) recovered - block ${latestBlock} saved`);
}

// ==============================================================================
// COMMAND: reveal
// ==============================================================================

async function cmdReveal(config: Config, tokenIndex: number, relayerUrl?: string) {
    console.log('\n  NOZK TS CLIENT\n');
    section(`REVEAL - Token #${tokenIndex}`);

    const state = loadWalletState();
    const rec = state.tokens[String(tokenIndex)];

    if (!rec) {
        err(`Token ${tokenIndex} not found. Run deposit then scan first.`);
        process.exit(1);
    }
    if (rec.spent) {
        err(`Token ${tokenIndex} already spent.`);
        process.exit(1);
    }
    if (rec.reveal_tx) {
        log(`Token ${tokenIndex} is already revealed (tx: ${rec.reveal_tx}).`);
        return;
    }
    if (!rec.s_unblinded) {
        err(`Token ${tokenIndex} has no unblinded sig. Run scan first.`);
        process.exit(1);
    }

    const secrets = gl.deriveTokenSecrets(config.masterSeed, tokenIndex);

    section('Step 1 - Load Unblinded Signature');
    const sCoords = rec.s_unblinded.map((h) => BigInt(h));
    const S = parseG2Sol(
        sCoords[0],
        sCoords[1],
        sCoords[2],
        sCoords[3],
        sCoords[4],
        sCoords[5],
        sCoords[6],
        sCoords[7],
    );

    // Local BLS verification
    if (config.mintBlsPubkey) {
        const { Y } = gl.blindToken(secrets.spendBlsPub, secrets.r);
        const blsOk = gl.verifyBlsPairing(S, Y, config.mintBlsPubkey);
        if (blsOk) {
            ok('BLS pairing verified locally');
        } else {
            err('BLS pairing FAILED - this token will be rejected on-chain.');
            process.exit(1);
        }
    }

    // V2 reveal takes: spendPub (uint256[4] G1) + S (uint256[8] G2)
    const spendPubCoords = serializeG1Sol(secrets.spendBlsPub);
    const sG2Coords = serializeG2Sol(S);

    section('Step 2 - Submit reveal()');

    if (relayerUrl) {
        kv('Relayer URL', relayerUrl);
        log('Sending reveal request to relayer.');

        const resp = await fetch(`${relayerUrl.replace(/\/$/, '')}/reveal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                spend_pub_g1: spendPubCoords.map((c) => `0x${c.toString(16)}`),
                s_g2: sG2Coords.map((c) => `0x${c.toString(16)}`),
            }),
        });

        if (!resp.ok) {
            err(`Relayer returned ${resp.status}: ${await resp.text()}`);
            process.exit(1);
        }

        const result = (await resp.json()) as any;
        rec.reveal_tx = result.tx_hash;
        saveWalletState(state);
        ok(`Nullifier registered. Token ${tokenIndex} -> REVEALED.`);
    } else {
        const { publicClient, walletClient } = await buildClients(config);

        try {
            const hash = await walletClient.writeContract({
                address: config.contractAddress,
                abi: NOZK_VAULT_ABI,
                functionName: 'reveal',
                args: [[...spendPubCoords], [...sG2Coords]],
            });

            kv('Transaction sent', hash);
            log('Waiting for confirmation...');

            const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
            if (receipt.status !== 'success') {
                err(`Transaction REVERTED tx=${hash}`);
                process.exit(1);
            }

            kv('Confirmed block', String(receipt.blockNumber));
            kv('Gas used', String(receipt.gasUsed));

            ok('On-chain BLS pairing verified');
            ok(`Nullifier registered. Token ${tokenIndex} -> REVEALED.`);

            rec.reveal_tx = hash;
            saveWalletState(state);
        } catch (e: any) {
            err(`Contract error: ${e.shortMessage || e.message}`);
            process.exit(1);
        }
    }
}

// ==============================================================================
// COMMAND: redeem
// ==============================================================================

async function cmdRedeem(config: Config, tokenIndex: number, recipient: string, relayerUrl?: string) {
    console.log('\n  NOZK TS CLIENT\n');
    section(`REDEEM - Token #${tokenIndex} -> ${recipient}`);

    const state = loadWalletState();
    const rec = state.tokens[String(tokenIndex)];

    if (!rec) {
        err(`Token ${tokenIndex} not found. Run deposit first.`);
        process.exit(1);
    }
    if (rec.spent) {
        err(`Token ${tokenIndex} already spent.`);
        process.exit(1);
    }
    if (!rec.s_unblinded) {
        err(`Token ${tokenIndex} has no unblinded sig. Run scan first.`);
        process.exit(1);
    }
    if (!rec.reveal_tx) {
        err(`Token ${tokenIndex} is not revealed. Run 'reveal --index ${tokenIndex}' first.`);
        process.exit(1);
    }

    const secrets = gl.deriveTokenSecrets(config.masterSeed, tokenIndex);

    section('Step 1 - Derive Spend Key');
    kv('Nullifier ID', shortHex(`0x${gl.getNullifierIdHex(secrets)}`));
    kv('Deposit ID', gl.getDepositId(secrets));

    section('Step 2 - Generate BLS Spend Signature (EIP-712)');
    const recipientAddr = getAddress(recipient);
    const { publicClient: tempPub } = await buildClients(config);
    const chainId = await tempPub.getChainId();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

    const proof = gl.generateRedemptionProof(
        secrets.spendBlsPriv,
        secrets.spendPubCompressed,
        recipientAddr,
        chainId,
        config.contractAddress,
        deadline,
    );

    kv('msg_hash', shortHex(bytesToHex(proof.msgHash)));

    // Local BLS spend sig check
    const blsOk = gl.verifyBlsSpendSignature(proof);
    if (blsOk) {
        ok('Local BLS spend signature verified');
    } else {
        err('Local BLS spend signature verification failed - aborting.');
        process.exit(1);
    }

    // V2 redeem takes: recipient, spendSig (uint256[8] G2), nId (bytes32), deadline
    // We need to convert compressed G2 sigma (96 bytes) to the 8 uint256 Solidity format
    // The sigma from blsSign is compressed G2; for V2 we pass uncompressed as 8 uint256
    // Actually, we need to deserialize and re-serialize via parseG2Sol/serializeG2Sol
    // For now, the contract expects the AugSchemeMPL signature as 8 uint256 (uncompressed G2)
    // We'll need to decompress and serialize

    // The sigma from proof is compressed (96 bytes). We need to pass it as uint256[8].
    // Import the Signature.fromBytes helper to decompress, then serialize.
    const { bls12_381 } = await import('@noble/curves/bls12-381.js');
    const sigPoint = bls12_381.longSignatures.Signature.fromBytes(proof.sigma);
    const sigCoords = serializeG2Sol(sigPoint);

    const nullifierIdHex = `0x${gl.getNullifierIdHex(secrets)}` as Hex;

    section('Step 3 - Build redeem() Transaction');
    kv('Recipient', recipientAddr);
    kv('Nullifier ID', shortHex(nullifierIdHex));

    if (relayerUrl) {
        section('Step 4 - Broadcast via Relayer');
        kv('Relayer URL', relayerUrl);

        const resp = await fetch(`${relayerUrl.replace(/\/$/, '')}/redeem`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: recipientAddr,
                spend_sigma_compressed: Buffer.from(proof.sigma).toString('hex'),
                spend_pk_compressed: Buffer.from(secrets.spendPubCompressed).toString('hex'),
                nullifier_id: nullifierIdHex.replace(/^0x/i, ''),
                deadline: Number(deadline),
            }),
        });

        if (!resp.ok) {
            err(`Relayer returned ${resp.status}: ${await resp.text()}`);
            process.exit(1);
        }

        const result = (await resp.json()) as any;
        rec.redeem_tx = result.tx_hash;
        rec.spent = true;
        saveWalletState(state);
        ok(`Redemption complete. Token ${tokenIndex} is now spent.`);
    } else {
        section('Step 4 - Broadcast');
        const { publicClient, walletClient } = await buildClients(config);

        try {
            const hash = await walletClient.writeContract({
                address: config.contractAddress,
                abi: NOZK_VAULT_ABI,
                functionName: 'redeem',
                args: [recipientAddr, [...sigCoords], nullifierIdHex, deadline],
            });

            kv('Transaction sent', hash);
            log('Waiting for confirmation...');

            const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
            if (receipt.status !== 'success') {
                err(`Transaction REVERTED tx=${hash}`);
                process.exit(1);
            }

            kv('Confirmed block', String(receipt.blockNumber));
            kv('Gas used', String(receipt.gasUsed));

            ok('On-chain checks passed');
            ok(`0.001 ETH transferred to ${recipientAddr}`);

            rec.redeem_tx = hash;
            rec.spent = true;
            saveWalletState(state);

            ok(`Redemption complete. Token ${tokenIndex} is now spent.`);
        } catch (e: any) {
            err(`Contract error: ${e.shortMessage || e.message}`);
            process.exit(1);
        }
    }
}

// ==============================================================================
// COMMAND: balance
// ==============================================================================

async function cmdBalance(config: Config) {
    console.log('\n  NOZK TS CLIENT\n');
    section('Balance');
    const { publicClient } = await buildClients(config);
    const balance = await publicClient.getBalance({ address: config.walletAddress });
    kv('Wallet address', config.walletAddress);
    kv('Balance', `${formatEther(balance)} ETH`);
}

// ==============================================================================
// CLI ENTRY POINT
// ==============================================================================

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    function getArg(name: string, fallback?: string): string {
        const idx = args.indexOf(name);
        if (idx === -1 || idx + 1 >= args.length) {
            if (fallback !== undefined) return fallback;
            throw new Error(`Missing required argument: ${name}`);
        }
        return args[idx + 1];
    }

    const config = loadConfig();

    function getOptionalArg(name: string): string | undefined {
        const idx = args.indexOf(name);
        if (idx === -1 || idx + 1 >= args.length) return undefined;
        return args[idx + 1];
    }

    switch (command) {
        case 'deposit': {
            const index = parseInt(getArg('--index'), 10);
            await cmdDeposit(config, index);
            break;
        }
        case 'scan': {
            const from = parseInt(getArg('--index-from', '0'), 10);
            const to = parseInt(getArg('--index-to', '9'), 10);
            await cmdScan(config, from, to);
            break;
        }
        case 'reveal': {
            const index = parseInt(getArg('--index'), 10);
            const relayer = getOptionalArg('--relayer');
            await cmdReveal(config, index, relayer);
            break;
        }
        case 'redeem': {
            const index = parseInt(getArg('--index'), 10);
            const to = getArg('--to');
            const relayer = getOptionalArg('--relayer');
            await cmdRedeem(config, index, to, relayer);
            break;
        }
        case 'balance': {
            await cmdBalance(config);
            break;
        }
        default:
            console.log('Nozk TS Client (BLS12-381)');
            console.log('');
            console.log('Usage:');
            console.log('  npx tsx client.ts deposit --index <n>');
            console.log('  npx tsx client.ts scan [--index-from <n>] [--index-to <n>]');
            console.log('  npx tsx client.ts reveal --index <n> [--relayer <url>]');
            console.log('  npx tsx client.ts redeem --index <n> --to <address> [--relayer <url>]');
            console.log('  npx tsx client.ts balance');
            break;
    }
}

main().catch((e) => {
    console.error('Fatal:', e.message || e);
    process.exit(1);
});
