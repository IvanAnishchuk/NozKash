import { keccak256 } from 'ethereum-cryptography/keccak.js'
import {
  deriveTokenSecrets,
  getDepositId,
  getNullifierIdHex,
} from '@nozk/nozk-library'
import { bytesToHex } from '@nozk/bls12-381-crypto'
import { TARGET_NETWORK_LABEL } from './ethereum'
import type { ActivityKind } from '../types/activity'
import { chainRpcCall } from './chainPublicRpc'
import { isNozkVaultDebugEnabled } from './nozkDebug'
import type { VaultTx } from '../types/activity'

type ChainRpcFn = typeof chainRpcCall

/** `.env` values like `60_000` must not use `parseInt` alone — it parses as `60`. */
function normalizeEnvIntString(raw: string | undefined): string {
  if (raw == null) return ''
  return String(raw).replace(/_/g, '').trim()
}

function parseEnvPositiveInt(
  raw: string | undefined,
  fallback: number
): number {
  const s = normalizeEnvIntString(raw)
  if (s === '') return fallback
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function parseEnvPositiveIntMin(
  raw: string | undefined,
  fallback: number,
  min: number
): number {
  return Math.max(min, parseEnvPositiveInt(raw, fallback))
}

function parseEnvPositiveIntClamp(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const n = parseEnvPositiveIntMin(raw, fallback, min)
  return Math.min(max, n)
}

function parseEnvNonNegativeIntClamp(
  raw: string | undefined,
  fallback: number,
  max: number
): number {
  const s = normalizeEnvIntString(raw)
  if (s === '') return fallback
  const n = Number.parseInt(s, 10)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(max, n)
}

/**
 * Accepts either:
 * - hex quantity (`0x...`) or
 * - decimal block number (`1234567`) and converts to hex quantity.
 */
function parseEnvBlockHex(
  raw: string | undefined,
  fallbackHex: `0x${string}`
): `0x${string}` {
  const s = normalizeEnvIntString(raw)
  if (!s) return fallbackHex
  if (/^0x[0-9a-fA-F]+$/.test(s)) return s.toLowerCase() as `0x${string}`
  if (/^\d+$/.test(s)) return `0x${BigInt(s).toString(16)}` as `0x${string}`
  console.warn('[NozkVault] Invalid VITE_NOZK_VAULT_SCAN_FROM_BLOCK_HEX; using fallback', {
    value: raw,
    fallbackHex,
  })
  return fallbackHex
}

const NOZK_VAULT_MAX_BATCHES_FALLBACK = 128
/** Safety clamp so a typo in env does not schedule millions of RPC rounds. */
const NOZK_VAULT_MAX_BATCHES_HARD_CAP = 10_000

function parseNozkVaultMaxBatchesFromEnv(): number {
  const n = parseEnvPositiveInt(
    import.meta.env.VITE_NOZK_VAULT_MAX_BATCHES,
    NOZK_VAULT_MAX_BATCHES_FALLBACK
  )
  return Math.min(NOZK_VAULT_MAX_BATCHES_HARD_CAP, Math.max(1, n))
}

/**
 * Max consecutive JSON-RPC calls before pausing (`fetchVaultActivityForFirstTokens`).
 * Public RPC defaults are conservative; raise with a dedicated endpoint.
 */
export const NOZK_VAULT_SCAN_RPC_BURST = parseEnvPositiveInt(
  import.meta.env.VITE_NOZK_VAULT_RPC_BURST,
  5
)
/** Pause after burst is exhausted (ms). */
export const NOZK_VAULT_SCAN_RPC_PAUSE_MS = parseEnvPositiveInt(
  import.meta.env.VITE_NOZK_VAULT_RPC_PAUSE_MS,
  7500
)

function scanCacheTtlMs(): number {
  const raw = import.meta.env.VITE_NOZK_VAULT_SCAN_CACHE_MS
  /** Default 60s so Dashboard polls (often 10s) hit cache instead of full log scans. */
  const s = normalizeEnvIntString(raw)
  if (s === '') return 60_000
  const n = Number.parseInt(s, 10)
  if (!Number.isFinite(n)) return 60_000
  return Math.max(0, n)
}

function masterSeedCacheKey(seed: Uint8Array): string {
  return bytesToHex(keccak256(seed))
}

function getVaultActivityCacheKey(
  masterSeed: Uint8Array,
  vault: string,
  fromBlock: string
): string {
  return `${vault}|${fromBlock}|${masterSeedCacheKey(masterSeed)}`
}

/**
 * Largest token index with `DepositLocked` or `MintFulfilled` implied by activity rows
 * (same notion as scanning batches for last-used).
 */
function lastUsedFromVaultActivityRows(rows: VaultTx[]): number {
  let last = -1
  for (const r of rows) {
    if (r.tokenIndex === undefined || r.tokenIndex < 0) continue
    if (r.type !== 'Deposit' && r.type !== 'Pending' && r.type !== 'Redeem' && r.type !== 'Revealed')
      continue
    if (r.tokenIndex > last) last = r.tokenIndex
  }
  return last
}

type ScanCacheEntry = {
  at: number
  rows: VaultTx[]
  lastBlock: number   // highest block number seen across all rows
  batchCount: number  // number of non-empty batches in last scan
}
const vaultActivityCache = new Map<string, ScanCacheEntry>()
let inflightActivityKey: string | null = null
let inflightActivityPromise: Promise<VaultTx[]> | null = null
/** Bumped on stale-mark; if it changed during flight, don't cache the result. */
let cacheGeneration = 0

/** Dev or `VITE_NOZK_DEBUG=true` — enables {@link nozkVaultActivityDebug}. */
export function isNozkVaultActivityDebug(): boolean {
  return isNozkVaultDebugEnabled()
}

export function nozkVaultActivityDebug(...args: unknown[]): void {
  if (!isNozkVaultActivityDebug()) return
  console.log('[NozkVault activity]', ...args)
}

/**
 * Marks all cache entries as stale so the next fetch bypasses TTL,
 * but keeps existing rows intact for incremental use.
 */
export function markVaultActivityCacheStale(): void {
  nozkVaultActivityDebug('markVaultActivityCacheStale')
  cacheGeneration++
  for (const entry of vaultActivityCache.values()) {
    entry.at = 0
  }
}

/**
 * Fully clears the cache (e.g. on account switch where the seed changes).
 */
export function clearVaultActivityCache(): void {
  nozkVaultActivityDebug('clearVaultActivityCache')
  vaultActivityCache.clear()
  clearAllPersistedVaultActivity()
}

// ---------------------------------------------------------------------------
// localStorage persistence — instant reload without full chain re-scan.
// ---------------------------------------------------------------------------

const PERSIST_DEBOUNCE_MS = 1000
let persistDebounceTimer: number | null = null

/** Schema for localStorage entries. */
type PersistedVaultActivity = {
  v: 1
  rows: VaultTx[]
  lastBlock: number
  savedAt: number
}

/**
 * localStorage key prefix. The suffix is seed-derived so distinct wallets in
 * the same browser don't share entries. The stored payload (counterparty
 * addresses, tx hashes, block numbers, token indices) is plain JSON — not
 * encrypted — and readable by anyone with localStorage access.
 */
const LS_VAULT_ACTIVITY_PREFIX = 'nozk:vault-activity:'

function vaultActivityLsKey(masterSeed: Uint8Array): string {
  const seedHash = bytesToHex(keccak256(masterSeed)).slice(0, 16)
  // Include vault address so different deployments / chains don't share cache
  const vaultSlice = NOZK_VAULT_ADDRESS.toLowerCase().replace(/^0x/, '').slice(0, 8)
  return `${LS_VAULT_ACTIVITY_PREFIX}${vaultSlice}:${seedHash}`
}

/** Tracks the current seed key so `debouncedPersistAllCaches` knows which LS key to write. */
let currentSeedKey: string | null = null
/** Cached suffix of the in-memory cache key for the current seed (avoids repeated keccak256). */
let currentSeedCacheKeySuffix: string | null = null

/** Called during fetch to register which seed we're operating with. */
export function setVaultActivitySeedContext(masterSeed: Uint8Array): void {
  currentSeedKey = vaultActivityLsKey(masterSeed)
  currentSeedCacheKeySuffix = masterSeedCacheKey(masterSeed)
}

function persistVaultActivity(seedKey: string, rows: VaultTx[], lastBlock: number): void {
  try {
    const data: PersistedVaultActivity = { v: 1, rows, lastBlock, savedAt: Date.now() }
    localStorage.setItem(seedKey, JSON.stringify(data))
    nozkVaultActivityDebug('persisted to localStorage', { seedKey, rowCount: rows.length, lastBlock })
  } catch {
    // localStorage full or unavailable — non-critical
  }
}

export function loadPersistedVaultActivity(masterSeed: Uint8Array): PersistedVaultActivity | null {
  try {
    const key = vaultActivityLsKey(masterSeed)
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const data = JSON.parse(raw) as PersistedVaultActivity
    if (data?.v !== 1 || !Array.isArray(data.rows)) return null
    // Validate lastBlock to prevent NaN propagation into eth_getLogs
    if (typeof data.lastBlock !== 'number' || !Number.isFinite(data.lastBlock)) return null
    // Basic row-shape sanity check
    const looksValid = data.rows.every(
      (r) =>
        r &&
        typeof r.id === 'string' &&
        typeof r.type === 'string' &&
        (r.tokenIndex === undefined || typeof r.tokenIndex === 'number')
    )
    if (!looksValid) return null
    nozkVaultActivityDebug('loaded from localStorage', { key, rowCount: data.rows.length, lastBlock: data.lastBlock })
    return data
  } catch {
    return null
  }
}

function clearAllPersistedVaultActivity(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(LS_VAULT_ACTIVITY_PREFIX)) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch {
    // non-critical
  }
}

/** Debounced write of current in-memory cache to localStorage. */
function debouncedPersistAllCaches(): void {
  if (!currentSeedKey) return
  if (persistDebounceTimer != null) window.clearTimeout(persistDebounceTimer)
  persistDebounceTimer = window.setTimeout(() => {
    persistDebounceTimer = null
    if (!currentSeedKey || !currentSeedCacheKeySuffix) return
    // Find the cache entry for the current seed
    for (const [key, entry] of vaultActivityCache.entries()) {
      if (key.endsWith(currentSeedCacheKeySuffix)) {
        persistVaultActivity(currentSeedKey, entry.rows, entry.lastBlock)
        break
      }
    }
  }, PERSIST_DEBOUNCE_MS)
}

/** Dispatched after deposit/redeem so UIs refetch activity without waiting for the poll interval. */
export const NOZK_VAULT_ACTIVITY_REFRESH_EVENT = 'nozk:vault-activity-refresh'
/** Dispatched right after a confirmed deposit to show an optimistic pending row immediately. */
export const NOZK_VAULT_OPTIMISTIC_PENDING_EVENT = 'nozk:vault-optimistic-pending'

export type NozkVaultOptimisticPendingDetail = {
  tokenIndex: number
  txHash: string
  networkLabel: string
}

/**
 * No-op kept for API compatibility with useNozkVaultActivityLive.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function setNozkVaultLiveActive(_active: boolean): void {
  // no-op
}

let vaultActivityRefreshDebounce: number | null = null

/**
 * Notifies listeners (e.g. Dashboard) to refetch soon (debounced to avoid
 * duplicate scans). Marks the cache as stale so the next fetch bypasses TTL
 * but keeps existing rows for incremental scanning.
 */
export function requestVaultActivityRefresh(): void {
  markVaultActivityCacheStale()
  if (vaultActivityRefreshDebounce != null) {
    window.clearTimeout(vaultActivityRefreshDebounce)
  }
  vaultActivityRefreshDebounce = window.setTimeout(() => {
    vaultActivityRefreshDebounce = null
    window.dispatchEvent(new Event(NOZK_VAULT_ACTIVITY_REFRESH_EVENT))
  }, 350)
}

export function publishOptimisticPendingDeposit(
  detail: NozkVaultOptimisticPendingDetail
): void {
  window.dispatchEvent(
    new CustomEvent<NozkVaultOptimisticPendingDetail>(
      NOZK_VAULT_OPTIMISTIC_PENDING_EVENT,
      { detail }
    )
  )
}

// ---------------------------------------------------------------------------
// Local state mutations — update UI instantly after user-initiated actions
// (reveal, redeem, refund) without triggering a full chain re-scan.
// ---------------------------------------------------------------------------

/** Dispatched after a confirmed user action to update a single row in the UI. */
export const NOZK_VAULT_ROW_UPDATE_EVENT = 'nozk:vault-row-update'

export type NozkVaultRowUpdateDetail = {
  tokenIndex: number
  newType: ActivityKind
  txHash: string
  blockNumber?: number
}

/**
 * Build an updated `VaultTx` from an existing row after a known state
 * transition (reveal, redeem, refund). Keeps amount, counterparty,
 * tokenIndex, and dateIso from the original.
 */
export function buildLocalMutatedRow(
  existingRow: VaultTx,
  newType: ActivityKind,
  txHash: string,
  blockNumber?: number
): VaultTx {
  const idx = existingRow.tokenIndex ?? -1
  const bn = blockNumber ?? existingRow.blockNumber
  const netLabel = existingRow.networkLabel ?? TARGET_NETWORK_LABEL

  let idPrefix: string
  let label: string
  let sub: string
  switch (newType) {
    case 'Revealed':
      idPrefix = 'vault-revealed'
      label = `Revealed · ready to redeem · token #${idx}`
      sub = `NullifierRevealed · block ${bn || '?'} · ${netLabel}`
      break
    case 'Redeem':
      idPrefix = 'vault-redeemed'
      label = `Redeem · spent · token #${idx}`
      sub = `nullifier spent · block ${bn || '?'} · ${netLabel}`
      break
    case 'Refunded':
      idPrefix = 'vault-refunded'
      label = `Deposit · refunded · token #${idx}`
      sub = `Refunded · ${txShort(txHash)} · block ${bn || '?'} · ${netLabel}`
      break
    case 'Deposit':
      idPrefix = 'vault-deposit'
      label = `Deposit · mint fulfilled · token #${idx}`
      sub = `MintFulfilled · ${txShort(txHash)} · block ${bn || '?'} · ${netLabel}`
      break
    default:
      idPrefix = 'vault-pending'
      label = `Deposit · pending · token #${idx}`
      sub = `DepositLocked · ${txShort(txHash)} · block ${bn || '?'} · ${netLabel}`
      break
  }

  return {
    ...existingRow,
    id: `${idPrefix}-${idx}`,
    type: newType,
    txHash,
    blockNumber: bn,
    historyLabel: label,
    historySub: sub,
    networkLabel: netLabel,
  }
}

/**
 * Write-through mutation: update the row for `tokenIndex` in the
 * in-memory cache entry for the current seed. Does NOT mark cache stale.
 */
export function mutateVaultActivityCacheRow(
  tokenIndex: number,
  newType: ActivityKind,
  txHash: string,
  blockNumber?: number
): void {
  for (const [key, entry] of vaultActivityCache.entries()) {
    // Only mutate the cache entry belonging to the current seed
    if (currentSeedCacheKeySuffix && !key.endsWith(currentSeedCacheKeySuffix)) continue
    const idx = entry.rows.findIndex((r) => r.tokenIndex === tokenIndex)
    if (idx === -1) continue
    entry.rows[idx] = buildLocalMutatedRow(entry.rows[idx]!, newType, txHash, blockNumber)
  }
  debouncedPersistAllCaches()
}

/**
 * Atomically update the in-memory cache row AND dispatch the React state
 * update event. Use this instead of calling mutateVaultActivityCacheRow +
 * publishVaultRowUpdate separately.
 */
export function applyVaultRowUpdate(detail: NozkVaultRowUpdateDetail): void {
  mutateVaultActivityCacheRow(detail.tokenIndex, detail.newType, detail.txHash, detail.blockNumber)
  publishVaultRowUpdate(detail)
}

/** Dispatch a row-update event for the hook to apply to React state. */
export function publishVaultRowUpdate(detail: NozkVaultRowUpdateDetail): void {
  window.dispatchEvent(
    new CustomEvent<NozkVaultRowUpdateDetail>(
      NOZK_VAULT_ROW_UPDATE_EVENT,
      { detail }
    )
  )
}

/**
 * Serial queue: at most `burst` calls to `chainRpcCall`, then wait `pauseMs`.
 * Avoids bursts that hit provider rate limits.
 */
function createVaultScanRpcLimiter(burst: number, pauseMs: number): ChainRpcFn {
  let used = 0
  let queue: Promise<unknown> = Promise.resolve()

  return function limited<T>(method: string, params: unknown[] = []): Promise<T> {
    const run = async (): Promise<T> => {
      if (used >= burst) {
        await new Promise((r) => setTimeout(r, pauseMs))
        used = 0
      }
      used += 1
      return chainRpcCall<T>(method, params)
    }
    const next = queue.then(run) as Promise<T>
    queue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }
}

/** Deployed NozkVault — override with `VITE_NOZK_VAULT_ADDRESS`. */
export const NOZK_VAULT_ADDRESS =
  (import.meta.env.VITE_NOZK_VAULT_ADDRESS as string | undefined) ??
  '0x0000000000000000000000000000000000000000'

/**
 * Default vault deployment block (`NOZK_VAULT_ADDRESS`): no point querying
 * `eth_getLogs` earlier — extra RPC only. Override with
 * `VITE_NOZK_VAULT_SCAN_FROM_BLOCK_HEX` after redeploying.
 */
export const NOZK_VAULT_SCAN_FROM_BLOCK_HEX =
  parseEnvBlockHex(
    import.meta.env.VITE_NOZK_VAULT_SCAN_FROM_BLOCK_HEX as string | undefined,
    '0x329896c'
  )

/**
 * Scan / allocate in windows of this many token indices (0–4, 5–9, …).
 * Aligned with a privacy-pool-style counter: the **next** deposit uses
 * `max(lastUsedTokenIndex + 1, NOZK_VAULT_MIN_NEW_DEPOSIT_TOKEN_INDEX)`, not the
 * lowest unused index (gaps are not backfilled).
 */
export const NOZK_VAULT_TOKEN_BATCH_SIZE = parseEnvPositiveIntClamp(
  import.meta.env.VITE_NOZK_VAULT_TOKEN_BATCH_SIZE,
  5,
  1,
  50
)

/**
 * Lowest token index the UI will allocate for a **new** deposit (`lastUsed + 1`, but
 * never below this). Use 2 to leave indices 0–1 unused by the auto counter.
 * Override: `VITE_NOZK_VAULT_MIN_NEW_DEPOSIT_TOKEN_INDEX`.
 */
export const NOZK_VAULT_MIN_NEW_DEPOSIT_TOKEN_INDEX = parseEnvNonNegativeIntClamp(
  import.meta.env.VITE_NOZK_VAULT_MIN_NEW_DEPOSIT_TOKEN_INDEX,
  2,
  1_000_000
)

/**
 * Upper bound on batches for activity scan and {@link findLastUsedVaultTokenIndex} /
 * {@link getNextVaultTokenIndexForDeposit} (each batch = {@link NOZK_VAULT_TOKEN_BATCH_SIZE} indices).
 * Default 128 → token indices 0…639 max when every batch is non-empty.
 * Override: `VITE_NOZK_VAULT_MAX_BATCHES` (clamped 1…10000).
 */
export const NOZK_VAULT_ACTIVITY_MAX_BATCHES = parseNozkVaultMaxBatchesFromEnv()

/**
 * Default batch cap for {@link findLastUsedVaultTokenIndex} / {@link getNextVaultTokenIndexForDeposit}.
 * Must cover every batch that can hold on-chain activity, or `lastUsed` stops at index 4 (batch 0 only)
 * and the next deposit can reuse an existing `depositId` → `DepositIdAlreadyUsed` on-chain.
 */
export const NOZK_VAULT_DEFAULT_MAX_BATCHES = NOZK_VAULT_ACTIVITY_MAX_BATCHES

/**
 * Interval between vault refreshes over HTTP RPC (Dashboard, Redeem, modal gas).
 * Override with `VITE_NOZK_VAULT_RPC_POLL_MS` (min 2000 ms).
 */
export const NOZK_VAULT_RPC_POLL_MS = parseEnvPositiveIntMin(
  import.meta.env.VITE_NOZK_VAULT_RPC_POLL_MS,
  10_000,
  2000
)

/** Highest token index we are willing to allocate without raising `maxBatches`. */
export function nozkVaultMaxScannedTokenIndex(
  maxBatches: number = NOZK_VAULT_DEFAULT_MAX_BATCHES
): number {
  return maxBatches * NOZK_VAULT_TOKEN_BATCH_SIZE - 1
}

/**
 * @deprecated Prefer `NOZK_VAULT_TOKEN_BATCH_SIZE` + batched scan; kept for older imports.
 */
export const NOZK_VAULT_TRACKED_TOKEN_INDICES = [0, 1, 2, 3, 4] as const

export const NOZK_VAULT_DEPOSIT_AMOUNT_LABEL = '0.001 ETH' as const

/** `msg.value` for `NozkVault.deposit` — 0.001 native token (1e15 wei). */
export const NOZK_VAULT_DEPOSIT_VALUE_WEI_HEX = '0x38d7ea4c68000' as const

/**
 * V2 event topic0 hashes (recomputed for V2 signatures with uint256[8] and bytes32).
 */

/** `DepositLocked(address indexed depositId, uint256[8] B)` */
export const DEPOSIT_LOCKED_TOPIC =
  '0xe178a1ad0a6551e527bf743737bb290b02b63b06d23210978cb7d3ec4f671730'

/** `MintFulfilled(address indexed depositId, uint256[8] S_prime)` */
export const MINT_FULFILLED_TOPIC =
  '0xa6bf61f6f77b0e662f085afc8515b4d61a6afb45870cbd0f42088b54c789d05d'

/** `Refunded(address indexed depositId, address indexed to)` — unchanged */
export const REFUNDED_TOPIC =
  '0x51ebc7481979ebbd2e5cf0be7bb298c0a8dfe2c94e2b37ec845b412b2b93df52'

/** `NullifierRevealed(bytes32 indexed nullifierId, uint256 amount)` */
export const NULLIFIER_REVEALED_TOPIC =
  '0x475b6724a8fa68fea88b1ebf93141fdff143978465f5cf9535b98c4cdc0c0bf6'

/**
 * V2 function selectors.
 */

/** `nullifierState(bytes32)` — returns uint8: 0=UNREVEALED, 1=REVEALED, 2=SPENT. */
const NULLIFIER_STATE_SELECTOR = '0x1fa862b9'
/** `depositPending(address)` — unchanged. */
const DEPOSIT_PENDING_SELECTOR = '0xd7d82302'
/** `depositFulfilled(address)` — unchanged. */
const DEPOSIT_FULFILLED_SELECTOR = '0x7cf15601'

function normalizeAddress(a: string): string {
  const h = a.replace(/^0x/i, '').toLowerCase()
  if (h.length !== 40) throw new Error(`Invalid address: ${a}`)
  return `0x${h}`
}

/** Normalize a 32-byte hex string (nullifier ID). */
function normalizeBytes32(h: string): string {
  const clean = h.replace(/^0x/i, '').toLowerCase()
  if (clean.length !== 64) throw new Error(`Invalid bytes32: ${h}`)
  return `0x${clean}`
}

/** `depositId` as log topic: 32-byte left-padded (indexed address). */
export function depositIdToTopic(depositId: string): string {
  const addr = normalizeAddress(depositId).slice(2)
  return `0x${'0'.repeat(24)}${addr}`
}

/** `nullifierIdHex` as log topic: already 32 bytes, just normalize. */
export function nullifierIdToTopic(nullifierIdHex: string): string {
  return normalizeBytes32(nullifierIdHex)
}

/**
 * Derivation the scanner uses to align with `DepositLocked` / `MintFulfilled`:
 * same on-chain `depositId` (topic1) ⇔ `getDepositId(deriveTokenSecrets(seed, tokenIndex))`.
 * Useful to debug “event exists but row missing in the app”.
 */
export function vaultDerivedAddressesForIndices(
  masterSeed: Uint8Array,
  tokenIndices: number[]
): { tokenIndex: number; depositId: string; nullifierIdHex: string }[] {
  return tokenIndices.map((tokenIndex) => {
    const secrets = deriveTokenSecrets(masterSeed, tokenIndex)
    return {
      tokenIndex,
      depositId: normalizeAddress(getDepositId(secrets)),
      nullifierIdHex: getNullifierIdHex(secrets),
    }
  })
}

function topic1ToDepositId(topic1: string): string {
  const h = topic1.replace(/^0x/i, '')
  return normalizeAddress(`0x${h.slice(-40)}`)
}

/** Parse topic1 as a raw bytes32 (for NullifierRevealed). */
function topic1ToBytes32(topic1: string): string {
  return normalizeBytes32(topic1)
}

function encodeAddress32(depositId: string): string {
  return normalizeAddress(depositId).slice(2).padStart(64, '0')
}

type RpcLog = {
  blockNumber?: string
  transactionHash?: string
  topics?: string[]
  /** ABI event body (e.g. `uint256[2]` in `MintFulfilled`). */
  data?: string
}

function parseHexBlock(n: string | undefined): number {
  if (!n || n === '0x') return 0
  return Number.parseInt(n, 16)
}

/** `eth_getLogs` filter partial (caller supplies `fromBlock` / `toBlock`). */
type EthGetLogsPartialFilter = {
  address: string
  topics: (string | string[])[]
}

function parseMaxBlockSpanFromRpcError(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err)
  const maxIs = msg.match(/maximum is set to (\d+)/i)
  if (maxIs) return Math.max(1, parseInt(maxIs[1], 10))
  const alchemy = msg.match(/up to a (\d+) block range/i)
  if (alchemy) return Math.max(1, parseInt(alchemy[1], 10))
  return null
}

function looksLikeBlockRangeRpcError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /too many blocks|block range|maximum is set/i.test(msg)
}

/** Avalanche: `eth_blockNumber` may be ahead of the last block accepted for `eth_getLogs`. */
function parseLastAcceptedBlockFromRpcError(err: unknown): bigint | null {
  const msg = err instanceof Error ? err.message : String(err)
  const m = msg.match(/last accepted block (\d+)/i)
  if (!m) return null
  return BigInt(m[1])
}

async function ethGetLogsOnce(
  rpc: ChainRpcFn,
  filter: EthGetLogsPartialFilter & { fromBlock: string; toBlock: string }
): Promise<RpcLog[]> {
  const logs = await rpc<RpcLog[] | null>('eth_getLogs', [filter])
  return Array.isArray(logs) ? logs : []
}

/**
 * Walks [fromBlock … toBlock] in windows of at most `maxSpan` blocks (inclusive).
 * Needed on public RPC (~2048) and free tiers of other providers (~10).
 */
async function ethGetLogsChunked(
  rpc: ChainRpcFn,
  partial: EthGetLogsPartialFilter,
  fromBlock: string,
  toBlock: 'latest' | string,
  maxSpan: number
): Promise<RpcLog[]> {
  const toHexResolved =
    toBlock === 'latest'
      ? await rpc<string>('eth_blockNumber', [])
      : toBlock
  const fromBn = BigInt(fromBlock)
  let toBn = BigInt(toHexResolved)
  if (toBn < fromBn) return []

  const out: RpcLog[] = []
  let cur = fromBn
  const span = BigInt(maxSpan)
  while (cur <= toBn) {
    const end = cur + span - 1n <= toBn ? cur + span - 1n : toBn
    try {
      const chunk = await ethGetLogsOnce(rpc, {
        ...partial,
        fromBlock: `0x${cur.toString(16)}`,
        toBlock: `0x${end.toString(16)}`,
      })
      out.push(...chunk)
      cur = end + 1n
    } catch (e) {
      const accepted = parseLastAcceptedBlockFromRpcError(e)
      if (accepted != null) {
        if (accepted < toBn) toBn = accepted
        if (cur > toBn) return out
        continue
      }
      throw e
    }
  }
  return out
}

async function ethGetLogsAutoChunk(
  rpc: ChainRpcFn,
  partial: EthGetLogsPartialFilter,
  fromBlock: string,
  toBlock: 'latest' | string
): Promise<RpcLog[]> {
  try {
    return await ethGetLogsOnce(rpc, {
      ...partial,
      fromBlock,
      toBlock: toBlock === 'latest' ? 'latest' : toBlock,
    })
  } catch (e) {
    const lastAcc = parseLastAcceptedBlockFromRpcError(e)
    if (lastAcc != null) {
      const fromBn = BigInt(fromBlock)
      if (fromBn > lastAcc) return []
      const cappedHex = `0x${lastAcc.toString(16)}`
      try {
        return await ethGetLogsOnce(rpc, {
          ...partial,
          fromBlock,
          toBlock: cappedHex,
        })
      } catch (e2) {
        const parsed = parseMaxBlockSpanFromRpcError(e2)
        const span = parsed ?? (looksLikeBlockRangeRpcError(e2) ? 2048 : null)
        if (span == null) throw e2
        return ethGetLogsChunked(rpc, partial, fromBlock, cappedHex, span)
      }
    }
    const parsed = parseMaxBlockSpanFromRpcError(e)
    const span = parsed ?? (looksLikeBlockRangeRpcError(e) ? 2048 : null)
    if (span == null) throw e
    return ethGetLogsChunked(rpc, partial, fromBlock, toBlock, span)
  }
}

function txShort(hash: string): string {
  if (hash.length > 12) return `${hash.slice(0, 10)}…${hash.slice(-6)}`
  return hash
}

function addrShort(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`
}

function batchTokenIndices(batchIndex: number): number[] {
  const base = batchIndex * NOZK_VAULT_TOKEN_BATCH_SIZE
  return Array.from({ length: NOZK_VAULT_TOKEN_BATCH_SIZE }, (_, j) => base + j)
}

async function blockHexToDateIso(
  blockNumberHex: string | undefined,
  rpc: ChainRpcFn = chainRpcCall
): Promise<string> {
  if (!blockNumberHex) return new Date().toISOString().slice(0, 10)
  try {
    const block = await rpc<{ timestamp?: string } | null>(
      'eth_getBlockByNumber',
      [blockNumberHex, false]
    )
    const ts = block?.timestamp
      ? Number.parseInt(block.timestamp, 16)
      : Math.floor(Date.now() / 1000)
    return new Date(ts * 1000).toISOString().slice(0, 10)
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

/**
 * `eth_getLogs` for several `depositId`s: tries an OR filter on `topics[1]`.
 * Some RPCs (e.g. public) return `[]` without error if OR is flaky;
 * then we fall back to **one query per `depositId`** (same serial `rpc` queue).
 */
async function fetchLogsForDepositIds(
  vault: string,
  topic0: string,
  depositIds: string[],
  fromBlock: string,
  rpc: ChainRpcFn = chainRpcCall,
  /** Override topic1 formatting. Default: left-pad address to 32 bytes. */
  topic1Formatter: (id: string) => string = depositIdToTopic
): Promise<RpcLog[]> {
  const topic1List = depositIds.map(topic1Formatter)
  const partialOr: EthGetLogsPartialFilter = {
    address: vault,
    topics: [topic0, topic1List],
  }

  async function fetchPerTopic1(): Promise<RpcLog[]> {
    /** Sequential to avoid N parallel `eth_getLogs` against the same RPC. */
    const out: RpcLog[] = []
    for (const t1 of topic1List) {
      const chunk = await ethGetLogsAutoChunk(
        rpc,
        { address: vault, topics: [topic0, t1] },
        fromBlock,
        'latest'
      )
      out.push(...chunk)
    }
    return out
  }

  try {
    const logs = await ethGetLogsAutoChunk(rpc, partialOr, fromBlock, 'latest')
    return Array.isArray(logs) ? logs : []
  } catch {
    // OR filter not supported by this RPC — fall back to one query per depositId
    return fetchPerTopic1()
  }
}

function latestLogByDepositId(
  logs: RpcLog[],
  /** Parse topic1 into a map key. Default: extract address from padded topic. */
  parseTopic1: (t1: string) => string = topic1ToDepositId
): Map<string, RpcLog> {
  const m = new Map<string, RpcLog>()
  for (const log of logs) {
    const t1 = log.topics?.[1]
    if (!t1) continue
    const id = parseTopic1(t1)
    const prev = m.get(id)
    if (
      !prev ||
      parseHexBlock(log.blockNumber) >= parseHexBlock(prev.blockNumber)
    ) {
      m.set(id, log)
    }
  }
  return m
}

/**
 * Reads `MintFulfilled` for a `depositId` and returns S′ (G2) as integers from the event.
 */
/**
 * V2: MintFulfilled event data contains 8 uint256 words (G2 point S').
 */
export async function fetchMintFulfilledSPrime(
  depositId: string,
  options?: Pick<NozkVaultFetchOptions, 'contractAddress' | 'fromBlock'>
): Promise<{ coords: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] } | null> {
  const vault = normalizeAddress(
    options?.contractAddress ?? NOZK_VAULT_ADDRESS
  )
  const fromBlock = options?.fromBlock ?? NOZK_VAULT_SCAN_FROM_BLOCK_HEX
  const id = normalizeAddress(depositId)
  const logs = await fetchLogsForDepositIds(
    vault,
    MINT_FULFILLED_TOPIC,
    [id],
    fromBlock,
    chainRpcCall
  )
  const log = latestLogByDepositId(logs).get(id)
  const data = log?.data?.replace(/^0x/i, '') ?? ''
  // V2: 8 words = 512 hex chars
  if (data.length < 512) return null
  const coords = Array.from({ length: 8 }, (_, i) =>
    BigInt('0x' + data.slice(i * 64, (i + 1) * 64))
  ) as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
  return { coords }
}

/**
 * Fast status probe for one token index (used by optimistic pending UX).
 * Avoids full activity scans by querying only this token's derived `depositId`.
 */
export async function fetchVaultRowForTokenIndex(
  masterSeed: Uint8Array,
  tokenIndex: number,
  options?: Pick<NozkVaultFetchOptions, 'contractAddress' | 'fromBlock' | 'networkLabel'>
): Promise<VaultTx | null> {
  const vault = normalizeAddress(
    options?.contractAddress ?? NOZK_VAULT_ADDRESS
  )
  const fromBlock = options?.fromBlock ?? NOZK_VAULT_SCAN_FROM_BLOCK_HEX
  const netLabel = options?.networkLabel ?? TARGET_NETWORK_LABEL
  const secrets = deriveTokenSecrets(masterSeed, tokenIndex)
  const depositId = normalizeAddress(getDepositId(secrets))
  const nullifierIdHex = getNullifierIdHex(secrets)
  const blindShort = addrShort(depositId)
  const spendShort = addrShort(nullifierIdHex)

  const [lockedRaw, fulfilledRaw, refundedRaw] = await Promise.all([
    fetchLogsForDepositIds(vault, DEPOSIT_LOCKED_TOPIC, [depositId], fromBlock, chainRpcCall),
    fetchLogsForDepositIds(vault, MINT_FULFILLED_TOPIC, [depositId], fromBlock, chainRpcCall),
    fetchLogsForDepositIds(vault, REFUNDED_TOPIC, [depositId], fromBlock, chainRpcCall),
  ])

  const lockLog = latestLogByDepositId(lockedRaw).get(depositId)
  const mintLog = latestLogByDepositId(fulfilledRaw).get(depositId)
  const refundLog = latestLogByDepositId(refundedRaw).get(depositId)

  if (!lockLog && !mintLog && !refundLog) return null

  if (mintLog) {
    const nState = await fetchNullifierState(vault, nullifierIdHex, chainRpcCall)
    const bn = parseHexBlock(mintLog.blockNumber)
    const txh = mintLog.transactionHash ?? '—'
    const dateIso = await blockHexToDateIso(mintLog.blockNumber, chainRpcCall)
    if (nState === NULLIFIER_SPENT) {
      return {
        id: `vault-redeemed-${tokenIndex}`,
        type: 'Redeem',
        amount: NOZK_VAULT_DEPOSIT_AMOUNT_LABEL,
        counterparty: spendShort,
        txHash: txh,
        dateIso,
        time: dateIso,
        historyLabel: `Redeem · spent · token #${tokenIndex}`,
        historySub: `nullifier spent · block ${bn || '?'} · ${netLabel}`,
        blockNumber: bn,
        tokenIndex,
        networkLabel: netLabel,
      }
    }
    if (nState === NULLIFIER_REVEALED) {
      // Fetch the actual NullifierRevealed log for accurate tx metadata
      const revealLogs = await fetchLogsForDepositIds(
        vault, NULLIFIER_REVEALED_TOPIC, [nullifierIdHex], fromBlock, chainRpcCall,
        nullifierIdToTopic
      )
      const revealLog = latestLogByDepositId(revealLogs, topic1ToBytes32).get(normalizeBytes32(nullifierIdHex))
      const rBn = revealLog ? parseHexBlock(revealLog.blockNumber) : bn
      const rTxh = revealLog?.transactionHash ?? txh
      const rDateIso = revealLog ? await blockHexToDateIso(revealLog.blockNumber, chainRpcCall) : dateIso
      return {
        id: `vault-revealed-${tokenIndex}`,
        type: 'Revealed',
        amount: NOZK_VAULT_DEPOSIT_AMOUNT_LABEL,
        counterparty: spendShort,
        txHash: rTxh,
        dateIso: rDateIso,
        time: rDateIso,
        historyLabel: `Revealed · ready to redeem · token #${tokenIndex}`,
        historySub: revealLog
          ? `NullifierRevealed · block ${rBn || '?'} · ${netLabel}`
          : `Revealed (via state) · block ${bn || '?'} · ${netLabel}`,
        blockNumber: rBn,
        tokenIndex,
        networkLabel: netLabel,
      }
    }
    return {
      id: `vault-deposit-${tokenIndex}`,
      type: 'Deposit',
      amount: NOZK_VAULT_DEPOSIT_AMOUNT_LABEL,
      counterparty: spendShort,
      txHash: txh,
      dateIso,
      time: dateIso,
      historyLabel: `Deposit · mint fulfilled · token #${tokenIndex}`,
      historySub: `MintFulfilled · ${txShort(txh)} · block ${bn || '?'} · ${netLabel}`,
      blockNumber: bn,
      tokenIndex,
      networkLabel: netLabel,
    }
  }

  if (lockLog && refundLog) {
    const lBn = parseHexBlock(lockLog.blockNumber)
    const rBn = parseHexBlock(refundLog.blockNumber)
    if (rBn > lBn) {
      const txh = refundLog.transactionHash ?? '—'
      const dateIso = await blockHexToDateIso(refundLog.blockNumber, chainRpcCall)
      return {
        id: `vault-refunded-${tokenIndex}`,
        type: 'Refunded',
        amount: NOZK_VAULT_DEPOSIT_AMOUNT_LABEL,
        counterparty: blindShort,
        txHash: txh,
        dateIso,
        time: dateIso,
        historyLabel: `Deposit · refunded · token #${tokenIndex}`,
        historySub: `Refunded · ${txShort(txh)} · block ${rBn || '?'} · ${netLabel}`,
        blockNumber: rBn,
        tokenIndex,
        networkLabel: netLabel,
      }
    }
  } else if (refundLog) {
    const rBn = parseHexBlock(refundLog.blockNumber)
    const txh = refundLog.transactionHash ?? '—'
    const dateIso = await blockHexToDateIso(refundLog.blockNumber, chainRpcCall)
    return {
      id: `vault-refunded-${tokenIndex}`,
      type: 'Refunded',
      amount: NOZK_VAULT_DEPOSIT_AMOUNT_LABEL,
      counterparty: blindShort,
      txHash: txh,
      dateIso,
      time: dateIso,
      historyLabel: `Deposit · refunded · token #${tokenIndex}`,
      historySub: `Refunded · ${txShort(txh)} · block ${rBn || '?'} · ${netLabel}`,
      blockNumber: rBn,
      tokenIndex,
      networkLabel: netLabel,
    }
  }

  if (!lockLog) return null
  const lBn = parseHexBlock(lockLog.blockNumber)
  const txh = lockLog.transactionHash ?? '—'
  const dateIso = await blockHexToDateIso(lockLog.blockNumber, chainRpcCall)
  return {
    id: `vault-pending-${tokenIndex}`,
    type: 'Pending',
    amount: NOZK_VAULT_DEPOSIT_AMOUNT_LABEL,
    counterparty: blindShort,
    txHash: txh,
    dateIso,
    time: dateIso,
    historyLabel: `Deposit · pending · token #${tokenIndex}`,
    historySub: `DepositLocked · ${txShort(txh)} · block ${lBn || '?'} · ${netLabel}`,
    blockNumber: lBn,
    tokenIndex,
    networkLabel: netLabel,
  }
}

/** Nullifier state enum matching `NozkVault.NullifierState`. */
export const NULLIFIER_UNREVEALED = 0
export const NULLIFIER_REVEALED = 1
export const NULLIFIER_SPENT = 2

/**
 * V2: Query `nullifierState(bytes32)` → 0=UNREVEALED, 1=REVEALED, 2=SPENT.
 * Takes a 32-byte nullifier ID hex (keccak of ABI-encoded G1 spend pub).
 */
async function fetchNullifierState(
  vault: string,
  nullifierIdHex: string,
  rpc: ChainRpcFn = chainRpcCall
): Promise<number> {
  // bytes32: already 32 bytes, pad to 64 hex chars if needed
  const nid = nullifierIdHex.replace(/^0x/i, '').toLowerCase().padStart(64, '0')
  const data = (NULLIFIER_STATE_SELECTOR + nid).toLowerCase()
  try {
    const result = await rpc<string>('eth_call', [
      { to: vault, data },
      'latest',
    ])
    if (result && result !== '0x') {
      return Number(BigInt(result))
    }
  } catch {
    /* contract may not be deployed yet */
  }
  return NULLIFIER_UNREVEALED
}

/** True if any derived `depositId` in this batch has vault-relevant logs on-chain. */
function batchHasAnyVaultActivity(
  depositIds: string[],
  lockedById: Map<string, RpcLog>,
  fulfilledById: Map<string, RpcLog>,
  refundedById: Map<string, RpcLog>
): boolean {
  return depositIds.some((id) => {
    const n = normalizeAddress(id)
    return (
      lockedById.has(n) ||
      fulfilledById.has(n) ||
      refundedById.has(n)
    )
  })
}

export type NozkVaultFetchOptions = {
  contractAddress?: string
  /** Hex; defaults to {@link NOZK_VAULT_SCAN_FROM_BLOCK_HEX}. */
  fromBlock?: string
  networkLabel?: string
  /**
   * `findLastUsedVaultTokenIndex` / `getNextVaultTokenIndexForDeposit`: default {@link NOZK_VAULT_DEFAULT_MAX_BATCHES}.
   * `fetchVaultActivityForFirstTokens`: optional cap (clamped to {@link NOZK_VAULT_ACTIVITY_MAX_BATCHES}).
   */
  maxBatches?: number
  /** If true, skips activity cache (still dedupes identical in-flight requests). */
  skipCache?: boolean
  /**
   * Called after each scanned batch with merged sorted rows so far (faster first paint).
   * Also invoked once on cache hit with the full cached list.
   */
  onProgress?: (rows: VaultTx[]) => void
  /**
   * Called after each scanned batch (including empty ones) with the current
   * batch index and merged rows so far. Useful to show "progressive loading"
   * without waiting for the final scan result.
   */
  onBatchProgress?: (batchIndex: number, rows: VaultTx[], tokenIndices: number[]) => void
}

/**
 * Scans token indices in windows of {@link NOZK_VAULT_TOKEN_BATCH_SIZE}:
 * derives `depositId` with `deriveTokenSecrets(masterSeed, i)` (same `masterSeed` as the app:
 * `personal_sign` or `VITE_NOZK_MASTER_SEED_HEX`; **not** the raw EVM private key except in dev).
 * Joins **`DepositLocked`** (deposit), **`MintFulfilled`** (mint delivered; there is no `MintLocked` on the contract),
 * and `spentNullifiers(nullifier)` where `nullifier = spend.address`.
 *
 * - **Pending:** `DepositLocked` for that `depositId` but no `MintFulfilled` yet.
 * - **Deposited (mint fulfilled):** `DepositLocked` + `MintFulfilled`, and `spentNullifiers` false.
 * - **Redeemed:** `spentNullifiers(spend.address)` true (only queried if `MintFulfilled` exists, to save RPC).
 *
 * Scans batches of 5 indices until the **first** batch that has **no**
 * `DepositLocked` / `MintFulfilled` / `Refunded`.
 * This assumes token indices progress contiguously for a wallet (no intentional gaps).
 *
 * **RPC:** burst/pause queue; cache TTL + dedupe of identical concurrent requests.
 *
 * **`onProgress`:** after each batch with at least one row, receives merged sorted rows so far (faster UI).
 */
export async function fetchVaultActivityForFirstTokens(
  masterSeed: Uint8Array,
  options?: NozkVaultFetchOptions
): Promise<VaultTx[]> {
  const vault = normalizeAddress(
    options?.contractAddress ?? NOZK_VAULT_ADDRESS
  )
  const fromBlock = options?.fromBlock ?? NOZK_VAULT_SCAN_FROM_BLOCK_HEX
  const cacheKey = getVaultActivityCacheKey(masterSeed, vault, fromBlock)
  const ttl = scanCacheTtlMs()
  const now = Date.now()

  // Register seed context for localStorage persistence
  setVaultActivitySeedContext(masterSeed)

  // Seed in-memory cache from localStorage if cold (no in-memory entry at all)
  if (!vaultActivityCache.has(cacheKey)) {
    const persisted = loadPersistedVaultActivity(masterSeed)
    if (persisted && persisted.rows.length > 0) {
      nozkVaultActivityDebug('seeding cache from localStorage', {
        rowCount: persisted.rows.length,
        lastBlock: persisted.lastBlock,
      })
      vaultActivityCache.set(cacheKey, {
        at: 0,  // stale — will trigger incremental scan
        rows: persisted.rows,
        lastBlock: persisted.lastBlock,
        batchCount: Math.ceil(persisted.rows.length / NOZK_VAULT_TOKEN_BATCH_SIZE),
      })
      // Immediately show persisted rows while incremental scan runs
      options?.onProgress?.(persisted.rows)
    }
  }

  const existing = vaultActivityCache.get(cacheKey)

  if (!options?.skipCache && ttl > 0 && existing && now - existing.at < ttl) {
    nozkVaultActivityDebug('cache hit', {
      ageMs: now - existing.at,
      ttlMs: ttl,
      rowCount: existing.rows.length,
      tokenIndices: existing.rows.map((r) => r.tokenIndex),
    })
    options?.onProgress?.(existing.rows)
    return existing.rows
  }

  if (inflightActivityKey === cacheKey && inflightActivityPromise) {
    nozkVaultActivityDebug('awaiting inflight fetch (deduped)')
    return inflightActivityPromise
  }

  // Incremental scan if we have stale cached data (from in-memory or localStorage)
  const isIncremental = existing != null && existing.lastBlock > 0
  const scanFromBlock = isIncremental
    ? '0x' + (existing.lastBlock + 1).toString(16)
    : fromBlock
  const incrementalParams = isIncremental
    ? { minBatches: existing.batchCount + 1 }
    : undefined

  nozkVaultActivityDebug('fetch start', {
    skipCache: options?.skipCache ?? false,
    ttlMs: ttl,
    vault,
    scanFromBlock,
    incremental: isIncremental,
    cachedRows: existing?.rows.length ?? 0,
  })

  const genAtStart = cacheGeneration
  inflightActivityKey = cacheKey
  inflightActivityPromise = fetchVaultActivityForFirstTokensImpl(
    masterSeed,
    options,
    vault,
    scanFromBlock,
    incrementalParams
  ).then(({ rows: newRows, batchCount: newBatchCount }) => {
    // Merge incremental results with cached rows
    const finalRows = isIncremental && existing
      ? mergeIncrementalRows(existing.rows, newRows)
      : newRows
    const lastBlock = Math.max(
      existing?.lastBlock ?? 0,
      ...finalRows.map((r) => r.blockNumber ?? 0)
    )
    // Only cache if no stale-mark happened during this fetch
    if (!options?.skipCache && ttl > 0 && cacheGeneration === genAtStart) {
      vaultActivityCache.set(cacheKey, {
        at: Date.now(),
        rows: finalRows,
        lastBlock,
        batchCount: Math.max(existing?.batchCount ?? 0, newBatchCount),
      })
      debouncedPersistAllCaches()
    }
    return finalRows
  })

  try {
    return await inflightActivityPromise
  } finally {
    inflightActivityKey = null
    inflightActivityPromise = null
  }
}

type VaultRowDraft = {
  row: Omit<VaultTx, 'dateIso' | 'time'>
  blockHex?: string
}

/**
 * Merge incremental scan results into cached rows.
 * New rows override cached rows with the same tokenIndex.
 */
function mergeIncrementalRows(cached: VaultTx[], incremental: VaultTx[]): VaultTx[] {
  const merged = new Map<number, VaultTx>()
  for (const r of cached) {
    if (r.tokenIndex != null) merged.set(r.tokenIndex, r)
  }
  for (const r of incremental) {
    if (r.tokenIndex != null) merged.set(r.tokenIndex, r)
  }
  return Array.from(merged.values()).sort(sortVaultRowsCompare)
}

function sortVaultRowsCompare(a: VaultTx, b: VaultTx): number {
  const ba = a.blockNumber ?? -1
  const bb = b.blockNumber ?? -1
  if (bb !== ba) return bb - ba
  return b.id.localeCompare(a.id)
}

function mergeVaultRowsSorted(a: VaultTx[], b: VaultTx[]): VaultTx[] {
  return [...a, ...b].sort(sortVaultRowsCompare)
}

async function finalizeDraftsToRows(
  drafts: VaultRowDraft[],
  rpc: ChainRpcFn
): Promise<VaultTx[]> {
  const blockDateCache = new Map<string, string>()
  const dateIsos: string[] = []
  for (const d of drafts) {
    const hex = d.blockHex
    if (!hex) {
      dateIsos.push(new Date().toISOString().slice(0, 10))
      continue
    }
    let iso = blockDateCache.get(hex)
    if (!iso) {
      iso = await blockHexToDateIso(hex, rpc)
      blockDateCache.set(hex, iso)
    }
    dateIsos.push(iso)
  }
  return drafts.map((d, i) => ({
    ...d.row,
    dateIso: dateIsos[i]!,
    time: dateIsos[i]!,
  }))
}

type ScanResult = { rows: VaultTx[]; batchCount: number }

async function fetchVaultActivityForFirstTokensImpl(
  masterSeed: Uint8Array,
  options: NozkVaultFetchOptions | undefined,
  vault: string,
  fromBlock: string,
  incremental?: { minBatches: number }
): Promise<ScanResult> {
  const netLabel = options?.networkLabel ?? TARGET_NETWORK_LABEL
  const rpc = createVaultScanRpcLimiter(
    NOZK_VAULT_SCAN_RPC_BURST,
    NOZK_VAULT_SCAN_RPC_PAUSE_MS
  )
  const maxBatches =
    options?.maxBatches != null && options.maxBatches > 0
      ? Math.min(options.maxBatches, NOZK_VAULT_ACTIVITY_MAX_BATCHES)
      : NOZK_VAULT_ACTIVITY_MAX_BATCHES

  const effectiveMaxBatches = incremental
    ? Math.min(incremental.minBatches, NOZK_VAULT_ACTIVITY_MAX_BATCHES)
    : maxBatches

  nozkVaultActivityDebug('scan batches', {
    burst: NOZK_VAULT_SCAN_RPC_BURST,
    pauseMs: NOZK_VAULT_SCAN_RPC_PAUSE_MS,
    batchSize: NOZK_VAULT_TOKEN_BATCH_SIZE,
    maxBatches: effectiveMaxBatches,
    incremental: !!incremental,
    note: incremental
      ? `incremental: scan ${effectiveMaxBatches} batches, no early stop`
      : 'stop after first empty batch (contiguous index assumption)',
  })

  let mergedRows: VaultTx[] = []
  let nonEmptyBatchCount = 0
  /** Stop at first empty batch under contiguous index assumption. */

  for (let b = 0; b < effectiveMaxBatches; b++) {
    const indices = batchTokenIndices(b)
    // On-chain match: derived depositId ⇔ log topic1 (see `latestLogByDepositId`).
    // Debug: `vaultDerivedAddressesForIndices(masterSeed, indices)`.
    const secretsList = indices.map((tokenIndex) =>
      deriveTokenSecrets(masterSeed, tokenIndex)
    )
    const depositIds = secretsList.map((s) => getDepositId(s))

    const [lockedRaw, fulfilledRaw, refundedRaw] = await Promise.all([
      fetchLogsForDepositIds(
        vault,
        DEPOSIT_LOCKED_TOPIC,
        depositIds,
        fromBlock,
        rpc
      ),
      fetchLogsForDepositIds(
        vault,
        MINT_FULFILLED_TOPIC,
        depositIds,
        fromBlock,
        rpc
      ),
      fetchLogsForDepositIds(
        vault,
        REFUNDED_TOPIC,
        depositIds,
        fromBlock,
        rpc
      ),
    ])

    const lockedById = latestLogByDepositId(lockedRaw)
    const fulfilledById = latestLogByDepositId(fulfilledRaw)
    const refundedById = latestLogByDepositId(refundedRaw)

    /** nullifierState: 0=UNREVEALED, 1=REVEALED, 2=SPENT */
    const nullifierStates: number[] = []
    for (let j = 0; j < indices.length; j++) {
      const secrets = secretsList[j]!
      const depositId = normalizeAddress(getDepositId(secrets))
      const hasMint = fulfilledById.has(depositId)
      if (!hasMint) {
        nullifierStates.push(NULLIFIER_UNREVEALED)
      } else {
        const nState = await fetchNullifierState(
          vault,
          getNullifierIdHex(secrets),
          rpc
        )
        nullifierStates.push(nState)
      }
    }

    const lockedFlags = indices.map((_, j) =>
      lockedById.has(normalizeAddress(depositIds[j]!))
    )
    const fulfilledFlags = indices.map((_, j) =>
      fulfilledById.has(normalizeAddress(depositIds[j]!))
    )
    const refundedFlags = indices.map((_, j) =>
      refundedById.has(normalizeAddress(depositIds[j]!))
    )
    nozkVaultActivityDebug(`batch ${b}`, {
      tokenIndices: indices,
      depositLocked: lockedFlags,
      mintFulfilled: fulfilledFlags,
      refunded: refundedFlags,
      nullifierState: nullifierStates,
    })

    // Batch-fetch NullifierRevealed logs for all revealed spend addresses
    const revealedNullifierIds = indices
      .map((_, j) => nullifierStates[j] === NULLIFIER_REVEALED ? getNullifierIdHex(secretsList[j]!) : null)
      .filter((a): a is string => a !== null)
    let revealedLogById = new Map<string, RpcLog>()
    if (revealedNullifierIds.length > 0) {
      const revealLogs = await fetchLogsForDepositIds(
        vault, NULLIFIER_REVEALED_TOPIC, revealedNullifierIds, fromBlock, rpc,
        nullifierIdToTopic
      )
      revealedLogById = latestLogByDepositId(revealLogs, topic1ToBytes32)
    }

    const batchDrafts: VaultRowDraft[] = []

    for (let j = 0; j < indices.length; j++) {
      const tokenIndex = indices[j]!
      const secrets = secretsList[j]!
      const depositId = normalizeAddress(getDepositId(secrets))
      const nullifierIdHex = getNullifierIdHex(secrets)
      const blindShort = addrShort(depositId)
      const spendShort = addrShort(nullifierIdHex)

      if (nullifierStates[j] === NULLIFIER_SPENT) {
        const mintLog = fulfilledById.get(depositId)
        const lockLog = lockedById.get(depositId)
        const refLog = mintLog ?? lockLog
        const blockHex = refLog?.blockNumber
        const bn = parseHexBlock(blockHex)
        const txh = refLog?.transactionHash ?? '—'
        batchDrafts.push({
          blockHex,
          row: {
            id: `vault-redeemed-${tokenIndex}`,
            type: 'Redeem',
            amount: NOZK_VAULT_DEPOSIT_AMOUNT_LABEL,
            counterparty: spendShort,
            txHash: txh,
            historyLabel: `Redeem · spent · token #${tokenIndex}`,
            historySub: `nullifier spent · block ${bn || '?'} · ${netLabel}`,
            blockNumber: bn,
            tokenIndex,
            networkLabel: netLabel,
          },
        })
        continue
      }

      if (nullifierStates[j] === NULLIFIER_REVEALED) {
        const revealLog = revealedLogById.get(normalizeBytes32(nullifierIdHex))
        const mintLog = fulfilledById.get(depositId)
        const lockLog = lockedById.get(depositId)
        const refLog = mintLog ?? lockLog
        // Prefer NullifierRevealed log metadata when available
        const blockHex = revealLog?.blockNumber ?? refLog?.blockNumber
        const bn = parseHexBlock(blockHex)
        const txh = revealLog?.transactionHash ?? refLog?.transactionHash ?? '—'
        batchDrafts.push({
          blockHex,
          row: {
            id: `vault-revealed-${tokenIndex}`,
            type: 'Revealed',
            amount: NOZK_VAULT_DEPOSIT_AMOUNT_LABEL,
            counterparty: spendShort,
            txHash: txh,
            historyLabel: `Revealed · ready to redeem · token #${tokenIndex}`,
            historySub: revealLog
              ? `NullifierRevealed · block ${bn || '?'} · ${netLabel}`
              : `Revealed (via state) · block ${bn || '?'} · ${netLabel}`,
            blockNumber: bn,
            tokenIndex,
            networkLabel: netLabel,
          },
        })
        continue
      }

      const fLog = fulfilledById.get(depositId)
      if (fLog) {
        const bn = parseHexBlock(fLog.blockNumber)
        const txh = fLog.transactionHash ?? '—'
        batchDrafts.push({
          blockHex: fLog.blockNumber,
          row: {
            id: `vault-deposit-${tokenIndex}`,
            type: 'Deposit',
            amount: NOZK_VAULT_DEPOSIT_AMOUNT_LABEL,
            counterparty: spendShort,
            txHash: txh,
            historyLabel: `Deposit · mint fulfilled · token #${tokenIndex}`,
            historySub: `MintFulfilled · ${txShort(txh)} · block ${bn || '?'} · ${netLabel}`,
            blockNumber: bn,
            tokenIndex,
            networkLabel: netLabel,
          },
        })
        continue
      }

      const lLog = lockedById.get(depositId)
      const rfLog = refundedById.get(depositId)
      if (lLog && rfLog) {
        const lBn = parseHexBlock(lLog.blockNumber)
        const rBn = parseHexBlock(rfLog.blockNumber)
        if (rBn > lBn) {
          const txh = rfLog.transactionHash ?? '—'
          batchDrafts.push({
            blockHex: rfLog.blockNumber,
            row: {
              id: `vault-refunded-${tokenIndex}`,
              type: 'Refunded',
              amount: NOZK_VAULT_DEPOSIT_AMOUNT_LABEL,
              counterparty: blindShort,
              txHash: txh,
              historyLabel: `Deposit · refunded · token #${tokenIndex}`,
              historySub: `Refunded · ${txShort(txh)} · block ${rBn || '?'} · ${netLabel}`,
              blockNumber: rBn,
              tokenIndex,
              networkLabel: netLabel,
            },
          })
          continue
        }
      } else if (rfLog) {
        const rBn = parseHexBlock(rfLog.blockNumber)
        const txh = rfLog.transactionHash ?? '—'
        batchDrafts.push({
          blockHex: rfLog.blockNumber,
          row: {
            id: `vault-refunded-${tokenIndex}`,
            type: 'Refunded',
            amount: NOZK_VAULT_DEPOSIT_AMOUNT_LABEL,
            counterparty: blindShort,
            txHash: txh,
            historyLabel: `Deposit · refunded · token #${tokenIndex}`,
            historySub: `Refunded · ${txShort(txh)} · block ${rBn || '?'} · ${netLabel}`,
            blockNumber: rBn,
            tokenIndex,
            networkLabel: netLabel,
          },
        })
        continue
      }

      if (lLog) {
        const bn = parseHexBlock(lLog.blockNumber)
        const txh = lLog.transactionHash ?? '—'
        batchDrafts.push({
          blockHex: lLog.blockNumber,
          row: {
            id: `vault-pending-${tokenIndex}`,
            type: 'Pending',
            amount: NOZK_VAULT_DEPOSIT_AMOUNT_LABEL,
            counterparty: blindShort,
            txHash: txh,
            historyLabel: `Deposit · pending · token #${tokenIndex}`,
            historySub: `DepositLocked · ${txShort(txh)} · block ${bn || '?'} · ${netLabel}`,
            blockNumber: bn,
            tokenIndex,
            networkLabel: netLabel,
          },
        })
      }
    }

    if (batchDrafts.length > 0) {
      const batchRows = await finalizeDraftsToRows(batchDrafts, rpc)
      mergedRows = mergeVaultRowsSorted(mergedRows, batchRows)
      options?.onProgress?.(mergedRows)
    }

    const batchAny = batchHasAnyVaultActivity(
      depositIds,
      lockedById,
      fulfilledById,
      refundedById
    )
    if (batchAny) nonEmptyBatchCount++

    // Progressive loading: update UI after each batch, even if it yielded no new rows.
    options?.onBatchProgress?.(b, mergedRows, indices)

    // In incremental mode, scan all requested batches (don't stop early).
    // In full-scan mode, stop at first empty batch (contiguous index assumption).
    if (!incremental && !batchAny) {
      nozkVaultActivityDebug(
        'scan stop: first empty batch (no DepositLocked / MintFulfilled / Refunded)',
        { batchIndex: b, tokenIndices: indices }
      )
      break
    }

    if (b === effectiveMaxBatches - 1) {
      nozkVaultActivityDebug('scan stop: reached batch cap', {
        maxBatches: effectiveMaxBatches,
        incremental: !!incremental,
        lastBatchTokenIndices: indices,
      })
    }
  }

  nozkVaultActivityDebug('scan done', {
    rowCount: mergedRows.length,
    rows: mergedRows.map((r) => ({
      tokenIndex: r.tokenIndex,
      type: r.type,
      historyLabel: r.historyLabel,
    })),
  })

  return { rows: mergedRows, batchCount: nonEmptyBatchCount }
}

/**
 * Largest token index that already has `DepositLocked` or `MintFulfilled` for its
 * derived `depositId`. Returns `-1` if none.
 *
 * **RPC:** Reuses the same in-memory cache and in-flight request as
 * {@link fetchVaultActivityForFirstTokens} (no duplicate `eth_getLogs` sweep when
 * Dashboard already scanned). On cache miss, delegates to that scan (one burst-limited
 * pass with the same stop rule as before).
 */
export async function findLastUsedVaultTokenIndex(
  masterSeed: Uint8Array,
  options?: Pick<
    NozkVaultFetchOptions,
    'contractAddress' | 'fromBlock' | 'maxBatches'
  >
): Promise<number> {
  const vault = normalizeAddress(
    options?.contractAddress ?? NOZK_VAULT_ADDRESS
  )
  const fromBlock = options?.fromBlock ?? NOZK_VAULT_SCAN_FROM_BLOCK_HEX
  const cacheKey = getVaultActivityCacheKey(masterSeed, vault, fromBlock)
  const ttl = scanCacheTtlMs()
  const now = Date.now()

  if (ttl > 0) {
    const hit = vaultActivityCache.get(cacheKey)
    if (hit && now - hit.at < ttl) {
      const lastUsed = lastUsedFromVaultActivityRows(hit.rows)
      nozkVaultActivityDebug('findLastUsedVaultTokenIndex: cache hit', {
        lastUsed,
      })
      return lastUsed
    }
  }

  if (inflightActivityKey === cacheKey && inflightActivityPromise) {
    nozkVaultActivityDebug(
      'findLastUsedVaultTokenIndex: awaiting inflight activity fetch'
    )
    const rows = await inflightActivityPromise
    return lastUsedFromVaultActivityRows(rows)
  }

  const rows = await fetchVaultActivityForFirstTokens(masterSeed, {
    contractAddress: options?.contractAddress,
    fromBlock: options?.fromBlock,
    maxBatches: options?.maxBatches,
  })
  return lastUsedFromVaultActivityRows(rows)
}

/**
 * Next token index for a **new** deposit: lowest free index >=
 * {@link NOZK_VAULT_MIN_NEW_DEPOSIT_TOKEN_INDEX}.
 * Reuses gaps only at or above this minimum (e.g. with min index 2, if 2 is free and 3 is used, picks 2).
 */
export async function getNextVaultTokenIndexForDeposit(
  masterSeed: Uint8Array,
  options?: Pick<
    NozkVaultFetchOptions,
    'contractAddress' | 'fromBlock' | 'maxBatches'
  >
): Promise<number> {
  const vault = normalizeAddress(
    options?.contractAddress ?? NOZK_VAULT_ADDRESS
  )
  const maxBatches =
    options?.maxBatches != null && options.maxBatches > 0
      ? Math.min(options.maxBatches, NOZK_VAULT_ACTIVITY_MAX_BATCHES)
      : NOZK_VAULT_DEFAULT_MAX_BATCHES
  const minIdx = NOZK_VAULT_MIN_NEW_DEPOSIT_TOKEN_INDEX
  const maxIdx = nozkVaultMaxScannedTokenIndex(maxBatches)

  nozkVaultActivityDebug('next token probe start', {
    minIdx,
    maxIdx,
    maxBatches,
    batchSize: NOZK_VAULT_TOKEN_BATCH_SIZE,
    vault,
  })

  for (let tokenIndex = minIdx; tokenIndex <= maxIdx; tokenIndex++) {
    const depositId = getDepositId(deriveTokenSecrets(masterSeed, tokenIndex))
    const encoded = encodeAddress32(depositId)
    const pendingHex = await chainRpcCall<string>('eth_call', [
      { to: vault, data: `${DEPOSIT_PENDING_SELECTOR}${encoded}` },
      'latest',
    ])
    const isPending = BigInt(pendingHex && pendingHex !== '0x' ? pendingHex : '0x0') !== 0n
    let isFulfilled = false
    if (!isPending) {
      const fulfilledHex = await chainRpcCall<string>('eth_call', [
        { to: vault, data: `${DEPOSIT_FULFILLED_SELECTOR}${encoded}` },
        'latest',
      ])
      isFulfilled = BigInt(fulfilledHex && fulfilledHex !== '0x' ? fulfilledHex : '0x0') !== 0n
    }
    if (!isPending && !isFulfilled) {
      nozkVaultActivityDebug('next token probe picked', {
        tokenIndex,
        depositId,
      })
      return tokenIndex
    }
  }

  throw new Error(
    `Could not find a free token index in [${minIdx}..${maxIdx}] (raise VITE_NOZK_VAULT_MAX_BATCHES).`
  )
}

/**
 * @deprecated Use {@link getNextVaultTokenIndexForDeposit} (same gap-filling behavior).
 */
export async function findFirstFreeVaultTokenIndex(
  masterSeed: Uint8Array,
  options?: Pick<
    NozkVaultFetchOptions,
    'contractAddress' | 'fromBlock' | 'maxBatches'
  >
): Promise<number> {
  return getNextVaultTokenIndexForDeposit(masterSeed, options)
}

/** @deprecated Use `fetchVaultActivityForFirstTokens` (includes MintFulfilled → Deposit). */
export async function fetchPendingDepositsFromEvents(
  masterSeed: Uint8Array,
  options?: NozkVaultFetchOptions
): Promise<VaultTx[]> {
  const all = await fetchVaultActivityForFirstTokens(masterSeed, options)
  return all.filter((x) => x.type === 'Pending')
}

/** Fire after signing / clearing derived seed (refresh activity, gas, etc.). */
export const NOZK_MASTER_SEED_CHANGED_EVENT = 'nozk:master-seed-changed'

/**
 * Only `VITE_NOZK_MASTER_SEED_HEX` (optional, e.g. CI / dev without a wallet).
 * In normal use `masterSeed` comes from `personal_sign` via `NozkMasterSeedProvider`.
 */
export function getNozkMasterSeedFromEnv(): Uint8Array | null {
  const raw = import.meta.env.VITE_NOZK_MASTER_SEED_HEX as string | undefined
  if (raw == null || String(raw).trim() === '') return null
  const hex = raw.replace(/^0x/i, '').trim()
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null
  return Uint8Array.from(hex.match(/.{2}/g)!.map((x) => parseInt(x, 16)))
}
