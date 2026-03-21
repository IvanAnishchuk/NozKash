/** Single source of mock truth for the Ghost-Tip wallet UI (no on-chain crypto). */

export const MOCK_CRYPTO = {
  spendAddress: '0x9355eb29da61d3a94343bf76e6458b6032c8c2e6',
  blindedPointX:
    '0x2199699490514eba0a2b2d86646b9f5301d0ad7b12315169b880cb4b10be8257',
  blindedPointY:
    '0xd52d3a55b22f9e020e437e40f54ce93a6bc42b67706b1220022b23bd16abb11',
  unblindedSigX:
    '0x937017581b5a126f39c4fd65a21331b25af3e39dd8c22fb938f3f9d092e7f3b',
  unblindedSigY:
    '0x1173c27673d294a2f4a7d4c79f36873a60f7c285af31b62d9c2f2daa090f2718',
  denominationEth: 0.01,
  denominationLabel: '0.01 ETH',
  network: 'Sepolia',
} as const

export type ActivityKind = 'Deposit' | 'Redeem' | 'Pending'

export interface MockActivity {
  id: string
  kind: ActivityKind
  label: string
  time: string
  /** Monto mostrado a la derecha (diseño tipo eGhostCash). */
  amountStr: string
}

/** Home stats (fijas al cambiar cuenta; alineado con eghostcash_wallet_v1_4e.html). */
export const MOCK_HOME_STATS = {
  validCount: 3,
  validEth: '0.03 ETH',
  spentCount: 2,
  spentEth: '0.02 ETH',
} as const

/** Balance principal + USD por cuenta (script `bals` / `usds` del HTML). */
const ACCOUNT_HOME_BALANCE: Record<number, { main: string; usd: string }> = {
  1: { main: '0.03 ETH', usd: '≈ $72.50 USD' },
  2: { main: '0.12 ETH', usd: '≈ $290.40 USD' },
  3: { main: '0.005 ETH', usd: '≈ $12.09 USD' },
}

export function getAccountHomeBalanceView(accountId: number): {
  main: string
  usd: string
} {
  return ACCOUNT_HOME_BALANCE[accountId] ?? {
    main: '0.00 ETH',
    usd: '≈ $0.00 USD',
  }
}

/** Filas del dropdown MY ACCOUNTS (HTML `wallets`). */
export interface MockEgcWalletRow {
  id: number
  name: string
  addrShort: string
  bal: string
  color: string
  initials: string
}

export const MOCK_EGC_WALLETS: MockEgcWalletRow[] = [
  {
    id: 1,
    name: 'Account 1',
    addrShort: '0x7f3a...d91c',
    bal: '0.03 ETH',
    color: '#3D0F18',
    initials: 'A1',
  },
  {
    id: 2,
    name: 'Account 2',
    addrShort: '0x4b2e...8a5f',
    bal: '0.12 ETH',
    color: '#1A1A3D',
    initials: 'A2',
  },
  {
    id: 3,
    name: 'Account 3',
    addrShort: '0x9c1d...3b7e',
    bal: '0.005 ETH',
    color: '#003D2A',
    initials: 'A3',
  },
]

export const MOCK_RECENT_ACTIVITY: MockActivity[] = [
  {
    id: 'a1',
    kind: 'Pending',
    label: 'Pending',
    time: `Just now · ${MOCK_CRYPTO.network}`,
    amountStr: '0.01 ETH',
  },
  {
    id: 'a2',
    kind: 'Redeem',
    label: 'Redeem claim',
    time: `3 hr ago · Claim #4 · ${MOCK_CRYPTO.network}`,
    amountStr: '-0.01 ETH',
  },
  {
    id: 'a3',
    kind: 'Deposit',
    label: 'Deposit',
    time: `5 hr ago · TX 0xc3d4... · ${MOCK_CRYPTO.network}`,
    amountStr: '+0.01 ETH',
  },
]

export interface MockRedeemToken {
  id: string
  tokenIndex: number
  label: string
}

export const MOCK_AVAILABLE_TOKENS: MockRedeemToken[] = [
  { id: 't42', tokenIndex: 42, label: 'Token #42' },
  { id: 't41', tokenIndex: 41, label: 'Token #41' },
]

export type HistoryFilterType = 'all' | 'deposit' | 'redeem' | 'pending'

export interface MockTx {
  id: string
  type: ActivityKind
  amount: string
  counterparty: string
  time: string
  txHash: string
  /** ISO date YYYY-MM-DD para filtros. */
  dateIso: string
  /** Título principal en lista agrupada. */
  historyLabel: string
  /** Subtítulo (segunda línea). */
  historySub: string
}

const net = MOCK_CRYPTO.network

/** Paridad con `historyData` del HTML (fechas 2026). */
export const MOCK_HISTORY: MockTx[] = [
  {
    id: 'tx-h1',
    type: 'Pending',
    amount: '0.01 ETH',
    counterparty: '—',
    time: '2026-03-21',
    txHash: '—',
    dateIso: '2026-03-21',
    historyLabel: 'Deposit · pending',
    historySub: `Just now · ${net}`,
  },
  {
    id: 'tx-h2',
    type: 'Deposit',
    amount: '0.01 ETH',
    counterparty: MOCK_CRYPTO.spendAddress.slice(0, 10) + '…',
    time: '2026-03-21',
    txHash: '0xa1b2…',
    dateIso: '2026-03-21',
    historyLabel: 'Deposit · 1 claim',
    historySub: `21 Mar · TX 0xa1b2... · ${net}`,
  },
  {
    id: 'tx-h3',
    type: 'Redeem',
    amount: '0.01 ETH',
    counterparty: '0x71C7…9A2f',
    time: '2026-03-21',
    txHash: '0xf5e4…',
    dateIso: '2026-03-21',
    historyLabel: 'Redeem · Claim #4',
    historySub: `21 Mar · TX 0xf5e4... · ${net}`,
  },
  {
    id: 'tx-h4',
    type: 'Deposit',
    amount: '0.01 ETH',
    counterparty: MOCK_CRYPTO.spendAddress.slice(0, 10) + '…',
    time: '2026-03-20',
    txHash: '0x9c8b…',
    dateIso: '2026-03-20',
    historyLabel: 'Deposit · 1 claim',
    historySub: `20 Mar · TX 0x9c8b... · ${net}`,
  },
  {
    id: 'tx-h5',
    type: 'Redeem',
    amount: '0.01 ETH',
    counterparty: '0x71C7…9A2f',
    time: '2026-03-20',
    txHash: '0x2b1a…',
    dateIso: '2026-03-20',
    historyLabel: 'Redeem · Claim #5',
    historySub: `20 Mar · TX 0x2b1a... · ${net}`,
  },
  {
    id: 'tx-h6',
    type: 'Deposit',
    amount: '0.01 ETH',
    counterparty: MOCK_CRYPTO.spendAddress.slice(0, 10) + '…',
    time: '2026-03-19',
    txHash: '0x8e7c…',
    dateIso: '2026-03-19',
    historyLabel: 'Deposit · 1 claim',
    historySub: `19 Mar · TX 0x8e7c... · ${net}`,
  },
  {
    id: 'tx-h7',
    type: 'Redeem',
    amount: '0.01 ETH',
    counterparty: '0x71C7…9A2f',
    time: '2026-03-19',
    txHash: '0x4a3b…',
    dateIso: '2026-03-19',
    historyLabel: 'Redeem · Claim #3',
    historySub: `19 Mar · TX 0x4a3b... · ${net}`,
  },
  {
    id: 'tx-h8',
    type: 'Deposit',
    amount: '0.01 ETH',
    counterparty: MOCK_CRYPTO.spendAddress.slice(0, 10) + '…',
    time: '2026-03-17',
    txHash: '0x1d2e…',
    dateIso: '2026-03-17',
    historyLabel: 'Deposit · 1 claim',
    historySub: `17 Mar · TX 0x1d2e... · ${net}`,
  },
]
