import { useCallback, useState } from 'react'
import { getEthereum } from '../lib/ethereum'
import { useWallet } from './useWallet'

/**
 * Firma `personal_sign` en MetaMask para flujos tipo Redeem (Home / actividad).
 */
export function useRedeemSign(
  showToast: (msg: string, type?: 'success' | 'error') => void
) {
  const { account } = useWallet()
  const [signingId, setSigningId] = useState<string | null>(null)

  const signRedeem = useCallback(
    async (itemId: string, message: string) => {
      const ethereum = getEthereum()
      if (!ethereum) {
        showToast('MetaMask no está instalado', 'error')
        return
      }

      let from = account
      if (!from) {
        try {
          const accs = (await ethereum.request({
            method: 'eth_requestAccounts',
          })) as string[]
          from = accs[0] ?? null
        } catch {
          showToast('Conectá tu wallet para firmar', 'error')
          return
        }
      }
      if (!from) {
        showToast('Conectá tu wallet para firmar', 'error')
        return
      }

      setSigningId(itemId)
      try {
        await ethereum.request({
          method: 'personal_sign',
          params: [message, from],
        })
        showToast('Firma confirmada · Redeem registrado', 'success')
      } catch (err: unknown) {
        const e = err as { code?: number; message?: string }
        if (e?.code === 4001) {
          showToast('Firma cancelada en MetaMask', 'error')
          return
        }
        const msg = typeof e?.message === 'string' ? e.message : ''
        if (/user rejected|denied/i.test(msg)) {
          showToast('Firma cancelada en MetaMask', 'error')
        } else {
          showToast('No se pudo completar la firma', 'error')
        }
      } finally {
        setSigningId(null)
      }
    },
    [account, showToast]
  )

  return { signingId, signRedeem }
}
