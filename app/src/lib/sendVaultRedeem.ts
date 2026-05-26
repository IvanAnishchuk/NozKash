import {
  buildNozkVaultRevealCalldata,
  buildRelayerRedeemPayload,
  clearRedemptionDraft,
} from '../crypto/nozkRedeem'
import { deriveTokenSecretsFromSeed } from '../crypto/nozkClient'
import { isNozkVaultDebugEnabled } from './nozkDebug'
import {
  fetchMintFulfilledSPrime,
  NOZK_VAULT_ADDRESS,
} from './nozkVault'
import { TARGET_CHAIN_ID_DECIMAL, waitForTransactionReceipt } from './ethereum'

function redeemDebug(msg: string, data?: Record<string, unknown>) {
  if (!isNozkVaultDebugEnabled()) return
  console.log('[NozkVault redeem]', msg, data ?? '')
}

const RELAYER_URL = (import.meta.env.VITE_RELAYER_URL as string | undefined) ?? ''

async function relayerPost<T>(path: string, body: unknown): Promise<T> {
  if (!RELAYER_URL) throw new Error('VITE_RELAYER_URL not configured')
  const resp = await fetch(`${RELAYER_URL.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Relayer ${path} returned ${resp.status}: ${text}`)
  }
  return resp.json() as Promise<T>
}

/**
 * Sends reveal via relayer — no on-chain tx from the user's wallet.
 */
export async function sendRelayerRevealTransaction(params: {
  masterSeed: Uint8Array
  tokenIndex: number
}): Promise<{ txHash: string; blockNumber?: number }> {
  const { masterSeed, tokenIndex } = params
  const secrets = deriveTokenSecretsFromSeed(masterSeed, tokenIndex)

  const mint = await fetchMintFulfilledSPrime(secrets.depositId, {
    contractAddress: NOZK_VAULT_ADDRESS,
  })
  if (!mint) {
    throw new Error('No MintFulfilled log for this token')
  }

  redeemDebug('reveal: mint log found', { tokenIndex, depositId: secrets.depositId })

  const { spendPubCoords, sCoords } = buildNozkVaultRevealCalldata({
    masterSeed,
    tokenIndex,
    mintFulfilledCoords: mint.coords,
  })

  const result = await relayerPost<{ tx_hash: string; block_number: number }>('/reveal', {
    spend_pub_g1: [...spendPubCoords].map((c: bigint) => '0x' + c.toString(16)),
    s_g2: [...sCoords].map((c: bigint) => '0x' + c.toString(16)),
  })

  redeemDebug('reveal relayer response', result as unknown as Record<string, unknown>)
  await waitForTransactionReceipt(result.tx_hash)
  return { txHash: result.tx_hash, blockNumber: result.block_number }
}

/**
 * Sends redeem via relayer — BLS spend signature.
 */
export async function sendRelayerRedeemTransaction(params: {
  masterSeed: Uint8Array
  tokenIndex: number
  recipient: string
}): Promise<{ txHash: string; blockNumber?: number }> {
  const { masterSeed, tokenIndex, recipient } = params

  const payload = buildRelayerRedeemPayload({
    masterSeed,
    tokenIndex,
    recipient,
    chainId: Number(TARGET_CHAIN_ID_DECIMAL),
    contractAddress: NOZK_VAULT_ADDRESS,
  })

  const result = await relayerPost<{ tx_hash: string; block_number: number }>('/redeem', {
    recipient: payload.recipient,
    spend_sigma_compressed: payload.spendSigmaCompressedHex,
    spend_pk_compressed: payload.spendPkCompressedHex,
    nullifier_id: payload.nullifierIdHex,
    deadline: payload.deadline,
  })

  redeemDebug('redeem relayer response', result as unknown as Record<string, unknown>)
  await waitForTransactionReceipt(result.tx_hash)
  clearRedemptionDraft()
  return { txHash: result.tx_hash, blockNumber: result.block_number }
}
