import { useState } from 'react'

type Panel = 'menu' | 'srp' | 'pk'

type Props = {
  open: boolean
  onClose: () => void
  onToast: (msg: string, type?: 'success' | 'error') => void
}

export function AddWalletModal({ open, onClose, onToast }: Props) {
  const [panel, setPanel] = useState<Panel>('menu')
  const [srp, setSrp] = useState('')
  const [pk, setPk] = useState('')
  const [pkVisible, setPkVisible] = useState(false)

  const close = () => {
    setPanel('menu')
    onClose()
  }

  const backToMenu = () => setPanel('menu')

  if (!open) return null

  return (
    <div
      className="modal-overlay open"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="modal-sheet" style={{ paddingBottom: 28 }} onMouseDown={(e) => e.stopPropagation()}>
        {panel === 'menu' && (
          <div id="aws-menu">
            <div className="modal-handle" />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 24,
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
                ADD WALLET
              </span>
              <button
                type="button"
                className="import-close"
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
            <button
              type="button"
              className="aw-option"
              onClick={() => setPanel('srp')}
            >
              <div className="aw-left">
                <div className="aw-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <rect
                      x="3"
                      y="4"
                      width="18"
                      height="16"
                      rx="2"
                      stroke="var(--text2)"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M3 9h18M8 4v5"
                      stroke="var(--text2)"
                      strokeWidth="1.5"
                    />
                  </svg>
                </div>
                <span className="aw-label">Import a wallet</span>
              </div>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M6 4l4 4-4 4"
                  stroke="var(--text2)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="aw-option"
              onClick={() => setPanel('pk')}
            >
              <div className="aw-left">
                <div className="aw-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M19 12h-7m0 0l3-3m-3 3l3 3M5 12a7 7 0 1 0 14 0A7 7 0 0 0 5 12"
                      stroke="var(--text2)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <span className="aw-label">Import an account</span>
              </div>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M6 4l4 4-4 4"
                  stroke="var(--text2)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        )}

        {panel === 'srp' && (
          <div id="aws-srp" className="import-screen active">
            <div className="import-header">
              <button type="button" className="import-back" onClick={backToMenu}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M10 4L6 8l4 4"
                    stroke="var(--text2)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                Back
              </button>
              <button
                type="button"
                className="import-close"
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
            <div className="import-title">Import a wallet</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
              Enter your Secret Recovery Phrase
            </div>
            <div className="import-disclaimer">
              Make sure no one is watching. Your phrase gives full access to your
              wallet.
            </div>
            <textarea
              className="srp-textarea"
              placeholder="Add a space between each word..."
              value={srp}
              onChange={(e) => setSrp(e.target.value)}
            />
            <div className="srp-paste-row">
              <button
                type="button"
                className="srp-paste"
                onClick={() => {
                  setSrp(
                    'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12'
                  )
                  onToast('Phrase pasted', 'success')
                }}
              >
                Paste
              </button>
            </div>
            <button
              type="button"
              className="btn-full"
              onClick={() => {
                if (srp.trim()) {
                  close()
                  onToast('Wallet imported', 'success')
                } else onToast('Enter recovery phrase', 'error')
              }}
            >
              Continue
            </button>
          </div>
        )}

        {panel === 'pk' && (
          <div id="aws-pk" className="import-screen active">
            <div className="import-header">
              <button type="button" className="import-back" onClick={backToMenu}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M10 4L6 8l4 4"
                    stroke="var(--text2)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                Back
              </button>
              <button
                type="button"
                className="import-close"
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
            <div className="import-title">Import an account</div>
            <div
              className="import-disclaimer"
              style={{
                background: 'var(--surface2)',
                borderColor: 'var(--border)',
                color: 'var(--text2)',
              }}
            >
              Imported accounts won&apos;t be associated with your eGhostCash
              recovery phrase.
            </div>
            <div className="type-row">
              <span className="type-label">Select type</span>
              <select className="type-select" defaultValue="pk">
                <option value="pk">Private key</option>
                <option value="json">JSON file</option>
              </select>
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text3)',
                fontFamily: 'var(--mono)',
                marginBottom: 8,
              }}
            >
              ENTER YOUR PRIVATE KEY
            </div>
            <div className="pk-input-wrap">
              <input
                className="pk-input"
                type={pkVisible ? 'text' : 'password'}
                id="pkInput"
                placeholder="0x..."
                value={pk}
                onChange={(e) => setPk(e.target.value)}
              />
              <button
                type="button"
                className="pk-eye"
                onClick={() => setPkVisible((v) => !v)}
                aria-label="Toggle visibility"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"
                    stroke="var(--text3)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M1 1l22 22"
                    stroke="var(--text3)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  if (pk.trim()) {
                    close()
                    onToast('Account imported', 'success')
                  } else onToast('Enter private key', 'error')
                }}
              >
                Import
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
