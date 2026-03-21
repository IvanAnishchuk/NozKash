export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

export function getEthereum(): EthereumProvider | null {
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum ?? null
}

/** Convierte respuesta `eth_getBalance` (hex wei) a etiqueta legible. */
export function weiHexToEthLabel(weiHex: string, fractionDigits = 4): string {
  const wei = BigInt(weiHex)
  const eth = Number(wei) / 1e18
  if (!Number.isFinite(eth)) return '—'
  return `${eth.toFixed(fractionDigits)} ETH`
}

export function normalizeChainId(chainId: unknown): string | null {
  if (typeof chainId !== 'string') return null
  return chainId.toLowerCase()
}

const SEPOLIA_CHAIN_ID = '0xaa36a7'

export async function waitForTransactionReceipt(
  ethereum: EthereumProvider,
  txHash: string
): Promise<{ status?: string }> {
  for (let i = 0; i < 60; i++) {
    const receipt = (await ethereum.request({
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    })) as { status?: string } | null

    if (receipt) return receipt
    await new Promise((r) => window.setTimeout(r, 1000))
  }
  throw new Error('Timeout esperando confirmación')
}

export async function estimateSimpleTransferGasEth(
  ethereum: EthereumProvider
): Promise<string> {
  try {
    const gasPriceHex = (await ethereum.request({
      method: 'eth_gasPrice',
      params: [],
    })) as string
    const gasPrice = BigInt(gasPriceHex)
    const gasLimit = 21000n
    const wei = gasPrice * gasLimit
    const eth = Number(wei) / 1e18
    if (!Number.isFinite(eth) || eth <= 0) return '—'
    if (eth < 0.000001) return '< 0.000001 ETH'
    return `~${eth.toFixed(6)} ETH`
  } catch {
    return '—'
  }
}

export async function ensureSepolia(ethereum: EthereumProvider): Promise<boolean> {
  const id = normalizeChainId(await ethereum.request({ method: 'eth_chainId' }))
  if (id === SEPOLIA_CHAIN_ID) return true
  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: SEPOLIA_CHAIN_ID }],
    })
    return (
      normalizeChainId(await ethereum.request({ method: 'eth_chainId' })) ===
      SEPOLIA_CHAIN_ID
    )
  } catch {
    return false
  }
}
