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
import { bls12_381 } from '@noble/curves/bls12-381.js'
// Import nozk crypto from compiled nozk_ts dist (recompile with:
//   cd nozk_ts && npx tsc --outDir dist --noEmit false --declaration false)
import {
  G1_GEN,
  g1ScalarMul,
  serializeG1Sol,
  serializeG2Sol,
  // @ts-ignore -- compiled JS, no .d.ts
} from '../../../nozk_ts/dist/bls12-381-crypto.js'
import {
  aggregateRedeemSigma,
  aggregateRevealSigma,
  blindToken,
  deriveTokenSecrets,
  generateRedemptionProof,
  mintBlindSign,
  unblindSignature,
  // @ts-ignore -- compiled JS, no .d.ts
} from '../../../nozk_ts/dist/nozk-library.js'

// ==============================================================================
// CONSTANTS
// ==============================================================================

const ANVIL_RPC = 'http://127.0.0.1:8545'
const CHAIN_ID = 31337
export const DENOMINATION = parseEther('0.001')
export const MINT_SK = 42n
const MINT_PK = g1ScalarMul(G1_GEN, MINT_SK)

// Anvil default accounts (well-known test keys, not real secrets)
import { DEPLOYER_KEY, DEPOSITOR_KEY, RECIPIENT } from './test-constants.ts'
export { DEPLOYER_KEY, DEPOSITOR_KEY, RECIPIENT }

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
 * Inline serialization to avoid cross-module @noble/curves instanceof issues.
 * Coordinate order must match serializeG2Sol: [x.c0, x.c1, y.c0, y.c1],
 * each component split into (hi, lo) uint256 pair.
 */
function decompressSigToCoords(
  sigma: Uint8Array,
): readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] {
  const sigPoint = bls12_381.longSignatures.Signature.fromBytes(sigma)
  const aff = sigPoint.toAffine()

  const fpPair = (n: bigint): [bigint, bigint] => [n >> 256n, n & ((1n << 256n) - 1n)]
  const [xC0Hi, xC0Lo] = fpPair(aff.x.c0)
  const [xC1Hi, xC1Lo] = fpPair(aff.x.c1)
  const [yC0Hi, yC0Lo] = fpPair(aff.y.c0)
  const [yC1Hi, yC1Lo] = fpPair(aff.y.c1)
  // Must match serializeG2Sol order: [x.c0, x.c1, y.c0, y.c1]
  return [xC0Hi, xC0Lo, xC1Hi, xC1Lo, yC0Hi, yC0Lo, yC1Hi, yC1Lo] as const
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

/**
 * Get nullifier ID for a token.
 */
export async function getNullifierId(seed: Uint8Array, tokenIndex: number): Promise<`0x${string}`> {
  const secrets = deriveTokenSecrets(seed, tokenIndex)
  const spendPubCoords = [...serializeG1Sol(secrets.spendBlsPub)] as const
  return publicClient.readContract({
    address: vaultAddress,
    abi,
    functionName: 'nullifierId',
    args: [spendPubCoords],
  }) as Promise<`0x${string}`>
}

/**
 * Deposit + announce multiple tokens. Returns array of { secrets, S } per token.
 */
export async function depositAndAnnounceMany(seed: Uint8Array, indices: number[]) {
  const results = []
  for (const idx of indices) {
    const result = await depositAndAnnounce(seed, idx)
    results.push({ index: idx, secrets: result.secrets, S: result.S, blinded: result.blinded })
  }
  return results
}

/**
 * Batch reveal: individual pairing check per token (revealBatch).
 */
export async function revealBatch(
  seed: Uint8Array,
  tokens: { index: number; S: ReturnType<typeof unblindSignature> }[],
) {
  const spendPubs = tokens.map(t => {
    const secrets = deriveTokenSecrets(seed, t.index)
    return [...serializeG1Sol(secrets.spendBlsPub)] as const
  })
  const sigs = tokens.map(t => [...serializeG2Sol(t.S)] as const)

  const hash = await writeVault(depositorWallet, {
    functionName: 'revealBatch',
    args: [spendPubs, sigs],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('revealBatch failed')
  return receipt
}

/**
 * Aggregated reveal: single pairing check for n tokens (revealAggregated).
 */
export async function revealAggregated(
  seed: Uint8Array,
  tokens: { index: number; S: ReturnType<typeof unblindSignature> }[],
) {
  const spendPubs = tokens.map(t => {
    const secrets = deriveTokenSecrets(seed, t.index)
    return [...serializeG1Sol(secrets.spendBlsPub)] as const
  })
  const sigma = aggregateRevealSigma(tokens.map(t => t.S))
  const sigmaCoords = [...serializeG2Sol(sigma)] as const

  const hash = await writeVault(depositorWallet, {
    functionName: 'revealAggregated',
    args: [spendPubs, sigmaCoords],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('revealAggregated failed')
  return receipt
}

/**
 * Aggregated redeem: single pairing check for n tokens to same recipient.
 */
export async function redeemAggregated(
  seed: Uint8Array,
  indices: number[],
  recipient: Address,
) {
  const deadline = (1n << 256n) - 1n
  const nIds: `0x${string}`[] = []
  const sigs: Uint8Array[] = []

  for (const idx of indices) {
    const secrets = deriveTokenSecrets(seed, idx)
    const spendPubCoords = [...serializeG1Sol(secrets.spendBlsPub)] as const
    const nid = await publicClient.readContract({
      address: vaultAddress,
      abi,
      functionName: 'nullifierId',
      args: [spendPubCoords],
    }) as `0x${string}`
    nIds.push(nid)

    const proof = generateRedemptionProof(
      secrets.spendBlsPriv,
      secrets.spendPubCompressed,
      recipient,
      CHAIN_ID,
      vaultAddress,
      deadline,
    )
    sigs.push(proof.sigma)
  }

  const aggSigma = aggregateRedeemSigma(sigs)
  const sigmaCoords = [...decompressSigToCoords(aggSigma)] as const

  const hash = await writeVault(depositorWallet, {
    functionName: 'redeemAggregated',
    args: [recipient, sigmaCoords, nIds, deadline],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('redeemAggregated failed')
  return { receipt, nullifierIds: nIds }
}
