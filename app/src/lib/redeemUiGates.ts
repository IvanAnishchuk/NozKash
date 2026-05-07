import type { RedemptionDraftV1 } from '../crypto/nozkRedeem'

function normalizeAddr(a: string | null | undefined): string | null {
  if (!a || !/^0x[a-fA-F0-9]{40}$/i.test(a.trim())) return null
  return a.trim().toLowerCase()
}

function envAddr(
  key: 'VITE_NOZK_REDEEM_PREPARE_ACCOUNT' | 'VITE_NOZK_REDEEM_EXECUTOR_ACCOUNT'
): string | null {
  const raw = import.meta.env[key] as string | undefined
  return normalizeAddr(raw)
}

/**
 * **Start redeem** — shown on the preparing account (Account 1), even after
 * saving keys, so the user still sees the row while switching wallets.
 * Hidden on the executor account (Account 2).
 */
export function isStartRedeemVisible(
  account: string | null,
  draft: RedemptionDraftV1 | null,
  item: { type: string; tokenIndex?: number }
): boolean {
  if ((item.type !== 'Deposit' && item.type !== 'Revealed') || item.tokenIndex === undefined) return false
  const acc = normalizeAddr(account)
  if (!acc) return false
  if (draft?.prepareAccount && acc !== draft.prepareAccount.toLowerCase()) {
    return false
  }
  if (!draft?.prepareAccount) {
    const prepOnly = envAddr('VITE_NOZK_REDEEM_PREPARE_ACCOUNT')
    if (prepOnly) return acc === prepOnly
    return true
  }
  return true
}

/**
 * **Redeem here** — on the account that sends the on-chain tx (Account 2).
 * - `isReady` usually comes from `isHomeRedeemReady` (connected ≠ prepareAccount).
 * - If `VITE_NOZK_REDEEM_EXECUTOR_ACCOUNT` is set, only that address sees the button.
 */
export function shouldShowRedeemHere(
  account: string | null,
  isReady: boolean
): boolean {
  if (!isReady) return false
  const acc = normalizeAddr(account)
  if (!acc) return false
  const execOnly = envAddr('VITE_NOZK_REDEEM_EXECUTOR_ACCOUNT')
  if (execOnly) return acc === execOnly
  return true
}
