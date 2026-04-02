import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  buildRedemptionDraftFromSeed,
  loadRedemptionDraft,
  type RedemptionDraftV1,
} from '../crypto/nozkRedeem'
import { useNozkMasterSeed } from '../context/NozkMasterSeedProvider'
import { usePrivacy } from '../context/usePrivacy'
import {
  requestWalletBalanceRefresh,
  useWallet,
} from '../hooks/useWallet'
import { DateRangePill } from '../components/DateRangePill'
import { deriveTokenSecrets, getDepositId } from '@nozk/nozk-library'
import {
  getEthereum,
  targetChainMismatchUserMessage,
  TARGET_NETWORK_LABEL,
} from '../lib/ethereum'
import {
  ACTIVITY_TYPE_FILTERS,
  filterVaultActivity,
  formatTxAmountDisplay,
} from '../lib/historyQuery'
import { sendVaultRedeemTransaction, sendVaultRevealTransaction } from '../lib/sendVaultRedeem'
import { sendVaultRefundTransaction } from '../lib/sendVaultRefund'
import { mergeVaultRowsWithRedeemDraft } from '../lib/vaultRedeemMerge'
import { useNozkVaultActivityLive } from '../hooks/useNozkVaultActivityLive'
import type { LayoutOutletContext } from '../layoutOutletContext'
import type { ActivityKind, HistoryFilterType, VaultTx } from '../types/activity'

/** Matches `NOZK_VAULT_DEPOSIT_AMOUNT_LABEL` (0.001 ETH per deposit). */
const VAULT_DENOMINATION_ETH = 0.001

function kindToClass(k: ActivityKind) {
  switch (k) {
    case 'Deposit':
      return 'deposit'
    case 'Revealed':
      return 'revealed'
    case 'Redeem':
      return 'redeem'
    case 'Pending':
      return 'pending'
    case 'Refunded':
      return 'refunded'
  }
}

function ActivityIcon({ kind }: { kind: ActivityKind }) {
  const cls = kindToClass(kind)
  if (cls === 'deposit') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 5v14M5 12l7 7 7-7"
          stroke="var(--green)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (cls === 'revealed') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path
          d="M9 12l2 2 4-4"
          stroke="var(--green)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="10" stroke="var(--green)" strokeWidth="2" />
      </svg>
    )
  }
  if (cls === 'redeem') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 19V5M5 12l7-7 7 7"
          stroke="var(--red2)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (cls === 'refunded') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path
          d="M4 12h16M8 8l-4 4 4 4"
          stroke="var(--text2)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="var(--yellow)" strokeWidth="2" />
      <path d="M12 6v6l4 2" stroke="var(--yellow)" strokeWidth="2" />
    </svg>
  )
}

function FilterFunnelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16M7 12h10M10 18h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Dashboard() {
  const { privacyOn } = usePrivacy()
  const { effectiveMasterSeed, seedRevision } = useNozkMasterSeed()
  const { network, account, homeBalanceMain } = useWallet()
  const { openDepositModal, showToast } =
    useOutletContext<LayoutOutletContext>()

  const [redemptionDraft, setRedemptionDraft] = useState<RedemptionDraftV1 | null>(
    () => loadRedemptionDraft()
  )
  const [redeemingId, setRedeemingId] = useState<string | null>(null)
  const [revealingId, setRevealingId] = useState<string | null>(null)
  const [refundingId, setRefundingId] = useState<string | null>(null)
  /** Per-row recipient address for inline redeem */
  const [redeemRecipients, setRedeemRecipients] = useState<Record<string, string>>({})

  const [activeFilter, setActiveFilter] =
    useState<HistoryFilterType>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterWrapRef = useRef<HTMLDivElement>(null)
  const { rows: vaultChainRows, loading: vaultLoading, scanBatch } = useNozkVaultActivityLive({
    masterSeed: effectiveMasterSeed,
    seedRevision,
    network,
    networkLabel:
      network === TARGET_NETWORK_LABEL ? TARGET_NETWORK_LABEL : network,
  })

  useEffect(() => {
    setRedemptionDraft(loadRedemptionDraft())
  }, [account, seedRevision])

  // Vault activity is loaded/updated via `useNozkVaultActivityLive`.

  useEffect(() => {
    if (!filterOpen) return
    const onDown = (e: MouseEvent) => {
      const el = filterWrapRef.current
      if (el && !el.contains(e.target as Node)) setFilterOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [filterOpen])

  /** Includes a synthetic row if there is a redeem draft and the active account is the executor (≠ prepareAccount). */
  const displayRows = useMemo(
    () =>
      mergeVaultRowsWithRedeemDraft(vaultChainRows, redemptionDraft, account),
    [vaultChainRows, redemptionDraft, account]
  )

  const filtered = useMemo(() => {
    const list = filterVaultActivity(
      displayRows,
      activeFilter,
      dateFrom,
      dateTo
    )
    return [...list].sort((a, b) => {
      const d = b.dateIso.localeCompare(a.dateIso)
      if (d !== 0) return d
      const ba = a.blockNumber ?? -1
      const bb = b.blockNumber ?? -1
      if (bb !== ba) return bb - ba
      return b.id.localeCompare(a.id)
    })
  }, [activeFilter, dateFrom, dateTo, displayRows])

  const homeStats = useMemo(() => {
    const revealedCount = vaultChainRows.filter((r) => r.type === 'Revealed').length
    const pendingCount = vaultChainRows.filter((r) => r.type === 'Deposit').length
    const spentCount = vaultChainRows.filter((r) => r.type === 'Redeem').length
    return {
      revealedCount,
      pendingCount,
      spentCount,
      revealedEth: `${(revealedCount * VAULT_DENOMINATION_ETH).toFixed(3)} ETH`,
      pendingEth: `${(pendingCount * VAULT_DENOMINATION_ETH).toFixed(3)} ETH`,
      spentEth: `${(spentCount * VAULT_DENOMINATION_ETH).toFixed(3)} ETH`,
    }
  }, [vaultChainRows])

  const clearDates = () => {
    setDateFrom('')
    setDateTo('')
  }

  const handleReveal = async (item: VaultTx) => {
    if (item.tokenIndex === undefined || !effectiveMasterSeed) {
      showToast('Unlock the vault (sign) to reveal.', 'error')
      return
    }
    if (!account) {
      showToast('Connect your wallet first.', 'error')
      return
    }
    if (network !== TARGET_NETWORK_LABEL) {
      showToast(targetChainMismatchUserMessage(), 'error')
      return
    }
    const ethereum = getEthereum()
    if (!ethereum) {
      showToast('No Ethereum wallet found', 'error')
      return
    }
    setRevealingId(item.id)
    try {
      const draft = buildRedemptionDraftFromSeed(
        effectiveMasterSeed,
        item.tokenIndex,
        account
      )
      await sendVaultRevealTransaction({
        ethereum,
        draft,
        masterSeed: effectiveMasterSeed,
      })
      requestWalletBalanceRefresh()
      showToast('Reveal confirmed · nullifier registered on-chain', 'success')
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string }
      if (e?.code === 4001) {
        showToast('Transaction cancelled in your wallet', 'error')
        return
      }
      const msg =
        typeof e?.message === 'string' ? e.message : 'Could not reveal token'
      if (/user rejected|denied/i.test(msg)) {
        showToast('Transaction cancelled in your wallet', 'error')
      } else {
        showToast(msg, 'error')
      }
    } finally {
      setRevealingId(null)
    }
  }

  const isEthAddress = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s.trim())

  const handleRefund = async (item: VaultTx) => {
    if (item.type !== 'Pending' || item.tokenIndex === undefined) return
    if (!effectiveMasterSeed) {
      showToast('Unlock the vault (sign) to refund.', 'error')
      return
    }
    if (!account) {
      showToast('Connect your wallet first.', 'error')
      return
    }
    if (network !== TARGET_NETWORK_LABEL) {
      showToast(targetChainMismatchUserMessage(), 'error')
      return
    }
    const ethereum = getEthereum()
    if (!ethereum) {
      showToast('No Ethereum wallet found', 'error')
      return
    }
    setRefundingId(item.id)
    try {
      const secrets = deriveTokenSecrets(effectiveMasterSeed, item.tokenIndex)
      const depositId = getDepositId(secrets)
      await sendVaultRefundTransaction({ ethereum, depositId })
      requestWalletBalanceRefresh()
      showToast('Refund confirmed · ETH returned to this wallet', 'success')
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string }
      if (e?.code === 4001) {
        showToast('Transaction cancelled in your wallet', 'error')
        return
      }
      const msg =
        typeof e?.message === 'string' ? e.message : 'Could not refund deposit'
      if (/user rejected|denied/i.test(msg)) {
        showToast('Transaction cancelled in your wallet', 'error')
      } else {
        showToast(msg, 'error')
      }
    } finally {
      setRefundingId(null)
    }
  }

  const handleInlineRedeem = async (item: VaultTx) => {
    if (item.tokenIndex === undefined || !effectiveMasterSeed) {
      showToast('Unlock the vault (sign) to redeem.', 'error')
      return
    }
    if (!account) {
      showToast('Connect your wallet first.', 'error')
      return
    }
    if (network !== TARGET_NETWORK_LABEL) {
      showToast(targetChainMismatchUserMessage(), 'error')
      return
    }
    const recipient = (redeemRecipients[item.id] ?? '').trim()
    if (!isEthAddress(recipient)) {
      showToast('Enter a valid recipient address (0x…)', 'error')
      return
    }
    const ethereum = getEthereum()
    if (!ethereum) {
      showToast('No Ethereum wallet found', 'error')
      return
    }

    setRedeemingId(item.id)
    try {
      const draft = buildRedemptionDraftFromSeed(
        effectiveMasterSeed,
        item.tokenIndex,
        account
      )
      await sendVaultRedeemTransaction({
        ethereum,
        recipient,
        draft,
        masterSeed: effectiveMasterSeed,
      })
      requestWalletBalanceRefresh()
      showToast(`Redeem confirmed · 0.001 ETH sent to ${recipient.slice(0, 8)}…`, 'success')
      setRedeemRecipients((prev) => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string }
      if (e?.code === 4001) {
        showToast('Transaction cancelled in your wallet', 'error')
        return
      }
      const msg =
        typeof e?.message === 'string' ? e.message : 'Could not complete redeem'
      if (/user rejected|denied/i.test(msg)) {
        showToast('Transaction cancelled in your wallet', 'error')
      } else {
        showToast(msg, 'error')
      }
    } finally {
      setRedeemingId(null)
    }
  }

  return (
    <div className="page-inner page-inner--home">
      <div className="balance-card">
        <div className="balance-card-top">
          <div className="balance-label">PRIVATE BALANCE</div>
          <div className={`shield-badge ${privacyOn ? 'on' : 'off'}`}>
            <span className={`shield-dot ${privacyOn ? '' : 'off'}`} />
            <span>{privacyOn ? 'SHIELDED' : 'HIDDEN'}</span>
          </div>
        </div>
        <div className="balance-cols">
          <div className="balance-main">
            <div className="balance-amount">
              {privacyOn ? '••••' : homeStats.revealedEth}
            </div>
          </div>
          <div className="balance-stats-col">
            <div className="stat-block">
              <div className="stat-block-row">
                <span className="stat-block-label valid">AVAILABLE</span>
                <span className="stat-block-num valid">
                  {privacyOn ? '••' : homeStats.revealedCount}
                </span>
              </div>
              <div className="stat-block-eth">
                {privacyOn ? '••••' : homeStats.revealedEth}
              </div>
            </div>
            <div className="stat-block">
              <div className="stat-block-row">
                <span className="stat-block-label pending-label">PENDING</span>
                <span className="stat-block-num pending-label">
                  {privacyOn ? '••' : homeStats.pendingCount}
                </span>
              </div>
              <div className="stat-block-eth">
                {privacyOn ? '••••' : homeStats.pendingEth}
              </div>
            </div>
            <div className="stat-block">
              <div className="stat-block-row">
                <span className="stat-block-label spent">SPENT</span>
                <span className="stat-block-num spent">
                  {privacyOn ? '••' : homeStats.spentCount}
                </span>
              </div>
              <div className="stat-block-eth">
                {privacyOn ? '••••' : homeStats.spentEth}
              </div>
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="add-deposit-btn"
        onClick={() => openDepositModal()}
      >
        <div className="add-deposit-left">
          <div className="add-deposit-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 5v14M5 12h14"
                stroke="var(--text2)"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div>
            <div className="add-deposit-label">Add deposit</div>
            <div className="add-deposit-sub">Shield ETH · {network}</div>
          </div>
        </div>
        <span className="add-deposit-badge">+ MINT</span>
      </button>

      <div className="home-activity-block">
        <div className="section-title home-activity-title">Activity</div>
        <div className="home-date-toolbar">
          <DateRangePill
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            onClear={clearDates}
            className="date-range-pill--toolbar"
          />
          <div className="home-filter-wrap" ref={filterWrapRef}>
            <button
              type="button"
              className="home-filter-btn home-filter-btn--toolbar"
              aria-expanded={filterOpen}
              aria-haspopup="menu"
              aria-label="Filter by type"
              onClick={() => setFilterOpen((o) => !o)}
            >
              <FilterFunnelIcon />
            </button>
            {filterOpen ? (
              <div className="home-filter-pop" role="menu">
                {ACTIVITY_TYPE_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="menuitem"
                    className={`home-filter-option${activeFilter === f.key ? ' active' : ''}`}
                    onClick={() => {
                      setActiveFilter(f.key)
                      setFilterOpen(false)
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div>
          {scanBatch != null ? (
            <div className="no-results">
              Loading activity · batch {scanBatch + 1}…
            </div>
          ) : null}

          {filtered.length === 0 ? (
            scanBatch == null && vaultLoading ? (
              <div className="no-results">Loading activity…</div>
            ) : scanBatch == null ? (
              <div className="no-results">No transactions found</div>
            ) : null
          ) : (
            filtered.map((item) => {
              const ic = kindToClass(item.type)
              const amt = formatTxAmountDisplay(item)
              return (
                <div key={item.id} className="activity-item">
                  <div className="activity-left">
                    <div className={`activity-icon ${ic}`}>
                      <ActivityIcon kind={item.type} />
                    </div>
                    <div className="activity-text">
                      <div className="activity-type">{item.historyLabel}</div>
                      <div className="activity-time">{item.historySub}</div>
                    </div>
                  </div>
                  <div className="activity-right-col">
                    <span
                      className={`activity-amount ${ic} bal-amount`}
                      data-val={amt}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {privacyOn ? '••••' : amt}
                    </span>
                    {item.type === 'Pending' ? (
                      <div className="activity-redeem-actions">
                        {effectiveMasterSeed ? (
                          <button
                            type="button"
                            className="history-redeem-btn history-redeem-btn--secondary"
                            style={{ fontSize: 11, padding: '4px 10px' }}
                            disabled={
                              refundingId === item.id ||
                              redeemingId === item.id ||
                              startingRedeemId === item.id ||
                              network !== TARGET_NETWORK_LABEL
                            }
                            onClick={() => void handleRefund(item)}
                          >
                            {refundingId === item.id ? 'Refunding…' : 'Refund'}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {item.type === 'Deposit' ? (
                      <div className="activity-redeem-actions">
                        {effectiveMasterSeed && (
                          <button
                            type="button"
                            className="history-redeem-btn history-redeem-btn--secondary"
                            style={{ fontSize: 11, padding: '4px 10px' }}
                            disabled={
                              revealingId === item.id ||
                              network !== TARGET_NETWORK_LABEL
                            }
                            onClick={() => void handleReveal(item)}
                          >
                            {revealingId === item.id
                              ? 'Revealing…'
                              : 'Reveal'}
                          </button>
                        )}
                      </div>
                    ) : null}
                    {item.type === 'Revealed' && effectiveMasterSeed ? (
                      <div className="activity-redeem-actions" style={{ gap: 4, flexDirection: 'column', alignItems: 'flex-end' }}>
                        <input
                          className="redeem-recipient-input"
                          type="text"
                          value={redeemRecipients[item.id] ?? ''}
                          onChange={(e) =>
                            setRedeemRecipients((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                          placeholder="Recipient 0x…"
                          spellCheck={false}
                          autoComplete="off"
                          style={{
                            fontFamily: 'var(--mono)',
                            fontSize: 10,
                            padding: '3px 6px',
                            width: 140,
                            background: 'var(--bg2)',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            color: 'var(--text)',
                          }}
                        />
                        <button
                          type="button"
                          className="history-redeem-btn"
                          disabled={
                            redeemingId === item.id ||
                            !isEthAddress(redeemRecipients[item.id] ?? '') ||
                            network !== TARGET_NETWORK_LABEL
                          }
                          onClick={() => void handleInlineRedeem(item)}
                        >
                          {redeemingId === item.id
                            ? 'Sending…'
                            : 'Redeem'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

    </div>
  )
}
