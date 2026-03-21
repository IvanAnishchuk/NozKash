import { useCallback, useEffect, useMemo, useState } from 'react'

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

function getEthereum() {
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum
}

function normalizeChainId(chainId: unknown): string | null {
  if (typeof chainId !== 'string') return null
  return chainId.toLowerCase()
}

export function useWallet() {
  const [account, setAccount] = useState<string | null>(null)
  const [network, setNetwork] = useState<NetworkLabel>('Wrong Network')

  const isConnected = useMemo(
    () => account !== null && network === 'Sepolia',
    [account, network]
  )

  const refreshNetwork = useCallback(async () => {
    const ethereum = getEthereum()
    if (!ethereum) return

    const chainId = normalizeChainId(await ethereum.request({ method: 'eth_chainId' }))
    if (chainId === TARGET_CHAIN_ID) setNetwork('Sepolia')
    else setNetwork('Wrong Network')
  }, [])

  useEffect(() => {
    const ethereum = getEthereum()
    if (!ethereum) return

    let isCancelled = false

    ;(async () => {
      try {
        const [accounts, chainId] = await Promise.all([
          ethereum.request({ method: 'eth_accounts' }) as Promise<string[]>,
          ethereum.request({ method: 'eth_chainId' }),
        ])

        if (isCancelled) return

        setAccount(accounts[0] ?? null)
        const normalized = normalizeChainId(chainId)
        setNetwork(normalized === TARGET_CHAIN_ID ? 'Sepolia' : 'Wrong Network')
      } catch (err) {
        if (isCancelled) return
        console.error('Wallet init failed', err)
      }
    })()

    const handleAccountsChanged = (accounts: unknown) => {
      if (Array.isArray(accounts) && typeof accounts[0] === 'string') {
        setAccount(accounts[0] as string)
      } else {
        setAccount(null)
      }
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
    const ethereum = getEthereum()
    if (!ethereum) {
      window.alert('MetaMask no está instalado.')
      return
    }

    try {
      const accounts = (await ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[]

      setAccount(accounts?.[0] ?? null)

      const chainIdBefore = normalizeChainId(
        await ethereum.request({ method: 'eth_chainId' })
      )

      if (chainIdBefore !== TARGET_CHAIN_ID) {
        await ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: TARGET_CHAIN_ID }],
        })
      }

      // Always re-check after switching (or if already on Sepolia)
      await refreshNetwork()
    } catch (err) {
      console.error('connectWallet failed', err)
      await refreshNetwork()
    }
  }, [refreshNetwork])

  return {
    connectWallet,
    account,
    isConnected,
    network,
    truncatedAddress: account ? truncateAddress(account) : null,
  }
}

