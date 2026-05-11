/**
 * Unit tests for app/e2e/fixtures/mock-wallet.ts
 *
 * Tests:
 * - Re-exported constants (MOCK_ACCOUNT_ADDRESS, MOCK_ACCOUNT_KEY)
 * - The mock wallet request() handler switch logic (extracted for unit testing)
 * - The on/removeListener event registration logic
 * - Default account fallback behavior
 */

import { describe, expect, it } from 'vitest'
import {
  MOCK_ACCOUNT_ADDRESS,
  MOCK_ACCOUNT_KEY,
} from '../mock-wallet.ts'
import {
  DEPLOYER_ADDRESS,
  DEPLOYER_KEY,
} from '../test-constants.ts'

// ==============================================================================
// Re-exported constants
// ==============================================================================

describe('MOCK_ACCOUNT_ADDRESS re-export', () => {
  it('equals DEPLOYER_ADDRESS from test-constants', () => {
    expect(MOCK_ACCOUNT_ADDRESS).toBe(DEPLOYER_ADDRESS)
  })

  it('is the anvil account 0 address', () => {
    expect(MOCK_ACCOUNT_ADDRESS).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
  })

  it('is a valid 42-char 0x-prefixed address', () => {
    expect(MOCK_ACCOUNT_ADDRESS).toHaveLength(42)
    expect(MOCK_ACCOUNT_ADDRESS.startsWith('0x')).toBe(true)
    expect(/^0x[0-9a-fA-F]{40}$/.test(MOCK_ACCOUNT_ADDRESS)).toBe(true)
  })
})

describe('MOCK_ACCOUNT_KEY re-export', () => {
  it('equals DEPLOYER_KEY from test-constants', () => {
    expect(MOCK_ACCOUNT_KEY).toBe(DEPLOYER_KEY)
  })

  it('is the anvil account 0 private key', () => {
    expect(MOCK_ACCOUNT_KEY).toBe('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
  })

  it('is a valid 66-char 0x-prefixed private key', () => {
    expect(MOCK_ACCOUNT_KEY).toHaveLength(66)
    expect(MOCK_ACCOUNT_KEY.startsWith('0x')).toBe(true)
    expect(/^0x[0-9a-fA-F]{64}$/.test(MOCK_ACCOUNT_KEY)).toBe(true)
  })
})

// ==============================================================================
// Mock wallet request() handler logic
// The switch statement from the injected script is reproduced here to unit-test
// the branching behavior without needing a real Playwright Page instance.
// ==============================================================================

/**
 * Simulate the mock wallet's request() handler.
 * This mirrors the logic in the addInitScript callback in mock-wallet.ts.
 */
function createMockWalletRequest(account: string, chainIdHex: string) {
  return async function request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
    switch (method) {
      case 'eth_chainId':
        return chainIdHex
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [account]
      case 'wallet_switchEthereumChain':
      case 'wallet_addEthereumChain':
      case 'wallet_getPermissions':
        return [{ parentCapability: 'eth_accounts' }]
      case 'wallet_requestPermissions':
        return [{ parentCapability: 'eth_accounts' }]
      default:
        // In real usage this calls __nozkMockRpc (proxied to Anvil)
        throw new Error(`Unhandled method: ${method}`)
    }
  }
}

describe('Mock wallet request() handler', () => {
  const CHAIN_ID_HEX = '0x7a69'
  const request = createMockWalletRequest(MOCK_ACCOUNT_ADDRESS, CHAIN_ID_HEX)

  it('eth_chainId returns the configured chainIdHex', async () => {
    const result = await request({ method: 'eth_chainId' })
    expect(result).toBe(CHAIN_ID_HEX)
  })

  it('eth_accounts returns [account]', async () => {
    const result = await request({ method: 'eth_accounts' })
    expect(result).toEqual([MOCK_ACCOUNT_ADDRESS])
  })

  it('eth_requestAccounts returns [account]', async () => {
    const result = await request({ method: 'eth_requestAccounts' })
    expect(result).toEqual([MOCK_ACCOUNT_ADDRESS])
  })

  it('eth_accounts and eth_requestAccounts return identical results', async () => {
    const accounts = await request({ method: 'eth_accounts' })
    const requested = await request({ method: 'eth_requestAccounts' })
    expect(accounts).toEqual(requested)
  })

  it('wallet_switchEthereumChain returns parentCapability response', async () => {
    const result = await request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] })
    expect(result).toEqual([{ parentCapability: 'eth_accounts' }])
  })

  it('wallet_addEthereumChain returns parentCapability response', async () => {
    const result = await request({ method: 'wallet_addEthereumChain', params: [] })
    expect(result).toEqual([{ parentCapability: 'eth_accounts' }])
  })

  it('wallet_getPermissions returns parentCapability response', async () => {
    const result = await request({ method: 'wallet_getPermissions' })
    expect(result).toEqual([{ parentCapability: 'eth_accounts' }])
  })

  it('wallet_requestPermissions returns parentCapability response', async () => {
    const result = await request({ method: 'wallet_requestPermissions' })
    expect(result).toEqual([{ parentCapability: 'eth_accounts' }])
  })

  it('unknown method throws (would be proxied to anvil in real usage)', async () => {
    await expect(request({ method: 'eth_sendTransaction', params: [] })).rejects.toThrow(
      'Unhandled method: eth_sendTransaction'
    )
  })

  it('personal_sign would be proxied to anvil (throws in unit test)', async () => {
    await expect(
      request({ method: 'personal_sign', params: ['0xdeadbeef', MOCK_ACCOUNT_ADDRESS] })
    ).rejects.toThrow()
  })
})

describe('Mock wallet with custom account', () => {
  const CUSTOM_ACCOUNT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const CHAIN_ID_HEX = '0x7a69'
  const request = createMockWalletRequest(CUSTOM_ACCOUNT, CHAIN_ID_HEX)

  it('uses the custom account for eth_accounts', async () => {
    const result = await request({ method: 'eth_accounts' })
    expect(result).toEqual([CUSTOM_ACCOUNT])
  })

  it('uses the custom account for eth_requestAccounts', async () => {
    const result = await request({ method: 'eth_requestAccounts' })
    expect(result).toEqual([CUSTOM_ACCOUNT])
  })
})

describe('Mock wallet chainId variants', () => {
  it('mainnet chain ID (0x1)', async () => {
    const request = createMockWalletRequest(MOCK_ACCOUNT_ADDRESS, '0x1')
    const result = await request({ method: 'eth_chainId' })
    expect(result).toBe('0x1')
  })

  it('sepolia chain ID (0xaa36a7)', async () => {
    const request = createMockWalletRequest(MOCK_ACCOUNT_ADDRESS, '0xaa36a7')
    const result = await request({ method: 'eth_chainId' })
    expect(result).toBe('0xaa36a7')
  })

  it('anvil chain ID (0x7a69 = 31337)', async () => {
    const request = createMockWalletRequest(MOCK_ACCOUNT_ADDRESS, '0x7a69')
    const result = await request({ method: 'eth_chainId' })
    expect(result).toBe('0x7a69')
    // Verify decimal value
    expect(parseInt('0x7a69', 16)).toBe(31337)
  })
})

// ==============================================================================
// Event listener logic
// Mirrors the on/removeListener implementation from mock-wallet.ts
// ==============================================================================

describe('Mock wallet event listener management', () => {
  function createListeners() {
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}

    return {
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
      _listeners: listeners,
    }
  }

  it('on() registers a listener for an event', () => {
    const eth = createListeners()
    const fn = () => {}
    eth.on('accountsChanged', fn)
    expect(eth._listeners['accountsChanged']).toContain(fn)
  })

  it('on() supports multiple listeners for the same event', () => {
    const eth = createListeners()
    const fn1 = () => {}
    const fn2 = () => {}
    eth.on('chainChanged', fn1)
    eth.on('chainChanged', fn2)
    expect(eth._listeners['chainChanged']).toHaveLength(2)
    expect(eth._listeners['chainChanged']).toContain(fn1)
    expect(eth._listeners['chainChanged']).toContain(fn2)
  })

  it('removeListener() removes an existing listener', () => {
    const eth = createListeners()
    const fn = () => {}
    eth.on('accountsChanged', fn)
    eth.removeListener('accountsChanged', fn)
    expect(eth._listeners['accountsChanged']).not.toContain(fn)
    expect(eth._listeners['accountsChanged']).toHaveLength(0)
  })

  it('removeListener() is a no-op for non-existent event', () => {
    const eth = createListeners()
    const fn = () => {}
    // Should not throw
    expect(() => eth.removeListener('nonExistentEvent', fn)).not.toThrow()
  })

  it('removeListener() is a no-op for unregistered listener', () => {
    const eth = createListeners()
    const fn1 = () => {}
    const fn2 = () => {} // never registered
    eth.on('chainChanged', fn1)
    eth.removeListener('chainChanged', fn2) // should not affect fn1
    expect(eth._listeners['chainChanged']).toContain(fn1)
    expect(eth._listeners['chainChanged']).toHaveLength(1)
  })

  it('on() creates a new event array on first registration', () => {
    const eth = createListeners()
    const fn = () => {}
    expect(eth._listeners['connect']).toBeUndefined()
    eth.on('connect', fn)
    expect(eth._listeners['connect']).toBeDefined()
    expect(eth._listeners['connect']).toHaveLength(1)
  })

  it('multiple removeListener calls reduce the array correctly', () => {
    const eth = createListeners()
    const fn1 = () => {}
    const fn2 = () => {}
    const fn3 = () => {}
    eth.on('accountsChanged', fn1)
    eth.on('accountsChanged', fn2)
    eth.on('accountsChanged', fn3)

    eth.removeListener('accountsChanged', fn2)
    expect(eth._listeners['accountsChanged']).toHaveLength(2)
    expect(eth._listeners['accountsChanged']).toContain(fn1)
    expect(eth._listeners['accountsChanged']).not.toContain(fn2)
    expect(eth._listeners['accountsChanged']).toContain(fn3)
  })
})

// ==============================================================================
// Wallet properties
// ==============================================================================

describe('Mock wallet static properties', () => {
  it('MOCK_ACCOUNT_ADDRESS is not the zero address', () => {
    expect(MOCK_ACCOUNT_ADDRESS.toLowerCase()).not.toBe('0x0000000000000000000000000000000000000000')
  })

  it('MOCK_ACCOUNT_KEY is not the zero key', () => {
    const keyBigint = BigInt(MOCK_ACCOUNT_KEY)
    expect(keyBigint).toBeGreaterThan(0n)
  })

  it('CHAIN_ID_HEX 0x7a69 decimal is 31337 (anvil default)', () => {
    expect(parseInt('0x7a69', 16)).toBe(31337)
  })
})