import { useMemo, useState } from 'react'
import { usePrivacy } from '../context/usePrivacy'
import type { ActivityKind, HistoryFilterType } from '../mock/data'
import { MOCK_HISTORY } from '../mock/data'

const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const

function fmtDayLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`
}

function typeToFilter(t: ActivityKind): Exclude<HistoryFilterType, 'all'> {
  switch (t) {
    case 'Deposit':
      return 'deposit'
    case 'Redeem':
      return 'redeem'
    case 'Pending':
      return 'pending'
  }
}

function HistoryIcon({ type }: { type: ActivityKind }) {
  if (type === 'Deposit') {
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
  if (type === 'Redeem') {
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
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="var(--yellow)" strokeWidth="2" />
      <path d="M12 6v6l4 2" stroke="var(--yellow)" strokeWidth="2" />
    </svg>
  )
}

const FILTERS: { key: HistoryFilterType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'deposit', label: 'Deposits' },
  { key: 'redeem', label: 'Redeems' },
  { key: 'pending', label: 'Pending' },
]

export function History() {
  const { privacyOn } = usePrivacy()
  const [activeFilter, setActiveFilter] = useState<HistoryFilterType>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const filtered = useMemo(() => {
    return MOCK_HISTORY.filter((item) => {
      if (activeFilter !== 'all' && typeToFilter(item.type) !== activeFilter) {
        return false
      }
      if (dateFrom && item.dateIso < dateFrom) return false
      if (dateTo && item.dateIso > dateTo) return false
      return true
    })
  }, [activeFilter, dateFrom, dateTo])

  const groups = useMemo(() => {
    const g = new Map<string, typeof MOCK_HISTORY>()
    for (const item of filtered) {
      const label = fmtDayLabel(item.dateIso).toUpperCase()
      const arr = g.get(label) ?? []
      arr.push(item)
      g.set(label, arr)
    }
    return Array.from(g.entries())
  }, [filtered])

  const clearDates = () => {
    setDateFrom('')
    setDateTo('')
  }

  return (
    <div className="page-inner">
      <div className="filter-row">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`filter-tab${activeFilter === f.key ? ' active' : ''}`}
            onClick={() => setActiveFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="date-row">
        <span className="date-label">FROM</span>
        <input
          className="date-inp"
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
        />
        <span className="date-sep">–</span>
        <input
          className="date-inp"
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
        />
        <button type="button" className="date-clr" onClick={clearDates}>
          Clear
        </button>
      </div>

      <div id="historyList">
        {groups.length === 0 ? (
          <div className="no-results">No transactions found</div>
        ) : (
          groups.map(([dayLabel, items], gi) => (
            <div key={dayLabel}>
              <div
                className="section-title"
                style={gi > 0 ? { marginTop: 14 } : undefined}
              >
                {dayLabel}
              </div>
              {items.map((item) => {
                const t = typeToFilter(item.type)
                const amt =
                  item.type === 'Deposit'
                    ? `+${item.amount}`
                    : item.type === 'Redeem'
                      ? `-${item.amount}`
                      : item.amount
                return (
                  <div key={item.id} className="activity-item">
                    <div className="activity-left">
                      <div className={`activity-icon ${t}`}>
                        <HistoryIcon type={item.type} />
                      </div>
                      <div className="activity-text">
                        <div className="activity-type">{item.historyLabel}</div>
                        <div className="activity-time">{item.historySub}</div>
                      </div>
                    </div>
                    <span
                      className={`activity-amount ${t} bal-amount`}
                      data-val={amt}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {privacyOn ? '••••' : amt}
                    </span>
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
