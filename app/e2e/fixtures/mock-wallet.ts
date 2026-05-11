/**
 * Mock EIP-1193 wallet provider for Playwright tests.
 *
 * Injects `window.ethereum` before the page loads, backed by a hardcoded
 * anvil account. Proxies JSON-RPC calls to the local anvil node and
 * signs `personal_sign` requests by forwarding to anvil's `personal_sign`.
 */

import type { Page } from '@playwright/test'

// Anvil account 0 (well-known test keys, not real secrets)
export { DEPLOYER_ADDRESS as MOCK_ACCOUNT_ADDRESS, DEPLOYER_KEY as MOCK_ACCOUNT_KEY } from './test-constants.ts'

export async function injectMockWallet(
  page: Page,
  opts: {
    rpcUrl: string
    chainIdHex: string
    account?: string
  }
) {
  const account = opts.account ?? MOCK_ACCOUNT_ADDRESS

  // Expose a Node-side RPC proxy function to the browser
  await page.exposeFunction('__nozkMockRpc', async (method: string, params: unknown[]) => {
    const resp = await fetch(opts.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const json = await resp.json() as { result?: unknown; error?: { message: string } }
    if (json.error) throw new Error(json.error.message)
    return json.result
  })

  await page.addInitScript(
    ({ account, chainIdHex }) => {
      const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}

      ;(window as any).ethereum = {
        isMetaMask: true,
        isConnected: () => true,
        chainId: chainIdHex,
        selectedAddress: account,

        on(event: string, fn: (...args: unknown[]) => void) {
          ;(listeners[event] ??= []).push(fn)
        },
        removeListener(event: string, fn: (...args: unknown[]) => void) {
          const arr = listeners[event]
          if (arr) {
            const idx = arr.indexOf(fn)
            if (idx >= 0) arr.splice(idx, 1)
          }
        },

        async request({ method, params }: { method: string; params?: unknown[] }) {
          switch (method) {
            case 'eth_chainId':
              return chainIdHex
            case 'eth_requestAccounts':
            case 'eth_accounts':
              return [account]
            case 'wallet_switchEthereumChain':
            case 'wallet_addEthereumChain':
              return null
            case 'wallet_getPermissions':
              return [{ parentCapability: 'eth_accounts' }]
            case 'wallet_requestPermissions':
              return [{ parentCapability: 'eth_accounts' }]
            default:
              // Proxy everything else (including personal_sign) to anvil
              return (window as any).__nozkMockRpc(method, params ?? [])
          }
        },
      }

      // Signal that the provider is ready
      window.dispatchEvent(new Event('ethereum#initialized'))
    },
    { account, chainIdHex: opts.chainIdHex }
  )
}
