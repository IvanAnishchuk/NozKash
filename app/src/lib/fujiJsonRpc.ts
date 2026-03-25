/**
 * On-chain reads on Fuji without using the wallet’s RPC.
 *
 * **CORS:** if the default Infura URL blocks the browser origin, set
 * `VITE_FUJI_RPC_URL` to an endpoint that allows your app (or use a provider
 * dashboard to allow `http://localhost:*`).
 *
 * **429 / public RPC:** All calls are serialized and spaced (`VITE_FUJI_RPC_MIN_GAP_MS`,
 * default 150ms). Set to `0` for a paid endpoint with high limits. Retries use
 * exponential backoff (min ~2.5s between attempts on HTTP 429). Default max attempts 4
 * (`VITE_FUJI_RPC_MAX_RETRIES`). Tune vault scan via `VITE_GHOST_VAULT_RPC_BURST` /
 * `VITE_GHOST_VAULT_RPC_PAUSE_MS`.
 */

/** Fuji C-Chain HTTP JSON-RPC (Infura public key — override with `VITE_FUJI_RPC_URL`). */
export const PUBLIC_FUJI_HTTPS_RPC =
  'https://avalanche-fuji.infura.io/v3/7026bb4d4e424828bfb0824e61bde166'

export function getFujiRpcUrl(): string {
  const raw = import.meta.env.VITE_FUJI_RPC_URL as string | undefined
  const u = raw?.trim()
  if (u && u.length > 0) return u
  return PUBLIC_FUJI_HTTPS_RPC
}

let nextId = 0

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function parseMaxRetries(): number {
  const raw = import.meta.env.VITE_FUJI_RPC_MAX_RETRIES as string | undefined
  if (raw == null || String(raw).trim() === '') return 4
  const n = Number.parseInt(String(raw).replace(/_/g, ''), 10)
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 12) : 4
}

/** Min ms between the end of one HTTP JSON-RPC request and the start of the next (global). */
function parseMinGapMs(): number {
  const raw = import.meta.env.VITE_FUJI_RPC_MIN_GAP_MS as string | undefined
  if (raw == null || String(raw).trim() === '') return 150
  const n = Number.parseInt(String(raw).replace(/_/g, ''), 10)
  if (!Number.isFinite(n) || n < 0) return 150
  return Math.min(n, 5000)
}

/**
 * Serializes every `fujiRpcCall` and optionally inserts a quiet period between requests.
 * Prevents overlapping vault scans + log chunks from hammering free/public RPC tiers.
 */
let fujiRpcTail: Promise<unknown> = Promise.resolve()
let fujiRpcLastEndMs = 0

function scheduleFujiRpc<T>(run: () => Promise<T>): Promise<T> {
  const p = fujiRpcTail.then(async () => {
    const gap = parseMinGapMs()
    if (fujiRpcLastEndMs > 0 && gap > 0) {
      const wait = Math.max(0, gap - (Date.now() - fujiRpcLastEndMs))
      if (wait > 0) await sleep(wait)
    }
    try {
      return await run()
    } finally {
      fujiRpcLastEndMs = Date.now()
    }
  }) as Promise<T>
  fujiRpcTail = p.then(
    () => undefined,
    () => undefined
  )
  return p
}

function backoffMs(attempt: number, retryAfterSec?: number | null): number {
  const base = 800 * 2 ** attempt
  const jitter = Math.floor(Math.random() * 250)
  if (retryAfterSec != null && Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return Math.max(base + jitter, retryAfterSec * 1000)
  }
  return base + jitter
}

function isJsonRpcRateLimitError(
  err: { message?: string; code?: number } | undefined
): boolean {
  if (!err) return false
  const code = err.code
  if (code === -32005 || code === -32016) return true
  const m = err.message ?? ''
  return /rate|limit|too many|throttl|429/i.test(m)
}

async function fujiRpcCallOnce<T>(
  url: string,
  method: string,
  params: unknown[]
): Promise<T> {
  const maxAttempts = parseMaxRetries()
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++nextId,
          method,
          params,
        }),
      })
    } catch (e) {
      lastError =
        e instanceof Error ? e : new Error(String(e))
      if (attempt < maxAttempts - 1) {
        await sleep(backoffMs(attempt))
        continue
      }
      throw lastError
    }

    if (res.status === 429 || res.status === 503) {
      const ra = res.headers.get('Retry-After')
      const sec = ra != null ? Number.parseInt(ra, 10) : NaN
      lastError = new Error(`Fuji RPC HTTP ${res.status} (${url})`)
      if (attempt < maxAttempts - 1) {
        const backoff = backoffMs(
          attempt,
          Number.isFinite(sec) ? sec : undefined
        )
        await sleep(Math.max(backoff, res.status === 429 ? 2500 : 1000))
        continue
      }
      throw lastError
    }

    if (!res.ok) {
      throw new Error(`Fuji RPC HTTP ${res.status} (${url})`)
    }

    let json: {
      result?: T
      error?: { message?: string; code?: number }
    }
    try {
      json = (await res.json()) as {
        result?: T
        error?: { message?: string; code?: number }
      }
    } catch {
      throw new Error(`Fuji RPC invalid JSON (${url})`)
    }

    if (json.error) {
      const e = json.error
      if (isJsonRpcRateLimitError(e) && attempt < maxAttempts - 1) {
        await sleep(Math.max(backoffMs(attempt), 2000))
        continue
      }
      throw new Error(
        e.message ??
          `Fuji RPC error${e.code != null ? ` ${e.code}` : ''}`
      )
    }

    return json.result as T
  }

  throw lastError ?? new Error('Fuji RPC failed after retries')
}

export async function fujiRpcCall<T>(
  method: string,
  params: unknown[] = []
): Promise<T> {
  const url = getFujiRpcUrl()
  return scheduleFujiRpc(() => fujiRpcCallOnce<T>(url, method, params))
}
