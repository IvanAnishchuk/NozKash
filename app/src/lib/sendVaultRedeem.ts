import {
  buildGhostVaultRedeemCalldata,
  clearRedemptionDraft,
  redemptionDraftMatchesSecrets,
  type RedemptionDraftV1,
} from '../crypto/ghostRedeem'
import { ensureFuji, waitForTransactionReceipt } from './ethereum'
import { fujiRpcCall } from './fujiJsonRpc'
import {
  fetchMintFulfilledSPrime,
  GHOST_VAULT_ADDRESS,
  invalidateVaultActivityCache,
} from './ghostVault'

export type EthereumRequester = {
  request: (args: {
    method: string
    params?: unknown[]
  }) => Promise<unknown>
}

/**
 * Envía `GhostVault.redeem` con el borrador local (claves spend/blind) y `recipient`.
 * Cierra el borrador e invalida el caché de actividad si confirma.
 */
function redeemDebug(msg: string, data?: Record<string, unknown>) {
  const on =
    import.meta.env.DEV ||
    import.meta.env.VITE_GHOST_REDEEM_DEBUG === 'true'
  if (!on) return
  console.log('[GhostVault redeem]', msg, data ?? '')
}

export async function sendVaultRedeemTransaction(params: {
  ethereum: EthereumRequester
  recipient: string
  draft: RedemptionDraftV1
  /**
   * Si hay semilla, se comprueba alineación **solo** cuando quien firma la tx
   * es la misma cuenta que preparó el borrador (Account 1). Si la tx la envía
   * otra cuenta (Account 2), la semilla actual es distinta — el borrador ya
   * trae spend/blind en localStorage y no se valida contra `masterSeed`.
   */
  masterSeed?: Uint8Array | null
}): Promise<{ txHash: string }> {
  const { ethereum, recipient, draft, masterSeed } = params
  const r = recipient.trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(r)) {
    throw new Error('Invalid recipient address')
  }

  const recipientLc = r.toLowerCase()
  const prepareLc = draft.prepareAccount?.toLowerCase()
  const isExecutorAccount =
    draft.prepareAccount != null && recipientLc !== prepareLc

  redeemDebug('pre-check', {
    recipient: recipientLc,
    prepareAccount: prepareLc ?? '(none)',
    isExecutorAccount,
    hasMasterSeed: Boolean(masterSeed?.length),
  })

  if (masterSeed && !isExecutorAccount) {
    const ok = redemptionDraftMatchesSecrets(draft, masterSeed)
    redeemDebug('redemptionDraftMatchesSecrets', { ok })
    if (!ok) {
      throw new Error('Redeem draft does not match current vault seed')
    }
  } else if (isExecutorAccount) {
    redeemDebug(
      'skip seed check (executor account; draft keys are self-contained)'
    )
  }

  const okChain = await ensureFuji(ethereum)
  if (!okChain) {
    throw new Error('Switch to Avalanche Fuji (43113)')
  }

  const mint = await fetchMintFulfilledSPrime(draft.depositId, {
    contractAddress: GHOST_VAULT_ADDRESS,
  })
  if (!mint) {
    throw new Error('No MintFulfilled log for this depositId')
  }

  const data = await buildGhostVaultRedeemCalldata({
    draft,
    recipient: r,
    mintFulfilled: mint,
  })

  const accs = (await ethereum.request({
    method: 'eth_requestAccounts',
  })) as unknown
  const from =
    Array.isArray(accs) && typeof accs[0] === 'string' ? accs[0] : null
  if (!from) {
    throw new Error('No connected account')
  }

  const sendParams = {
    from,
    to: GHOST_VAULT_ADDRESS,
    data,
    value: '0x0',
  }

  try {
    await fujiRpcCall('eth_call', [sendParams, 'latest'])
  } catch {
    /* opcional */
  }

  const hash = (await ethereum.request({
    method: 'eth_sendTransaction',
    params: [sendParams],
  })) as string

  const receipt = await waitForTransactionReceipt(hash)
  if (receipt.status === '0x0') {
    throw new Error('Transaction reverted')
  }

  clearRedemptionDraft()
  invalidateVaultActivityCache()
  return { txHash: hash }
}
