import type { RedemptionDraftV1 } from '../crypto/ghostRedeem'
import type { VaultTx } from '../types/activity'
import { GHOST_VAULT_DEPOSIT_AMOUNT_LABEL } from './ghostVault'

/**
 * If the user switched to the account that sends redeem (e.g. Account 2) but
 * activity was derived with another account’s seed (Account 1), scanning with the
 * current seed no longer finds the same `depositId` and the row disappears.
 * We insert a synthetic row for the draft’s token so "Start redeem" / "Redeem here"
 * stay visible.
 */
export function mergeVaultRowsWithRedeemDraft(
  rows: VaultTx[],
  draft: RedemptionDraftV1 | null,
  account: string | null
): VaultTx[] {
  if (!draft || !account || !draft.prepareAccount) return rows
  if (account.toLowerCase() === draft.prepareAccount.toLowerCase()) {
    return rows
  }

  const hasDepositForToken = rows.some(
    (r) => r.type === 'Deposit' && r.tokenIndex === draft.tokenIndex
  )
  if (hasDepositForToken) return rows

  const today = new Date().toISOString().slice(0, 10)
  const synthetic: VaultTx = {
    id: `vault-deposit-${draft.tokenIndex}`,
    type: 'Deposit',
    amount: GHOST_VAULT_DEPOSIT_AMOUNT_LABEL,
    counterparty: '—',
    txHash: '—',
    historyLabel: `Deposit · mint fulfilled · token #${draft.tokenIndex}`,
    historySub:
      'Redeem draft ready · use Redeem here (this account pays gas / receives)',
    blockNumber: undefined,
    tokenIndex: draft.tokenIndex,
    dateIso: today,
    time: today,
  }
  return [synthetic, ...rows]
}
