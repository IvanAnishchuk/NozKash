import { useOutletContext } from 'react-router-dom'
import { useSelectedAccount } from '../context/selected-account-context'
import { usePrivacy } from '../context/usePrivacy'
import { useWallet } from '../hooks/useWallet'
import type { LayoutOutletContext } from '../layoutOutletContext'
import {
  MOCK_HOME_STATS,
  MOCK_RECENT_ACTIVITY,
  getAccountHomeBalanceView,
} from '../mock/data'
import type { ActivityKind } from '../mock/data'

function kindToClass(k: ActivityKind) {
  switch (k) {
    case 'Deposit':
      return 'deposit'
    case 'Redeem':
      return 'redeem'
    case 'Pending':
      return 'pending'
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
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="var(--yellow)" strokeWidth="2" />
      <path d="M12 6v6l4 2" stroke="var(--yellow)" strokeWidth="2" />
    </svg>
  )
}

export function Dashboard() {
  const { privacyOn } = usePrivacy()
  const { selectedAccountId } = useSelectedAccount()
  const { network } = useWallet()
  const { openDepositModal } = useOutletContext<LayoutOutletContext>()
  const home = getAccountHomeBalanceView(selectedAccountId)

  return (
    <div className="page-inner">
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
              {privacyOn ? '••••' : home.main}
            </div>
            <div className="balance-usd">
              {privacyOn ? '••••' : home.usd}
            </div>
          </div>
          <div className="balance-stats-col">
            <div className="stat-block">
              <div className="stat-block-row">
                <span className="stat-block-label valid">VALID</span>
                <span className="stat-block-num valid">
                  {privacyOn ? '••' : MOCK_HOME_STATS.validCount}
                </span>
              </div>
              <div className="stat-block-eth">
                {privacyOn ? '••••' : MOCK_HOME_STATS.validEth}
              </div>
            </div>
            <div className="stat-block">
              <div className="stat-block-row">
                <span className="stat-block-label spent">SPENT</span>
                <span className="stat-block-num spent">
                  {privacyOn ? '••' : MOCK_HOME_STATS.spentCount}
                </span>
              </div>
              <div className="stat-block-eth">
                {privacyOn ? '••••' : MOCK_HOME_STATS.spentEth}
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
            <div className="add-deposit-sub">
              Shield ETH · {network}
            </div>
          </div>
        </div>
        <span className="add-deposit-badge">+ MINT</span>
      </button>

      <div className="section-title">Recent activity</div>
      <div>
        {MOCK_RECENT_ACTIVITY.map((item) => {
          const ic = kindToClass(item.kind)
          return (
            <div key={item.id} className="activity-item">
              <div className="activity-left">
                <div className={`activity-icon ${ic}`}>
                  <ActivityIcon kind={item.kind} />
                </div>
                <div className="activity-text">
                  <div className="activity-type">{item.label}</div>
                  <div className="activity-time">{item.time}</div>
                </div>
              </div>
              <span
                className={`activity-amount ${ic} bal-amount`}
                data-val={item.amountStr}
              >
                {privacyOn ? '••••' : item.amountStr}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
