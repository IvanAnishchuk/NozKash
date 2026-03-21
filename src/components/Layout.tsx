import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { AddWalletModal } from './eghost/AddWalletModal'
import { DepositConfirmModal } from './eghost/DepositConfirmModal'
import { EgcNavbarLogo } from './eghost/EgcNavbarLogo'
import { SplashScreen } from './eghost/SplashScreen'
import { usePrivacy } from '../context/usePrivacy'
import { useSelectedAccount } from '../context/selected-account-context'
import { useWallet } from '../hooks/useWallet'
import type { MockEgcWalletRow } from '../mock/data'
import { MOCK_EGC_WALLETS } from '../mock/data'
import type { LayoutOutletContext } from '../layoutOutletContext'

function addrInitials(address: string) {
  const hex = address.replace(/^0x/i, '')
  return (hex.slice(0, 2) || '?').toUpperCase()
}

export function Layout() {
  const { privacyOn, togglePrivacy } = usePrivacy()
  const { selectedAccountId, setSelectedAccountId } = useSelectedAccount()
  const { connectWallet, account, truncatedAddress } = useWallet()

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [walletSearch, setWalletSearch] = useState('')
  const [addWalletOpen, setAddWalletOpen] = useState(false)
  const [addWalletKey, setAddWalletKey] = useState(0)
  const [extraWallets, setExtraWallets] = useState<MockEgcWalletRow[]>([])
  const [depositModalOpen, setDepositModalOpen] = useState(false)
  const [toast, setToast] = useState<{
    msg: string
    type: 'success' | 'error'
    show: boolean
  } | null>(null)

  const pillRef = useRef<HTMLDivElement | null>(null)
  const dropRef = useRef<HTMLDivElement | null>(null)

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type, show: true })
    window.setTimeout(() => {
      setToast((t) => (t ? { ...t, show: false } : null))
    }, 2800)
  }, [])

  const openDepositModal = useCallback(() => setDepositModalOpen(true), [])

  const appendMockAccount = useCallback(() => {
    setExtraWallets((prev) => {
      const ids = [
        ...MOCK_EGC_WALLETS.map((x) => x.id),
        ...prev.map((x) => x.id),
      ]
      const next = Math.max(0, ...ids) + 1
      const hex = () => Math.random().toString(16).slice(2, 6)
      return [
        ...prev,
        {
          id: next,
          name: `Account ${next}`,
          addrShort: `0x${hex()}...${hex()}`,
          bal: '0.00 ETH',
          color: '#1A2C3D',
          initials: `A${next}`,
        },
      ]
    })
    showToast('Account created', 'success')
  }, [showToast])

  const walletRows = useMemo(() => {
    const base = MOCK_EGC_WALLETS.map((w) => {
      if (w.id === 1 && account) {
        return {
          ...w,
          addrShort:
            truncatedAddress ??
            `${account.slice(0, 6)}...${account.slice(-4)}`,
          initials: addrInitials(account),
        }
      }
      return { ...w }
    })
    return [...base, ...extraWallets]
  }, [account, truncatedAddress, extraWallets])

  const filteredWallets = useMemo(() => {
    const q = walletSearch.toLowerCase()
    if (!q) return walletRows
    return walletRows.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.addrShort.toLowerCase().includes(q)
    )
  }, [walletRows, walletSearch])

  useEffect(() => {
    if (!dropdownOpen) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (pillRef.current?.contains(t)) return
      if (dropRef.current?.contains(t)) return
      setDropdownOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [dropdownOpen])

  const primaryWallet =
    walletRows.find((w) => w.id === selectedAccountId) ?? walletRows[0]

  const eyeBorderStyle = privacyOn
    ? { borderColor: 'rgba(0,229,160,.3)' as const }
    : undefined

  return (
    <div className="egc-root">
      <div className="egc-app">
        <SplashScreen />

        {toast && (
          <div className={`toast ${toast.type} ${toast.show ? 'show' : ''}`}>
            {toast.msg}
          </div>
        )}

        <div className="navbar">
          <EgcNavbarLogo />
          <div className="navbar-right">
            <button
              type="button"
              className="eye-btn"
              style={eyeBorderStyle}
              onClick={togglePrivacy}
              aria-label={privacyOn ? 'Mostrar montos' : 'Ocultar montos'}
            >
              {privacyOn ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"
                    stroke="var(--green)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M1 1l22 22"
                    stroke="var(--green)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
                    stroke="var(--text2)"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="3"
                    stroke="var(--text2)"
                    strokeWidth="1.5"
                  />
                </svg>
              )}
            </button>

            {!account ? (
              <button
                type="button"
                className="wallet-pill"
                onClick={() => connectWallet()}
              >
                <span className="wallet-name" style={{ maxWidth: 120 }}>
                  Connect Wallet
                </span>
              </button>
            ) : (
              <div
                ref={pillRef}
                className={`wallet-pill ${dropdownOpen ? 'open' : ''}`}
                onClick={() => setDropdownOpen((o) => !o)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setDropdownOpen((o) => !o)
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div
                  className="wallet-avatar"
                  style={{
                    background: primaryWallet?.color ?? '#3D0F18',
                    color: 'rgba(255,255,255,.7)',
                    fontSize: 9,
                    fontFamily: 'var(--mono)',
                  }}
                >
                  {primaryWallet?.initials ?? 'MM'}
                </div>
                <span className="wallet-name">
                  {primaryWallet?.name ?? 'Wallet'}
                </span>
                <svg
                  className="wallet-chevron"
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                >
                  <path
                    d="M2 4l4 4 4-4"
                    stroke="var(--text2)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            )}
          </div>
        </div>

        <div
          ref={dropRef}
          className={`wallet-dropdown ${dropdownOpen ? '' : 'hidden'}`}
        >
          <div className="wd-header">
            <span className="wd-title">MY ACCOUNTS</span>
          </div>
          <div className="wd-search-wrap">
            <input
              className="wd-search"
              placeholder="Search accounts..."
              value={walletSearch}
              onChange={(e) => setWalletSearch(e.target.value)}
            />
          </div>
          <div className="wd-list">
            {filteredWallets.map((w) => (
              <div
                key={w.id}
                className={`wd-item ${
                  w.id === selectedAccountId ? 'active-wallet' : ''
                }`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setSelectedAccountId(w.id)
                  setDropdownOpen(false)
                  showToast(`Switched to ${w.name}`, 'success')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setSelectedAccountId(w.id)
                    setDropdownOpen(false)
                    showToast(`Switched to ${w.name}`, 'success')
                  }
                }}
              >
                <div
                  className="wd-avatar"
                  style={{
                    background: w.color,
                    color: 'rgba(255,255,255,.8)',
                    fontSize: 10,
                  }}
                >
                  {w.initials}
                </div>
                <div className="wd-info">
                  <div className="wd-wname">{w.name}</div>
                  <div className="wd-addr">{w.addrShort}</div>
                </div>
                <div className="wd-bal">
                  {privacyOn ? '••••' : w.bal}
                </div>
                {w.id === selectedAccountId ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle
                      cx="8"
                      cy="8"
                      r="7"
                      stroke="var(--red2)"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M5 8l2 2 4-4"
                      stroke="var(--red2)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <div style={{ width: 16 }} />
                )}
              </div>
            ))}
          </div>
          <div className="wd-divider" />
          <div
            className="wd-action"
            role="button"
            tabIndex={0}
            onClick={() => {
              setDropdownOpen(false)
              appendMockAccount()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setDropdownOpen(false)
                appendMockAccount()
              }
            }}
          >
            <div className="wd-action-icon">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M7 2v10M2 7h10"
                  stroke="var(--text2)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <span className="wd-action-label">Add account</span>
          </div>
          <div
            className="wd-action"
            role="button"
            tabIndex={0}
            onClick={() => {
              setDropdownOpen(false)
              setAddWalletKey((k) => k + 1)
              setAddWalletOpen(true)
            }}
          >
            <div className="wd-action-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect
                  x="2"
                  y="6"
                  width="20"
                  height="12"
                  rx="2"
                  stroke="var(--text2)"
                  strokeWidth="1.5"
                />
                <path d="M2 10h20" stroke="var(--text2)" strokeWidth="1.5" />
              </svg>
            </div>
            <span className="wd-action-label">Add wallet</span>
          </div>
        </div>

        <main className="screen active">
          <Outlet
            context={{ openDepositModal } satisfies LayoutOutletContext}
          />
        </main>

        <DepositConfirmModal
          open={depositModalOpen}
          onClose={() => setDepositModalOpen(false)}
          onToast={showToast}
        />

        <nav className="bottom-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"
                stroke="var(--text2)"
                strokeWidth="1.5"
              />
              <polyline
                points="9 22 9 12 15 12 15 22"
                stroke="var(--text2)"
                strokeWidth="1.5"
              />
            </svg>
            <span className="nav-label">HOME</span>
          </NavLink>
          <NavLink
            to="/history"
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none">
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="var(--text2)"
                strokeWidth="1.5"
              />
              <path
                d="M12 6v6l4 2"
                stroke="var(--text2)"
                strokeWidth="1.5"
              />
            </svg>
            <span className="nav-label">HISTORY</span>
          </NavLink>
        </nav>

        <AddWalletModal
          key={addWalletKey}
          open={addWalletOpen}
          onClose={() => setAddWalletOpen(false)}
          onToast={showToast}
        />
      </div>
    </div>
  )
}
