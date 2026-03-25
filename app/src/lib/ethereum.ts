import { fujiRpcCall, PUBLIC_FUJI_HTTPS_RPC } from './fujiJsonRpc'

export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

export function getEthereum(): EthereumProvider | null {
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum ?? null
}

/** Normalizes `eth_accounts` / `eth_requestAccounts` responses to `0x` addresses. */
export function parseEthAddressList(x: unknown): string[] {
  if (!Array.isArray(x)) return []
  return x.filter(
    (a): a is string => typeof a === 'string' && a.startsWith('0x')
  )
}

/** Avalanche Fuji Testnet (chainlist.org/chain/43113) */
export const FUJI_CHAIN_ID = '0xa869'

const FUJI_ADD_CHAIN_PARAMS = {
  chainId: FUJI_CHAIN_ID,
  chainName: 'Avalanche Fuji Testnet',
  nativeCurrency: {
    name: 'Avalanche',
    symbol: 'AVAX',
    decimals: 18,
  },
  rpcUrls: [PUBLIC_FUJI_HTTPS_RPC],
  blockExplorerUrls: ['https://testnet.snowtrace.io'],
} as const

/** Converts `eth_getBalance` (hex wei) to a label with the native symbol (e.g. AVAX). */
export function weiHexToNativeLabel(
  weiHex: string,
  symbol: string,
  fractionDigits = 4
): string {
  const wei = BigInt(weiHex)
  const n = Number(wei) / 1e18
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(fractionDigits)} ${symbol}`
}

export function normalizeChainId(chainId: unknown): string | null {
  if (typeof chainId !== 'string') return null
  return chainId.toLowerCase()
}

/**
 * Delay **between** each `eth_getTransactionReceipt` poll (ms). This is the “poll interval.”
 * Shorter = more RPC traffic, faster detection once the tx mines.
 */
const RECEIPT_POLL_INTERVAL_MS = 10_000
/**
 * How many times to **call** `eth_getTransactionReceipt` before throwing.
 * Worst-case wait if the receipt never appears: `(maxAttempts − 1) × RECEIPT_POLL_INTERVAL_MS`
 * (waits only happen *after* failed attempts; e.g. 11 attempts → 10 sleeps → ~30s at 3000ms).
 */
const RECEIPT_POLL_MAX_ATTEMPTS = 11

/**
 * Polls for a mined receipt. Prefer `options.ethereum` so the wallet’s RPC is used
 * (avoids stacking `eth_getTransactionReceipt` on the same Infura key as vault scans).
 * Falls back to {@link fujiRpcCall} when no provider is passed.
 *
 * Used only here: deposit modal (`DepositConfirmModal`) and redeem (`sendVaultRedeem.ts`).
 */
export async function waitForTransactionReceipt(
  txHash: string,
  options?: { ethereum?: EthereumProvider }
): Promise<{ status?: string }> {
  const poll = async (): Promise<{ status?: string } | null> => {
    if (options?.ethereum) {
      const r = await options.ethereum.request({
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      })
      return r as { status?: string } | null
    }
    return fujiRpcCall<{ status?: string } | null>(
      'eth_getTransactionReceipt',
      [txHash]
    )
  }
  for (let i = 0; i < RECEIPT_POLL_MAX_ATTEMPTS; i++) {
    const receipt = await poll()
    if (receipt) return receipt
    if (i < RECEIPT_POLL_MAX_ATTEMPTS - 1) {
      await new Promise((r) => window.setTimeout(r, RECEIPT_POLL_INTERVAL_MS))
    }
  }
  throw new Error(
    `Timed out waiting for confirmation (${RECEIPT_POLL_MAX_ATTEMPTS} receipt checks, ${RECEIPT_POLL_INTERVAL_MS}ms between checks)`
  )
}

export async function estimateSimpleTransferGasNative(
  ethereum: EthereumProvider,
  nativeSymbol = 'AVAX'
): Promise<string> {
  try {
    const gasPriceHex = (await ethereum.request({
      method: 'eth_gasPrice',
      params: [],
    })) as string
    const gasPrice = BigInt(gasPriceHex)
    const gasLimit = 21000n
    const wei = gasPrice * gasLimit
    const n = Number(wei) / 1e18
    if (!Number.isFinite(n) || n <= 0) return '—'
    if (n < 0.000001) return `< 0.000001 ${nativeSymbol}`
    return `~${n.toFixed(6)} ${nativeSymbol}`
  } catch {
    return '—'
  }
}

/**
 * Ensures Avalanche Fuji (43113): `wallet_switchEthereumChain` or `wallet_addEthereumChain`.
 */
export async function ensureFuji(ethereum: EthereumProvider): Promise<boolean> {
  const id = normalizeChainId(await ethereum.request({ method: 'eth_chainId' }))
  if (id === FUJI_CHAIN_ID) return true
  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: FUJI_CHAIN_ID }],
    })
    return (
      normalizeChainId(await ethereum.request({ method: 'eth_chainId' })) ===
      FUJI_CHAIN_ID
    )
  } catch (e: unknown) {
    const code = (e as { code?: number }).code
    if (code !== 4902) return false
    try {
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [FUJI_ADD_CHAIN_PARAMS],
      })
      return (
        normalizeChainId(await ethereum.request({ method: 'eth_chainId' })) ===
        FUJI_CHAIN_ID
      )
    } catch {
      return false
    }
  }
}
