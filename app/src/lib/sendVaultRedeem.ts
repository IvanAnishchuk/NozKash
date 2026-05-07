import {
  buildNozkVaultRedeemCalldata,
  buildNozkVaultRevealCalldata,
  clearRedemptionDraft,
  redemptionDraftMatchesSecrets,
  type RedemptionDraftV1,
} from '../crypto/nozkRedeem'
import {
  ensureTargetChain,
  TARGET_CHAIN_ID_DECIMAL,
  targetChainMismatchUserMessage,
  waitForTransactionReceipt,
} from './ethereum'
import { chainRpcCall } from './chainPublicRpc'
import { isNozkVaultDebugEnabled } from './nozkDebug'
import {
  fetchMintFulfilledSPrime,
  NOZK_VAULT_ADDRESS,
  requestVaultActivityRefresh,
} from './nozkVault'

export type EthereumRequester = {
  request: (args: {
    method: string
    params?: unknown[]
  }) => Promise<unknown>
}

/**
 * Sends `NozkVault.redeem` using the local draft (spend/blind keys) and `recipient`.
 * Clears the draft and invalidates activity cache on success.
 */
function redeemDebug(msg: string, data?: Record<string, unknown>) {
  if (!isNozkVaultDebugEnabled()) return
  console.log('[NozkVault redeem]', msg, data ?? '')
}

export async function sendVaultRedeemTransaction(params: {
  ethereum: EthereumRequester
  recipient: string
  draft: RedemptionDraftV1
  /**
   * When `masterSeed` is present, alignment is checked **only** if the account
   * signing the tx is the same as the one that prepared the draft (Account 1).
   * If another account (Account 2) sends the tx, the in-memory seed differs — the
   * draft already carries spend/blind in localStorage and is not validated against `masterSeed`.
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
  redeemDebug('draft', {
    tokenIndex: draft.tokenIndex,
    depositId: draft.depositId.toLowerCase(),
    nullifier: draft.spendAddress.toLowerCase(),
    savedAtMs: draft.savedAt,
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

  const okChain = await ensureTargetChain(ethereum)
  if (!okChain) {
    throw new Error(targetChainMismatchUserMessage())
  }

  redeemDebug('building redeem calldata (reveal is a separate step)', {
    tokenIndex: draft.tokenIndex,
    depositId: draft.depositId.toLowerCase(),
  })

  const data = await buildNozkVaultRedeemCalldata({
    draft,
    recipient: r,
    chainId: Number(TARGET_CHAIN_ID_DECIMAL),
    contractAddress: NOZK_VAULT_ADDRESS,
  })
  redeemDebug('calldata built', {
    tokenIndex: draft.tokenIndex,
    selector: data.slice(0, 10).toLowerCase(),
    bytes: Math.max(0, (data.length - 2) / 2),
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
    to: NOZK_VAULT_ADDRESS,
    data,
    value: '0x0',
  }

  try {
    await chainRpcCall('eth_call', [sendParams, 'latest'])
  } catch {
    /* optional simulation */
  }

  const hash = (await ethereum.request({
    method: 'eth_sendTransaction',
    params: [sendParams],
  })) as string

  /* Prefer wallet RPC for receipt polling so Infura isn’t hit during the same redeem flow as `fetchMintFulfilledSPrime` + vault refresh. */
  const receipt = await waitForTransactionReceipt(hash, { ethereum })
  if (receipt.status === '0x0') {
    throw new Error('Transaction reverted')
  }

  clearRedemptionDraft()
  requestVaultActivityRefresh()
  return { txHash: hash }
}

/**
 * Sends `NozkVault.reveal` — permissionless BLS verification + nullifier registration.
 * Must be called before `redeem` in the new split flow.
 */
export async function sendVaultRevealTransaction(params: {
  ethereum: EthereumRequester
  draft: RedemptionDraftV1
  masterSeed?: Uint8Array | null
}): Promise<{ txHash: string }> {
  const { ethereum, draft, masterSeed } = params

  if (masterSeed) {
    const ok = redemptionDraftMatchesSecrets(draft, masterSeed)
    redeemDebug('reveal: redemptionDraftMatchesSecrets', { ok })
    if (!ok) {
      throw new Error('Redeem draft does not match current vault seed')
    }
  }

  const okChain = await ensureTargetChain(ethereum)
  if (!okChain) {
    throw new Error(targetChainMismatchUserMessage())
  }

  const mint = await fetchMintFulfilledSPrime(draft.depositId, {
    contractAddress: NOZK_VAULT_ADDRESS,
  })
  if (!mint) {
    throw new Error('No MintFulfilled log for this depositId')
  }
  redeemDebug('reveal: mint log found', {
    tokenIndex: draft.tokenIndex,
    depositId: draft.depositId.toLowerCase(),
    sx: mint.sx.toString(10),
    sy: mint.sy.toString(10),
  })

  const { data } = await buildNozkVaultRevealCalldata({
    draft,
    mintFulfilled: mint,
  })
  redeemDebug('reveal calldata built', {
    tokenIndex: draft.tokenIndex,
    selector: data.slice(0, 10).toLowerCase(),
    bytes: Math.max(0, (data.length - 2) / 2),
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
    to: NOZK_VAULT_ADDRESS,
    data,
    value: '0x0',
  }

  try {
    await chainRpcCall('eth_call', [sendParams, 'latest'])
  } catch {
    /* optional simulation */
  }

  const hash = (await ethereum.request({
    method: 'eth_sendTransaction',
    params: [sendParams],
  })) as string

  const receipt = await waitForTransactionReceipt(hash, { ethereum })
  if (receipt.status === '0x0') {
    throw new Error('Transaction reverted')
  }

  requestVaultActivityRefresh()
  return { txHash: hash }
}
