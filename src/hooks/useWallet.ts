import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getEthereum, weiHexToEthLabel } from '../lib/ethereum'

type NetworkLabel = 'Sepolia' | 'Wrong Network'

const TARGET_CHAIN_ID = '0xaa36a7'

type EthereumProvider = {
  request: (args: {
    method: string
    params?: unknown[]
  }) => Promise<unknown>
  on?: (event: string, handler: (...args: unknown[]) => void) => void
  removeListener?: (
    event: string,
    handler: (...args: unknown[]) => void
  ) => void
}

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getEthereumProvider(): EthereumProvider | undefined {
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum
}

function normalizeChainId(chainId: unknown): string | null {
  if (typeof chainId !== 'string') return null
  return chainId.toLowerCase()
}

function parseAccounts(accs: unknown): string[] {
  if (!Array.isArray(accs)) return []
  return accs.filter((a): a is string => typeof a === 'string' && a.startsWith('0x'))
}

export function useWallet() {
  const [accounts, setAccounts] = useState<string[]>([])
  const [account, setAccount] = useState<string | null>(null)
  const [network, setNetwork] = useState<NetworkLabel>('Wrong Network')
  const [balanceWeiHex, setBalanceWeiHex] = useState<string | null>(null)
  const accountsRef = useRef<string[]>([])
  accountsRef.current = accounts

  useEffect(() => {
    const ethereum = getEthereum()
    if (!ethereum || !account) {
      setBalanceWeiHex(null)
      return
    }
    let cancelled = false
    ethereum
      .request({ method: 'eth_getBalance', params: [account, 'latest'] })
      .then((hex) => {
        if (!cancelled) setBalanceWeiHex(hex as string)
      })
      .catch(() => {
        if (!cancelled) setBalanceWeiHex(null)
      })
    return () => {
      cancelled = true
    }
  }, [account, network])

  const homeBalanceMain = useMemo(() => {
    if (!balanceWeiHex) return null
    return weiHexToEthLabel(balanceWeiHex, 4)
  }, [balanceWeiHex])

  const homeBalanceUsd = useMemo(() => {
    if (!balanceWeiHex) return null
    const eth = Number(BigInt(balanceWeiHex)) / 1e18
    if (!Number.isFinite(eth)) return null
    return `≈ $${(eth * 2417).toFixed(2)} USD`
  }, [balanceWeiHex])

  const isConnected = useMemo(
    () => account !== null && network === 'Sepolia',
    [account, network]
  )

  const refreshNetwork = useCallback(async () => {
    const ethereum = getEthereumProvider()
    if (!ethereum) return

    const chainId = normalizeChainId(
      await ethereum.request({ method: 'eth_chainId' })
    )
    if (chainId === TARGET_CHAIN_ID) setNetwork('Sepolia')
    else setNetwork('Wrong Network')
  }, [])

  const selectAccount = useCallback((address: string) => {
    if (!accountsRef.current.includes(address)) return
    setAccount(address)
  }, [])

  useEffect(() => {
    const ethereum = getEthereumProvider()
    if (!ethereum) return

    let isCancelled = false

    ;(async () => {
      try {
        const [accs, chainId] = await Promise.all([
          ethereum.request({ method: 'eth_accounts' }) as Promise<unknown>,
          ethereum.request({ method: 'eth_chainId' }),
        ])

        if (isCancelled) return

        const list = parseAccounts(accs)
        setAccounts(list)
        setAccount((prev) => {
          if (list.length === 0) return null
          if (prev && list.includes(prev)) return prev
          return list[0]
        })
        const normalized = normalizeChainId(chainId)
        setNetwork(normalized === TARGET_CHAIN_ID ? 'Sepolia' : 'Wrong Network')
      } catch (err) {
        if (isCancelled) return
        console.error('Wallet init failed', err)
      }
    })()

    const handleAccountsChanged = (accs: unknown) => {
      const list = parseAccounts(accs)
      setAccounts(list)
      setAccount((prev) => {
        if (list.length === 0) return null
        if (prev && list.includes(prev)) return prev
        return list[0]
      })
    }
    const handleChainChanged = (newChainId: unknown) => {
      const normalized = normalizeChainId(newChainId)
      setNetwork(normalized === TARGET_CHAIN_ID ? 'Sepolia' : 'Wrong Network')
    }

    if (typeof ethereum?.on === 'function') {
      ethereum.on('accountsChanged', handleAccountsChanged)
      ethereum.on('chainChanged', handleChainChanged)
    }

    return () => {
      isCancelled = true
      if (typeof ethereum?.removeListener === 'function') {
        ethereum.removeListener('accountsChanged', handleAccountsChanged)
        ethereum.removeListener('chainChanged', handleChainChanged)
      }
    }
  }, [])

  const connectWallet = useCallback(async () => {
    const ethereum = getEthereumProvider()
    if (!ethereum) {
      window.alert('MetaMask no está instalado.')
      return
    }

    try {
      const accs = parseAccounts(
        await ethereum.request({ method: 'eth_requestAccounts' })
      )

      setAccounts(accs)
      setAccount(accs[0] ?? null)

      const chainIdBefore = normalizeChainId(
        await ethereum.request({ method: 'eth_chainId' })
      )

      if (chainIdBefore !== TARGET_CHAIN_ID) {
        await ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: TARGET_CHAIN_ID }],
        })
      }

      await refreshNetwork()
    } catch (err) {
      console.error('connectWallet failed', err)
      await refreshNetwork()
    }
  }, [refreshNetwork])

  const disconnectWallet = useCallback(async () => {
    const ethereum = getEthereumProvider()
    if (ethereum?.request) {
      try {
        await ethereum.request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }],
        })
      } catch {
        /* MetaMask antiguo u otro proveedor: igual limpiamos la UI */
      }
    }
    setAccounts([])
    setAccount(null)
  }, [])

  /** Abre MetaMask (`eth_requestAccounts`) para conectar más cuentas o revisar permisos. */
  const openMetaMaskAccountPicker = useCallback(async (): Promise<boolean> => {
    const ethereum = getEthereumProvider()
    if (!ethereum) {
      window.alert('MetaMask no está instalado.')
      return false
    }
    try {
      const accs = parseAccounts(
        await ethereum.request({ method: 'eth_requestAccounts' })
      )
      setAccounts(accs)
      setAccount((prev) => {
        if (accs.length === 0) return null
        if (prev && accs.includes(prev)) return prev
        return accs[0]
      })
      await refreshNetwork()
      return true
    } catch {
      return false
    }
  }, [refreshNetwork])

  return {
    connectWallet,
    disconnectWallet,
    openMetaMaskAccountPicker,
    accounts,
    account,
    selectAccount,
    isConnected,
    network,
    truncatedAddress: account ? truncateAddress(account) : null,
    homeBalanceMain,
    homeBalanceUsd,
  }
}
