import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MOCK_CRYPTO } from '../mock/data'

export function Recovery() {
  const [phrase, setPhrase] = useState(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  )
  const [startIdx, setStartIdx] = useState('0')
  const [endIdx, setEndIdx] = useState('99')
  const [scanning, setScanning] = useState(false)
  const [done, setDone] = useState(false)

  const handleScan = () => {
    setScanning(true)
    setDone(false)
    window.setTimeout(() => {
      setScanning(false)
      setDone(true)
    }, 1200)
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
          RECOVERY
        </div>
        <div className="modal-sub-label" style={{ marginBottom: 0 }}>
          Mock scan · {MOCK_CRYPTO.network}
        </div>
      </div>

      <div className="deposit-info">
        <div className="type-row">
          <span className="type-label">Seed phrase</span>
        </div>
        <textarea
          className="srp-textarea"
          style={{ height: 120 }}
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="words separated by space…"
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginTop: 12,
        }}
      >
        <div className="deposit-info" style={{ marginBottom: 0 }}>
          <div className="type-label" style={{ marginBottom: 8 }}>
            Start index
          </div>
          <input
            className="wd-search flow-field"
            type="number"
            min={0}
            value={startIdx}
            onChange={(e) => setStartIdx(e.target.value)}
          />
        </div>
        <div className="deposit-info" style={{ marginBottom: 0 }}>
          <div className="type-label" style={{ marginBottom: 8 }}>
            End index
          </div>
          <input
            className="wd-search flow-field"
            type="number"
            min={0}
            value={endIdx}
            onChange={(e) => setEndIdx(e.target.value)}
          />
        </div>
      </div>

      <button
        type="button"
        className="btn-full"
        style={{ marginTop: 16, opacity: scanning ? 0.6 : 1 }}
        disabled={scanning}
        onClick={handleScan}
      >
        {scanning ? 'Scanning…' : 'Scan Blockchain'}
      </button>

      {done && (
        <div
          className="deposit-info"
          style={{
            marginTop: 16,
            borderColor: 'rgba(0,229,160,.25)',
            background: 'var(--green-dim)',
          }}
        >
          <div style={{ fontSize: 13, color: 'var(--green)', lineHeight: 1.5 }}>
            Mock: scan done for indices {startIdx}–{endIdx}. Reference:{' '}
            <span className="info-val" style={{ fontSize: 11 }}>
              {MOCK_CRYPTO.spendAddress}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
