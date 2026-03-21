import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MOCK_AVAILABLE_TOKENS, MOCK_CRYPTO } from '../mock/data'

export function Redeem() {
  const [selectedId, setSelectedId] = useState(
    MOCK_AVAILABLE_TOKENS[0]?.id ?? ''
  )
  const [recipient, setRecipient] = useState(
    '0x0000000000000000000000000000000000000000',
  )

  const handleRedeem = () => {
    const t = MOCK_AVAILABLE_TOKENS.find((x) => x.id === selectedId)
    window.alert(
      `Mock redeem: token ${t?.label ?? '?'} → ${recipient.slice(0, 18)}…`,
    )
  }

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
          Tokens mock · {MOCK_CRYPTO.network}
        </div>
      </div>

      <div className="deposit-info">
        <div className="modal-title" style={{ fontSize: 12, marginBottom: 10 }}>
          Available tokens
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {MOCK_AVAILABLE_TOKENS.map((t) => (
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
                <div className="mm-wallet-addr">{MOCK_CRYPTO.denominationLabel}</div>
              </div>
              <div className="mm-wallet-bal">{MOCK_CRYPTO.network}</div>
            </label>
          ))}
        </div>
      </div>

      <div className="deposit-info" style={{ marginTop: 12 }}>
        <div className="type-row">
          <span className="type-label">To address</span>
        </div>
        <input
          className="wd-search flow-field"
          type="text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="0x…"
        />
      </div>

      <div className="deposit-info" style={{ marginTop: 12 }}>
        <div className="modal-title" style={{ fontSize: 11, marginBottom: 8 }}>
          Unblinded sig (mock)
        </div>
        <div className="info-val" style={{ fontSize: 10, wordBreak: 'break-all' }}>
          {MOCK_CRYPTO.unblindedSigX}
        </div>
        <div
          className="info-val"
          style={{ fontSize: 10, wordBreak: 'break-all', marginTop: 6 }}
        >
          {MOCK_CRYPTO.unblindedSigY}
        </div>
      </div>

      <button
        type="button"
        className="btn-full"
        style={{ marginTop: 16 }}
        onClick={handleRedeem}
      >
        Redeem
      </button>
    </div>
  )
}
