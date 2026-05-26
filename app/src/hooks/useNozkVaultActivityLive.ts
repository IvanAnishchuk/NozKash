import { useEffect, useMemo, useRef, useState } from 'react'
import { TARGET_NETWORK_LABEL } from '../lib/ethereum'
import {
  buildLocalMutatedRow,
  fetchVaultActivityForFirstTokens,
  fetchVaultRowForTokenIndex,
  NOZK_VAULT_ACTIVITY_REFRESH_EVENT,
  NOZK_VAULT_DEPOSIT_AMOUNT_LABEL,
  NOZK_VAULT_OPTIMISTIC_PENDING_EVENT,
  NOZK_VAULT_ROW_UPDATE_EVENT,
  NOZK_VAULT_RPC_POLL_MS,
  setNozkVaultLiveActive,
  type NozkVaultOptimisticPendingDetail,
  type NozkVaultRowUpdateDetail,
} from '../lib/nozkVault'
import { startNozkVaultActivityLive, getChainWsRpcUrl } from '../lib/nozkVaultLiveActivity'
import type { VaultTx } from '../types/activity'

function sortRows(a: VaultTx, b: VaultTx): number {
  const ba = a.blockNumber ?? -1
  const bb = b.blockNumber ?? -1
  if (bb !== ba) return bb - ba
  return b.id.localeCompare(a.id)
}

export function useNozkVaultActivityLive(params: {
  masterSeed: Uint8Array | undefined | null
  seedRevision: number
  network: string
  /**
   * Optional: cap how far the live controller derives tokenIndex mappings.
   * Defaults to the same cap as the HTTP scanner.
   */
  maxBatches?: number
  /**
   * For UI strings (typically equals `TARGET_NETWORK_LABEL` when on the target chain).
   */
  networkLabel: string
}): { rows: VaultTx[]; loading: boolean; error: string | null; scanBatch: number | null } {
  const { masterSeed, seedRevision, network, maxBatches, networkLabel } = params

  const [rows, setRows] = useState<VaultTx[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanBatch, setScanBatch] = useState<number | null>(null)

  const wsUrl = useMemo(() => getChainWsRpcUrl(), [])

  const controllerRef = useRef<ReturnType<typeof startNozkVaultActivityLive> | null>(null)
  const lastSeedRevisionRef = useRef<number>(seedRevision)
  const optimisticByTokenRef = useRef<Map<number, VaultTx>>(new Map())
  const rowsRef = useRef<VaultTx[]>([])
  const pollingRef = useRef(false)

  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const mergeWithOptimistic = (base: VaultTx[]): VaultTx[] => {
    if (optimisticByTokenRef.current.size === 0) return base
    // Keep optimistic/probed rows sticky while progressive scan runs:
    // partial snapshots may temporarily omit higher token indices.
    const next = [...base]
    for (const [tokenIndex, optimistic] of optimisticByTokenRef.current.entries()) {
      const withoutSameToken = next.filter((r) => r.tokenIndex !== tokenIndex)
      withoutSameToken.unshift(optimistic)
      next.splice(0, next.length, ...withoutSameToken)
    }
    return next
  }

  useEffect(() => {
    let cancelled = false
    controllerRef.current?.stop()
    controllerRef.current = null

    optimisticByTokenRef.current.clear()
    setRows([])
    setError(null)
    setScanBatch(null)

    if (network !== TARGET_NETWORK_LABEL || !masterSeed) {
      setLoading(false)
      setNozkVaultLiveActive(false)
      return () => {
        cancelled = true
      }
    }

    const wsEnabled = Boolean(wsUrl)
    setLoading(true)
    setNozkVaultLiveActive(wsEnabled)
    const seed = masterSeed as Uint8Array

    async function initialLoad() {
      try {
        const rowsForUi = await fetchVaultActivityForFirstTokens(seed, {
          networkLabel,
          onProgress: (r) => {
            if (cancelled) return
            setRows(mergeWithOptimistic(r))
          },
          onBatchProgress: (b) => {
            if (cancelled) return
            setScanBatch(b)
          },
          maxBatches,
        })
        if (cancelled) return

        setRows(mergeWithOptimistic(rowsForUi))
        setLoading(false)
        setScanBatch(null)

        const lastBlock = Math.max(
          -1,
          ...rowsForUi.map((r) => r.blockNumber ?? -1)
        )
        const controller = startNozkVaultActivityLive({
          masterSeed: seed,
          networkLabel,
          initialRows: rowsForUi,
          lastProcessedBlock: lastBlock,
          maxBatches,
          onRows: (next) => {
            if (cancelled) return
            setRows(mergeWithOptimistic(next))
          },
        })
        controllerRef.current = controller
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Could not load vault activity')
        setRows([])
        setLoading(false)
        setScanBatch(null)
      }
    }

    void initialLoad()

    // Targeted polling: only probe tokens that might change externally.
    // - Optimistic tokens: freshly deposited, awaiting on-chain confirmation
    // - Pending tokens: awaiting MintFulfilled from the mint daemon
    // All other transitions (Revealed, Redeemed, Refunded) are user-initiated
    // and handled via publishVaultRowUpdate — no polling needed.
    const intervalId = window.setInterval(() => {
      if (cancelled || pollingRef.current) return

      // Collect tokens that need probing — read from ref to avoid updater side-effects
      const optimisticTokens = new Set(optimisticByTokenRef.current.keys())
      const pendingTokenIndices: number[] = []
      for (const r of rowsRef.current) {
        if (r.type === 'Pending' && r.tokenIndex !== undefined && !optimisticTokens.has(r.tokenIndex)) {
          pendingTokenIndices.push(r.tokenIndex)
        }
      }

      const tokensToProbe = [...optimisticTokens, ...pendingTokenIndices]
      if (tokensToProbe.length === 0) return // nothing to poll

      pollingRef.current = true
      void (async () => {
        try {
          for (const tokenIndex of tokensToProbe) {
            if (cancelled) return
            try {
              const row = await fetchVaultRowForTokenIndex(seed, tokenIndex, {
                networkLabel,
              })
              if (cancelled) return
              if (!row) continue
              // If state changed from what we had, update
              optimisticByTokenRef.current.delete(tokenIndex)
              setRows((prev) => {
                const existing = prev.find((r) => r.tokenIndex === tokenIndex)
                if (existing && existing.id === row.id && existing.type === row.type) return prev // no change
                const next = prev.filter((r) => r.tokenIndex !== tokenIndex)
                next.push(row)
                next.sort(sortRows)
                return mergeWithOptimistic(next)
              })
            } catch {
              // Best effort — try next token.
            }
          }
        } finally {
          pollingRef.current = false
        }
      })()
    }, NOZK_VAULT_RPC_POLL_MS)

    // Full refresh listener — only used for account/seed switch (Layout.tsx)
    const onRefresh = () => {
      void (async () => {
        try {
          const snap = await fetchVaultActivityForFirstTokens(seed, {
            networkLabel,
            maxBatches,
          })
          if (!cancelled) setRows(mergeWithOptimistic(snap))
        } catch {
          // ignore
        }
      })()
    }
    window.addEventListener(NOZK_VAULT_ACTIVITY_REFRESH_EVENT, onRefresh)
    const onOptimisticPending = (ev: Event) => {
      const d = (ev as CustomEvent<NozkVaultOptimisticPendingDetail>).detail
      if (!d || typeof d.tokenIndex !== 'number') return
      if (network !== TARGET_NETWORK_LABEL) return
      const today = new Date().toISOString().slice(0, 10)
      setRows((prev) => {
        const withoutSameToken = prev.filter(
          (r) =>
            !(
              r.tokenIndex === d.tokenIndex &&
              (r.type === 'Pending' || r.type === 'Deposit')
            )
        )
        const optimistic: VaultTx = {
          id: `vault-pending-optimistic-${d.tokenIndex}-${Date.now()}`,
          type: 'Pending',
          amount: NOZK_VAULT_DEPOSIT_AMOUNT_LABEL,
          counterparty: '—',
          txHash: d.txHash,
          dateIso: today,
          time: today,
          historyLabel: `Deposit · pending · token #${d.tokenIndex}`,
          historySub: `Submitted · awaiting mint fulfillment · ${d.networkLabel}`,
          blockNumber: Number.MAX_SAFE_INTEGER,
          tokenIndex: d.tokenIndex,
          networkLabel: d.networkLabel,
        }
        optimisticByTokenRef.current.set(d.tokenIndex, optimistic)
        return [optimistic, ...withoutSameToken]
      })
    }
    window.addEventListener(
      NOZK_VAULT_OPTIMISTIC_PENDING_EVENT,
      onOptimisticPending as EventListener
    )

    // Row-update event: instant local state mutation after user actions.
    // Side effects (controller mutation) run outside the updater to avoid
    // double-invocation in StrictMode.
    const onRowUpdate = (ev: Event) => {
      const d = (ev as CustomEvent<NozkVaultRowUpdateDetail>).detail
      if (!d || typeof d.tokenIndex !== 'number') return
      const existing = rowsRef.current.find((r) => r.tokenIndex === d.tokenIndex)
      if (!existing) return
      const updated = buildLocalMutatedRow(existing, d.newType, d.txHash, d.blockNumber)
      optimisticByTokenRef.current.delete(d.tokenIndex)
      controllerRef.current?.mutateRow(d.tokenIndex, updated)
      setRows((prev) => {
        const next = prev.map((r) => (r.tokenIndex === d.tokenIndex ? updated : r))
        next.sort(sortRows)
        return next
      })
    }
    window.addEventListener(
      NOZK_VAULT_ROW_UPDATE_EVENT,
      onRowUpdate as EventListener
    )

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.removeEventListener(NOZK_VAULT_ACTIVITY_REFRESH_EVENT, onRefresh)
      window.removeEventListener(
        NOZK_VAULT_OPTIMISTIC_PENDING_EVENT,
        onOptimisticPending as EventListener
      )
      window.removeEventListener(
        NOZK_VAULT_ROW_UPDATE_EVENT,
        onRowUpdate as EventListener
      )
      controllerRef.current?.stop()
      controllerRef.current = null
      setNozkVaultLiveActive(false)
      lastSeedRevisionRef.current = seedRevision
    }
  }, [network, masterSeed, seedRevision, maxBatches, networkLabel, wsUrl])

  return { rows, loading, error, scanBatch }
}
