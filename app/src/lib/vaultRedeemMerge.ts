import type { RedemptionDraftV1 } from '../crypto/ghostRedeem'
import type { VaultTx } from '../types/activity'
import { GHOST_VAULT_DEPOSIT_AMOUNT_LABEL } from './ghostVault'

/**
 * Si el usuario pasó a la cuenta que envía el redeem (p. ej. Account 2) pero la
 * actividad se derivó con la semilla de otra cuenta (Account 1), el escaneo con
 * la semilla actual no encuentra el mismo `depositId` y la fila desaparece.
 * Insertamos una fila sintética para el token del borrador para que sigan
 * visibles "Start redeem" / "Redeem here".
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
