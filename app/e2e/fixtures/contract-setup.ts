/**
 * Contract deployment + lifecycle helpers for Playwright e2e tests.
 *
 * Deploys NozkVaultV2 on local anvil, provides helpers for deposit,
 * announce, reveal, redeem — all from Node.js (not the browser).
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
import {
  type Abi,
  type Address,
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
// Import nozk crypto from compiled JS copies local to app/e2e/fixtures/.
// These resolve @noble/curves from app/node_modules — avoids Playwright/vitest
// type clash caused by nozk_ts/node_modules containing @vitest/expect.
import {
  G1_GEN,
  g1ScalarMul,
  serializeG1Sol,
  serializeG2Sol,
} from './bls12-381-crypto.js'
import {
  blindToken,
  deriveTokenSecrets,
  generateRedemptionProof,
  mintBlindSign,
  unblindSignature,
  verifyBlsPairing,
} from './nozk-library.js'

// ==============================================================================
// CONSTANTS
// ==============================================================================

const ANVIL_RPC = 'http://127.0.0.1:8545'
const CHAIN_ID = 31337
export const DENOMINATION = parseEther('0.001')
export const MINT_SK = 42n
const MINT_PK = g1ScalarMul(G1_GEN, MINT_SK)

// Anvil default accounts (well-known test keys, not real secrets)
export { DEPLOYER_KEY, DEPOSITOR_KEY, RECIPIENT } from './test-constants.ts'

const deployer = privateKeyToAccount(DEPLOYER_KEY)
const depositor = privateKeyToAccount(DEPOSITOR_KEY)

// ==============================================================================
// CLIENT SETUP
// ==============================================================================

export const publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) })
const deployerWallet = createWalletClient({ account: deployer, chain: foundry, transport: http(ANVIL_RPC) })
const depositorWallet = createWalletClient({ account: depositor, chain: foundry, transport: http(ANVIL_RPC) })

let vaultAddress: Address
let abi: Abi

export function getVaultAddress(): Address {
  return vaultAddress
}

export function getAbi(): Abi {
  return abi
}

// ==============================================================================
// HELPERS
// ==============================================================================

/**
 * Decompress a 96-byte BLS G2 signature to 8 uint256 for Solidity.
 *
 * Self-contained: decompresses with the nozk_ts bls12_381 AND serializes
 * within the same module context, avoiding cross-instance point type issues.
 */
function decompressSigToCoords(
  sigma: Uint8Array,
): readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] {
  // Use nozk_ts's serializeG2Sol which uses its own @noble/curves instance
  // internally. We need the decompression to happen in the same module space.
  // Import the bls12_381 from the nozk_ts re-export path:
  //
  // Since both app and nozk_ts have the same @noble/curves version (2.0.1),
  // the compressed bytes → affine coords conversion is deterministic.
  // We inline the serialization to avoid crossing module boundaries.
  const { bls12_381 } = require('@noble/curves/bls12-381')
  const sigPoint = bls12_381.longSignatures.Signature.fromBytes(sigma)
  const aff = sigPoint.toAffine()

  const fpPair = (n: bigint): [bigint, bigint] => [n >> 256n, n & ((1n << 256n) - 1n)]
  const [xC0Hi, xC0Lo] = fpPair(aff.x.c0)
  const [xC1Hi, xC1Lo] = fpPair(aff.x.c1)
  const [yC0Hi, yC0Lo] = fpPair(aff.y.c0)
  const [yC1Hi, yC1Lo] = fpPair(aff.y.c1)
  // EIP-2537 order: [x.c1, x.c0, y.c1, y.c0] — each split into (hi, lo)
  return [xC1Hi, xC1Lo, xC0Hi, xC0Lo, yC1Hi, yC1Lo, yC0Hi, yC0Lo] as const
}

async function writeVault(wallet: any, params: Record<string, any>): Promise<`0x${string}`> {
  return wallet.writeContract({ ...params, address: vaultAddress, abi, chain: foundry })
}

// ==============================================================================
// DEPLOYMENT
// ==============================================================================

export async function deployNozkVault(): Promise<Address> {
  const artifactPath = resolve(__dirname, '..', '..', '..', 'sol', 'out', 'NozkVaultV2.sol', 'NozkVaultV2.json')
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'))
  abi = artifact.abi as Abi
  const bytecode = artifact.bytecode.object as `0x${string}`

  const pkCoords = [...serializeG1Sol(MINT_PK)] as const
  const hash = await (deployerWallet as any).deployContract({
    abi,
    bytecode,
    args: [pkCoords, deployer.address],
    chain: foundry,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('Deploy failed')
  vaultAddress = receipt.contractAddress!
  return vaultAddress
}

// ==============================================================================
// LIFECYCLE OPERATIONS
// ==============================================================================

/**
 * Deposit + announce a token (simulates user deposit + mint daemon).
 * Returns the unblinded signature S and token secrets.
 */
export async function depositAndAnnounce(seed: Uint8Array, tokenIndex: number) {
  const secrets = deriveTokenSecrets(seed, tokenIndex)
  const blinded = blindToken(secrets.spendBlsPub, secrets.r)
  const bCoords = [...serializeG2Sol(blinded.B)] as const
  const depositId = getAddress(secrets.depositId)

  // Deposit (from depositor account)
  const depHash = await depositorWallet.writeContract({
    address: vaultAddress,
    abi,
    functionName: 'deposit',
    args: [depositId, bCoords],
    value: DENOMINATION,
  })
  const depReceipt = await publicClient.waitForTransactionReceipt({ hash: depHash })
  if (depReceipt.status !== 'success') throw new Error('Deposit tx failed')

  // Announce (from deployer = mint authority)
  const sPrime = mintBlindSign(blinded.B, MINT_SK)
  const sPrimeCoords = [...serializeG2Sol(sPrime)] as const
  const annHash = await deployerWallet.writeContract({
    address: vaultAddress,
    abi,
    functionName: 'announce',
    args: [depositId, sPrimeCoords],
  })
  const annReceipt = await publicClient.waitForTransactionReceipt({ hash: annHash })
  if (annReceipt.status !== 'success') throw new Error('Announce tx failed')

  const S = unblindSignature(sPrime, secrets.r)
  return { secrets, blinded, S }
}

/**
 * Reveal a token on-chain (registers nullifier).
 */
export async function revealToken(seed: Uint8Array, tokenIndex: number, S: ReturnType<typeof unblindSignature>) {
  const secrets = deriveTokenSecrets(seed, tokenIndex)
  const spendPubCoords = [...serializeG1Sol(secrets.spendBlsPub)] as const
  const sCoords = [...serializeG2Sol(S)] as const

  const hash = await writeVault(depositorWallet, {
    functionName: 'reveal',
    args: [spendPubCoords, sCoords],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('Reveal tx failed')
  return { receipt, spendPubCoords }
}

/**
 * Redeem a token — sends 0.001 ETH to `recipient`.
 * Returns the tx hash.
 */
export async function redeemToken(
  seed: Uint8Array,
  tokenIndex: number,
  recipient: Address,
) {
  const secrets = deriveTokenSecrets(seed, tokenIndex)

  // Get nullifier ID
  const spendPubCoords = [...serializeG1Sol(secrets.spendBlsPub)] as const
  const nid = await publicClient.readContract({
    address: vaultAddress,
    abi,
    functionName: 'nullifierId',
    args: [spendPubCoords],
  }) as `0x${string}`

  const deadline = (1n << 256n) - 1n
  const proof = generateRedemptionProof(
    secrets.spendBlsPriv,
    secrets.spendPubCompressed,
    recipient,
    CHAIN_ID,
    vaultAddress,
    deadline,
  )
  const sigCoords = [...decompressSigToCoords(proof.sigma)] as const

  const hash = await writeVault(depositorWallet, {
    functionName: 'redeem',
    args: [recipient, sigCoords, nid, deadline],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('Redeem tx failed')
  return { txHash: hash, receipt, nullifierId: nid }
}

/**
 * Get balance of an address on anvil.
 */
export async function getBalance(address: Address): Promise<bigint> {
  return publicClient.getBalance({ address })
}

/**
 * Verify nullifier state: 0=UNREVEALED, 1=REVEALED, 2=SPENT
 */
export async function getNullifierState(nullifierId: `0x${string}`): Promise<number> {
  return publicClient.readContract({
    address: vaultAddress,
    abi,
    functionName: 'nullifierState',
    args: [nullifierId],
  }) as Promise<number>
}
