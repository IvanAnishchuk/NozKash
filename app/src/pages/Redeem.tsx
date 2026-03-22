import { useEffect, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useGhostMasterSeed } from '../context/GhostMasterSeedProvider'
import {
  requestWalletBalanceRefresh,
  useWallet,
} from '../hooks/useWallet'
import {
  buildRedemptionDraftFromSeed,
  loadRedemptionDraft,
  redemptionDraftMatchesSecrets,
  saveRedemptionDraft,
} from '../crypto/ghostRedeem'
import { ensureFuji, getEthereum } from '../lib/ethereum'
import {
  fetchVaultActivityForFirstTokens,
  GHOST_VAULT_DEPOSIT_AMOUNT_LABEL,
  GHOST_VAULT_RPC_POLL_MS,
} from '../lib/ghostVault'
import { sendVaultRedeemTransaction } from '../lib/sendVaultRedeem'
import type { LayoutOutletContext } from '../layoutOutletContext'

function isEthAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s.trim())
}

function addrPickLabel(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

type RedeemableRow = {
  id: string
  tokenIndex: number
  label: string
}

export function Redeem() {
  const { network, accounts, account, openMetaMaskAccountPicker } =
    useWallet()
  const { effectiveMasterSeed, seedRevision } = useGhostMasterSeed()
  const { showToast } = useOutletContext<LayoutOutletContext>()
  const [tokens, setTokens] = useState<RedeemableRow[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [recipient, setRecipient] = useState('')
  const [recipientTouched, setRecipientTouched] = useState(false)
  const [pickerPending, setPickerPending] = useState(false)
  const [preparePending, setPreparePending] = useState(false)
  const [sendPending, setSendPending] = useState(false)
  const [storedDraftSummary, setStoredDraftSummary] = useState<string | null>(
    null
  )

  const seedRef = useRef(effectiveMasterSeed)
  const networkRef = useRef(network)
  seedRef.current = effectiveMasterSeed
  networkRef.current = network

  useEffect(() => {
    if (account && !recipientTouched) {
      setRecipient(account)
    }
  }, [account, recipientTouched])

  useEffect(() => {
    if (!effectiveMasterSeed) {
      setTokens([])
      setLoadError(
        'Conectá la wallet y aceptá la firma del vault (válida mientras sigas conectado), o definí VITE_GHOST_MASTER_SEED_HEX (dev).'
      )
      setLoading(false)
      return
    }

    let cancelled = false
    setTokens([])
    setLoadError(null)
    setLoading(true)

    let firstTick = true

    async function load(isInitial: boolean) {
      const seed = seedRef.current
      const net = networkRef.current
      if (!seed) return
      if (isInitial) {
        setLoading(true)
        setLoadError(null)
      }
      try {
        const rows = await fetchVaultActivityForFirstTokens(seed, {
          networkLabel: net === 'Fuji' ? 'Fuji' : net,
        })
        if (cancelled) return
        const redeemable = rows
          .filter((r) => r.type === 'Deposit' && r.tokenIndex !== undefined)
          .map((r) => ({
            id: r.id,
            tokenIndex: r.tokenIndex!,
            label: r.historyLabel,
          }))
        setTokens(redeemable)
        setSelectedId((prev) => {
          if (prev && redeemable.some((t) => t.id === prev)) return prev
          return redeemable[0]?.id ?? ''
        })
        if (isInitial) setLoadError(null)
      } catch (e) {
        if (!cancelled && isInitial) {
          setLoadError(
            e instanceof Error ? e.message : 'No se pudo cargar el vault'
          )
          setTokens([])
        }
      } finally {
        if (!cancelled && isInitial) setLoading(false)
      }
    }

    const intervalId = window.setInterval(() => {
      void load(firstTick)
      firstTick = false
    }, GHOST_VAULT_RPC_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [network, seedRevision, account, !!effectiveMasterSeed])

  useEffect(() => {
    const d = loadRedemptionDraft()
    if (!d) {
      setStoredDraftSummary(null)
      return
    }
    setStoredDraftSummary(
      `Token #${d.tokenIndex} · depositId ${addrPickLabel(d.depositId)} · nullifier ${addrPickLabel(d.spendAddress)}`
    )
  }, [seedRevision, preparePending])

  const handlePrepareRedeem = () => {
    const seed = effectiveMasterSeed
    if (!seed) {
      showToast('Hace falta la semilla del vault (firmá en MetaMask o usá env).', 'error')
      return
    }
    const t = tokens.find((x) => x.id === selectedId)
    if (!t) {
      showToast('Elegí un token con mint cumplido.', 'error')
      return
    }
    setPreparePending(true)
    try {
      const draft = buildRedemptionDraftFromSeed(
        seed,
        t.tokenIndex,
        account ?? undefined
      )
      saveRedemptionDraft(draft)
      setStoredDraftSummary(
        `Token #${draft.tokenIndex} · depositId ${addrPickLabel(draft.depositId)} · nullifier ${addrPickLabel(draft.spendAddress)}`
      )
      showToast(
        'Paso 1 listo: claves spend/blind guardadas en este navegador. Cambiá a la cuenta que paga el gas y usá “Enviar transacción”.',
        'info'
      )
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'No se pudo guardar el borrador de redeem',
        'error'
      )
    } finally {
      setPreparePending(false)
    }
  }

  const handleSendRedeemTx = async () => {
    if (!isEthAddress(recipient)) {
      showToast('Indicá una dirección Ethereum válida (0x + 40 hex).', 'error')
      return
    }
    const draft = loadRedemptionDraft()
    if (!draft) {
      showToast('Primero usá “Paso 1: guardar claves” con el token elegido.', 'error')
      return
    }
    const seed = effectiveMasterSeed
    if (seed && !redemptionDraftMatchesSecrets(draft, seed)) {
      showToast(
        'El borrador no coincide con la semilla actual. Volvé a preparar el redeem.',
        'error'
      )
      return
    }

    const ethereum = getEthereum()
    if (!ethereum) {
      showToast('MetaMask no está disponible', 'error')
      return
    }

    setSendPending(true)
    try {
      const okChain = await ensureFuji(ethereum)
      if (!okChain) {
        showToast('Cambiá a Avalanche Fuji (43113) en MetaMask.', 'error')
        return
      }

      const { txHash } = await sendVaultRedeemTransaction({
        ethereum,
        recipient: recipient.trim(),
        draft,
        masterSeed: seed ?? null,
      })

      setStoredDraftSummary(null)
      requestWalletBalanceRefresh()
      showToast(`Redeem confirmado · ${txShort(txHash)}`, 'success')
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string }
      if (e?.code === 4001) {
        showToast('Transacción cancelada en MetaMask', 'error')
        return
      }
      const msg = typeof e?.message === 'string' ? e.message : ''
      if (/user rejected|denied/i.test(msg)) {
        showToast('Transacción cancelada en MetaMask', 'error')
      } else {
        showToast(
          msg || 'No se pudo enviar el redeem',
          'error'
        )
      }
    } finally {
      setSendPending(false)
    }
  }

  function txShort(hash: string): string {
    if (hash.length > 14) return `${hash.slice(0, 10)}…${hash.slice(-6)}`
    return hash
  }

  const openAccountPicker = async () => {
    setPickerPending(true)
    try {
      await openMetaMaskAccountPicker()
    } finally {
      setPickerPending(false)
    }
  }

  const netLabel = network === 'Fuji' ? 'Avalanche · Fuji' : network

  return (
    <div className="page-inner">
      <div className="flow-page-head">
        <Link to="/" className="import-back">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 4L6 8l4 4"
              stroke="var(--text2)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          Back
        </Link>
        <div className="modal-title" style={{ marginTop: 16 }}>
          REDEEM
        </div>
        <div className="modal-sub-label" style={{ marginBottom: 0 }}>
          Tokens con MintFulfilled · {netLabel}
        </div>
      </div>

      <div className="deposit-info">
        <div className="modal-title" style={{ fontSize: 12, marginBottom: 10 }}>
          Available tokens
        </div>
        {loading && (
          <div className="modal-sub-label" style={{ marginBottom: 8 }}>
            Cargando…
          </div>
        )}
        {loadError && (
          <div style={{ fontSize: 12, color: 'var(--red2)', marginBottom: 8 }}>
            {loadError}
          </div>
        )}
        {!loading && !loadError && tokens.length === 0 && (
          <div className="modal-sub-label">
            Ningún depósito con mint cumplido para esta semilla.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tokens.map((t) => (
            <label
              key={t.id}
              className="mm-wallet-item"
              style={{ cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="tok"
                checked={selectedId === t.id}
                onChange={() => setSelectedId(t.id)}
                style={{ display: 'none' }}
              />
              <div
                className="mm-wallet-avatar"
                style={{
                  background: '#003D2A',
                  color: 'rgba(255,255,255,.8)',
                  fontSize: 10,
                }}
              >
                {t.tokenIndex}
              </div>
              <div className="mm-wallet-info">
                <div className="mm-wallet-name">{t.label}</div>
                <div className="mm-wallet-addr">{GHOST_VAULT_DEPOSIT_AMOUNT_LABEL}</div>
              </div>
              <div className="mm-wallet-bal">{netLabel}</div>
            </label>
          ))}
        </div>
      </div>

      <div className="deposit-info" style={{ marginTop: 12 }}>
        <div className="type-row" style={{ marginBottom: 8 }}>
          <span className="type-label">Destino · a qué cuenta va el redeem</span>
        </div>
        <p
          className="modal-sub-label"
          style={{ marginBottom: 10, fontSize: 11, lineHeight: 1.45 }}
        >
          Elegí una de las cuentas de MetaMask o escribí otra dirección. Esa
          dirección es el <strong>recipient</strong> del contrato: recibe los
          0.01 AVAX. La firma ECDSA del redeem la genera la app con la clave{' '}
          <strong>spend</strong> (nullifier), no la clave blind.
        </p>
        {accounts.length > 0 ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: 12,
            }}
          >
            {accounts.map((a) => (
              <button
                key={a}
                type="button"
                className={`preset-btn${
                  recipient.toLowerCase() === a.toLowerCase() ? ' active' : ''
                }`}
                onClick={() => {
                  setRecipientTouched(true)
                  setRecipient(a)
                }}
                style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
              >
                {addrPickLabel(a)}
                {account?.toLowerCase() === a.toLowerCase() ? ' · activa' : ''}
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className="btn-secondary"
          style={{ marginBottom: 12, width: '100%' }}
          disabled={pickerPending || network !== 'Fuji'}
          onClick={() => void openAccountPicker()}
        >
          {pickerPending
            ? 'MetaMask…'
            : 'Elegir otra cuenta en MetaMask (más direcciones)'}
        </button>
        <div className="type-row" style={{ marginBottom: 6 }}>
          <span className="type-label" style={{ fontSize: 11 }}>
            Dirección manual
          </span>
        </div>
        <input
          className="wd-search flow-field"
          type="text"
          value={recipient}
          onChange={(e) => {
            setRecipientTouched(true)
            setRecipient(e.target.value.trim())
          }}
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
          style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
        />
      </div>

      <div className="deposit-info" style={{ marginTop: 12 }}>
        <div className="modal-title" style={{ fontSize: 11, marginBottom: 8 }}>
          Flujo en dos pasos
        </div>
        <div className="modal-sub-label" style={{ fontSize: 11, lineHeight: 1.45 }}>
          <strong>Paso 1</strong> (cuenta que tiene la semilla del vault): guardá en{' '}
          <code style={{ fontSize: 10 }}>localStorage</code> por token: clave
          privada <strong>blind</strong>, clave privada <strong>spend</strong>, y
          dirección <strong>spend</strong> (nullifier on-chain). El depósito del
          token se enlaza por <code>depositId</code> (= dirección blind), igual que
          en <code>DepositLocked</code>.
        </div>
        <div
          className="modal-sub-label"
          style={{ fontSize: 11, lineHeight: 1.45, marginTop: 8 }}
        >
          <strong>Paso 2</strong> (otra cuenta en MetaMask, p. ej. quien paga gas):
          la app lee S′ del evento <code>MintFulfilled</code> (no de{' '}
          <code>DepositLocked</code> — ese evento lleva el punto ciego{' '}
          <code>B</code>). Con <code>r</code> derivado de la clave{' '}
          <strong>blind</strong> se calcula{' '}
          <code>unblindSignature(S′, r)</code> →{' '}
          <code>unblindedSignatureS</code>. La firma ECDSA{' '}
          <code>spendSignature</code> debe ser{' '}
          <code>generateRedemptionProof(spendPriv)</code> — clave{' '}
          <strong>spend</strong>, no blind — para que <code>ecrecover</code> coincida
          con <code>nullifier</code> (= dirección spend guardada).{' '}
          <code>recipient</code> suele ser la cuenta destino (p. ej. Account 2).
        </div>
        <div
          className="modal-sub-label"
          style={{ fontSize: 11, lineHeight: 1.45, marginTop: 8 }}
        >
          Enviá la tx <code>redeem(recipient, spendSignature, nullifier,
          unblindedSignatureS)</code>: MetaMask solo firma la transacción EVM; el
          calldata se arma en la app con el borrador.
        </div>
        {storedDraftSummary ? (
          <div
            style={{
              fontSize: 11,
              marginTop: 10,
              fontFamily: 'var(--mono)',
              color: 'var(--text2)',
            }}
          >
            Borrador: {storedDraftSummary}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className="btn-secondary"
        style={{ marginTop: 12, width: '100%' }}
        onClick={() => void handlePrepareRedeem()}
        disabled={
          loading ||
          tokens.length === 0 ||
          !effectiveMasterSeed ||
          preparePending ||
          network !== 'Fuji'
        }
      >
        {preparePending ? 'Guardando…' : 'Paso 1: guardar claves (spend + blind)'}
      </button>

      <button
        type="button"
        className="btn-full"
        style={{ marginTop: 10 }}
        onClick={() => void handleSendRedeemTx()}
        disabled={
          loading ||
          !isEthAddress(recipient) ||
          sendPending ||
          network !== 'Fuji'
        }
      >
        {sendPending ? 'MetaMask…' : 'Paso 2: enviar redeem (MetaMask)'}
      </button>
    </div>
  )
}
