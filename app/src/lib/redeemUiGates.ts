import type { RedemptionDraftV1 } from '../crypto/ghostRedeem'

function normalizeAddr(a: string | null | undefined): string | null {
  if (!a || !/^0x[a-fA-F0-9]{40}$/i.test(a.trim())) return null
  return a.trim().toLowerCase()
}

function envAddr(
  key: 'VITE_GHOST_REDEEM_PREPARE_ACCOUNT' | 'VITE_GHOST_REDEEM_EXECUTOR_ACCOUNT'
): string | null {
  const raw = import.meta.env[key] as string | undefined
  return normalizeAddr(raw)
}

/**
 * **Start redeem** — visible en la cuenta que prepara (Account 1), incluso después
 * de guardar claves, para que el usuario siga viendo la fila mientras cambia de wallet.
 * En la cuenta ejecutora (Account 2) no se muestra.
 */
export function isStartRedeemVisible(
  account: string | null,
  draft: RedemptionDraftV1 | null,
  item: { type: string; tokenIndex?: number }
): boolean {
  if (item.type !== 'Deposit' || item.tokenIndex === undefined) return false
  const acc = normalizeAddr(account)
  if (!acc) return false
  if (draft?.prepareAccount && acc !== draft.prepareAccount.toLowerCase()) {
    return false
  }
  if (!draft?.prepareAccount) {
    const prepOnly = envAddr('VITE_GHOST_REDEEM_PREPARE_ACCOUNT')
    if (prepOnly) return acc === prepOnly
    return true
  }
  return true
}

/**
 * **Redeem here** — en la cuenta que envía la tx on-chain (Account 2).
 * - `isReady` suele venir de `isHomeRedeemReady` (connected ≠ prepareAccount).
 * - Si `VITE_GHOST_REDEEM_EXECUTOR_ACCOUNT` está definido, solo esa dirección ve el botón.
 */
export function shouldShowRedeemHere(
  account: string | null,
  isReady: boolean
): boolean {
  if (!isReady) return false
  const acc = normalizeAddr(account)
  if (!acc) return false
  const execOnly = envAddr('VITE_GHOST_REDEEM_EXECUTOR_ACCOUNT')
  if (execOnly) return acc === execOnly
  return true
}
