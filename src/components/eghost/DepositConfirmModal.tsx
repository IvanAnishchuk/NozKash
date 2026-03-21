import { useEffect, useState } from 'react'
import { useWallet } from '../../hooks/useWallet'
import {
  ensureSepolia,
  estimateSimpleTransferGasEth,
  getEthereum,
  waitForTransactionReceipt,
} from '../../lib/ethereum'
import { MOCK_CRYPTO } from '../../mock/data'

const PLACEHOLDER_TO = '0x0000000000000000000000000000000000000001'
const DEPOSIT_VALUE_WEI = '0x2386F26FC10000'

type Props = {
  open: boolean
  onClose: () => void
  onToast: (msg: string, type?: 'success' | 'error') => void
}

function usdApproxForDenomination(): string {
  const usd = MOCK_CRYPTO.denominationEth * 2417
  return `≈ $${usd.toFixed(2)} USD`
}

export function DepositConfirmModal({ open, onClose, onToast }: Props) {
  const { account, network } = useWallet()
  const [gasLabel, setGasLabel] = useState('—')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!open) {
      setGasLabel('—')
      return
    }
    const eth = getEthereum()
    if (!eth) return
    let cancelled = false
    ;(async () => {
      const g = await estimateSimpleTransferGasEth(eth)
      if (!cancelled) setGasLabel(g)
    })()
    return () => {
      cancelled = true
    }
  }, [open, network])

  const close = () => {
    if (!pending) onClose()
  }

  const handleContinue = async () => {
    if (pending) return
    const ethereum = getEthereum()
    if (!ethereum) {
      onToast('MetaMask no está instalado', 'error')
      return
    }

    setPending(true)
    try {
      let from = account
      if (!from) {
        const accs = (await ethereum.request({
          method: 'eth_requestAccounts',
        })) as string[]
        from = accs[0] ?? null
      }
      if (!from) {
        onToast('Conectá tu wallet para continuar', 'error')
        return
      }

      const okChain = await ensureSepolia(ethereum)
      if (!okChain) {
        onToast('Necesitás la red Sepolia para depositar', 'error')
        return
      }

      const hash = (await ethereum.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from,
            to: PLACEHOLDER_TO,
            value: DEPOSIT_VALUE_WEI,
            data: '0x',
          },
        ],
      })) as string

      const receipt = await waitForTransactionReceipt(ethereum, hash)
      if (receipt.status === '0x0') {
        onToast('La transacción falló o fue revertida', 'error')
        return
      }
      onClose()
      onToast(
        `Depósito confirmado · ${MOCK_CRYPTO.denominationLabel}`,
        'success'
      )
    } catch (err: unknown) {
      console.error('Deposit tx', err)
      const e = err as { code?: number; message?: string }
      if (e?.code === 4001) {
        onToast('Transacción cancelada en MetaMask', 'error')
        return
      }
      const msg = typeof e?.message === 'string' ? e.message : ''
      if (/user rejected|denied|rejected/i.test(msg)) {
        onToast('Transacción cancelada en MetaMask', 'error')
      } else {
        onToast('No se pudo enviar la transacción', 'error')
      }
    } finally {
      setPending(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="modal-overlay open"
      style={{ zIndex: 220 }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending) close()
      }}
    >
      <div
        className="modal-sheet"
        style={{ paddingBottom: 28 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-handle" />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 14,
              color: 'var(--text)',
              letterSpacing: '0.5px',
            }}
          >
            CONFIRM DEPOSIT
          </span>
          <button
            type="button"
            className="import-close"
            disabled={pending}
            onClick={close}
            aria-label="Cerrar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="var(--text2)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <p className="modal-sub-label" style={{ marginBottom: 14 }}>
          Revisá el resumen y confirmá en MetaMask.
        </p>

        <div className="deposit-info" style={{ marginBottom: 18 }}>
          <div className="info-row">
            <span className="info-key">Amount</span>
            <span
              className="info-val"
              style={{ fontFamily: 'var(--mono)', color: 'var(--green)' }}
            >
              {MOCK_CRYPTO.denominationLabel}
            </span>
          </div>
          <div className="info-row">
            <span className="info-key">≈ USD</span>
            <span className="info-val" style={{ fontFamily: 'var(--mono)' }}>
              {usdApproxForDenomination()}
            </span>
          </div>
          <div className="info-row">
            <span className="info-key">Claims to mint</span>
            <span className="info-val" style={{ fontFamily: 'var(--mono)' }}>
              1
            </span>
          </div>
          <div className="info-row">
            <span className="info-key">Network</span>
            <span
              className="info-val"
              style={{
                fontFamily: 'var(--mono)',
                color:
                  network === 'Sepolia' ? 'var(--green)' : 'var(--yellow)',
              }}
            >
              {network}
            </span>
          </div>
          <div className="info-row">
            <span className="info-key">Gas fee (est.)</span>
            <span className="info-val" style={{ fontFamily: 'var(--mono)' }}>
              {gasLabel}
            </span>
          </div>
          <div className="info-row">
            <span className="info-key">Privacy</span>
            <span
              className="info-val"
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 12,
                maxWidth: '58%',
                textAlign: 'right',
              }}
            >
              Blind-Signature
            </span>
          </div>
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={pending}
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={pending}
            onClick={handleContinue}
          >
            {pending ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
                Waiting…
              </span>
            ) : (
              'Continue'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
