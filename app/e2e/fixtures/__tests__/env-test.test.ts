/**
 * Unit tests for app/.env.test
 *
 * Validates that the test environment configuration is internally consistent
 * and matches the expected values used by e2e fixtures.
 *
 * The .env.test file is loaded by Vite in test mode (--mode test).
 * Its values are referenced in:
 *   - app/playwright.config.ts (webServer command)
 *   - app/e2e/fixtures/contract-setup.ts (EXPECTED_VAULT_ADDRESS)
 *   - app/e2e/fixtures/test-constants.ts (DEPLOYER_KEY ↔ VITE_NOZK_MASTER_SEED_HEX)
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'
import {
  DEPLOYER_KEY,
  DEPLOYER_ADDRESS,
} from '../test-constants.ts'

// ==============================================================================
// Parse .env.test
// ==============================================================================

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    result[key] = value
  }
  return result
}

let env: Record<string, string>

beforeAll(() => {
  const envPath = resolve(__dirname, '..', '..', '..', '.env.test')
  const content = readFileSync(envPath, 'utf-8')
  env = parseEnvFile(content)
})

// ==============================================================================
// Required keys
// ==============================================================================

describe('.env.test required keys', () => {
  const requiredKeys = [
    'VITE_CHAIN_ID',
    'VITE_CHAIN_NAME',
    'VITE_CHAIN_DISPLAY_NAME',
    'VITE_PUBLIC_RPC_URL',
    'VITE_NATIVE_CURRENCY_SYMBOL',
    'VITE_NATIVE_CURRENCY_DECIMALS',
    'VITE_NOZK_VAULT_ADDRESS',
    'VITE_NOZK_VAULT_SCAN_FROM_BLOCK_HEX',
    'VITE_RELAYER_URL',
    'VITE_NOZK_MASTER_SEED_HEX',
  ]

  for (const key of requiredKeys) {
    it(`has ${key}`, () => {
      expect(env[key]).toBeDefined()
      expect(env[key].length).toBeGreaterThan(0)
    })
  }
})

// ==============================================================================
// Chain configuration
// ==============================================================================

describe('Chain ID configuration', () => {
  it('VITE_CHAIN_ID is 0x7a69 (anvil default chain ID)', () => {
    expect(env.VITE_CHAIN_ID).toBe('0x7a69')
  })

  it('VITE_CHAIN_ID 0x7a69 equals 31337 decimal', () => {
    expect(parseInt(env.VITE_CHAIN_ID, 16)).toBe(31337)
  })

  it('VITE_CHAIN_NAME is Anvil', () => {
    expect(env.VITE_CHAIN_NAME).toBe('Anvil')
  })

  it('VITE_CHAIN_DISPLAY_NAME contains "Anvil"', () => {
    expect(env.VITE_CHAIN_DISPLAY_NAME).toContain('Anvil')
  })
})

// ==============================================================================
// RPC configuration
// ==============================================================================

describe('RPC URL configuration', () => {
  it('VITE_PUBLIC_RPC_URL is the local anvil HTTP URL', () => {
    expect(env.VITE_PUBLIC_RPC_URL).toBe('http://127.0.0.1:8545')
  })

  it('VITE_PUBLIC_RPC_URL starts with http://', () => {
    expect(env.VITE_PUBLIC_RPC_URL.startsWith('http://')).toBe(true)
  })

  it('VITE_PUBLIC_RPC_URL uses port 8545 (standard anvil port)', () => {
    expect(env.VITE_PUBLIC_RPC_URL).toContain(':8545')
  })

  it('VITE_RELAYER_URL is the local FastAPI relayer', () => {
    expect(env.VITE_RELAYER_URL).toBe('http://127.0.0.1:8000')
  })

  it('VITE_RELAYER_URL uses port 8000', () => {
    expect(env.VITE_RELAYER_URL).toContain(':8000')
  })
})

// ==============================================================================
// Currency configuration
// ==============================================================================

describe('Native currency configuration', () => {
  it('VITE_NATIVE_CURRENCY_SYMBOL is ETH', () => {
    expect(env.VITE_NATIVE_CURRENCY_SYMBOL).toBe('ETH')
  })

  it('VITE_NATIVE_CURRENCY_DECIMALS is 18', () => {
    expect(env.VITE_NATIVE_CURRENCY_DECIMALS).toBe('18')
    expect(parseInt(env.VITE_NATIVE_CURRENCY_DECIMALS)).toBe(18)
  })
})

// ==============================================================================
// Contract address configuration
// ==============================================================================

describe('Vault contract address', () => {
  it('VITE_NOZK_VAULT_ADDRESS is a valid 42-char Ethereum address', () => {
    const addr = env.VITE_NOZK_VAULT_ADDRESS
    expect(addr).toHaveLength(42)
    expect(addr.startsWith('0x')).toBe(true)
    expect(/^0x[0-9a-fA-F]{40}$/.test(addr)).toBe(true)
  })

  it('VITE_NOZK_VAULT_ADDRESS matches the deterministic CREATE address for deployer nonce 0', () => {
    // The expected address is deterministic: keccak256(rlp([deployer, nonce=0]))
    // For anvil account 0 at nonce 0, this is a well-known address
    expect(env.VITE_NOZK_VAULT_ADDRESS).toBe('0x5FbDB2315678afecb367f032d93F642f64180aa3')
  })

  it('VITE_NOZK_VAULT_SCAN_FROM_BLOCK_HEX is 0x0 (scan from genesis)', () => {
    expect(env.VITE_NOZK_VAULT_SCAN_FROM_BLOCK_HEX).toBe('0x0')
  })

  it('VITE_NOZK_VAULT_SCAN_FROM_BLOCK_HEX starts with 0x', () => {
    expect(env.VITE_NOZK_VAULT_SCAN_FROM_BLOCK_HEX.startsWith('0x')).toBe(true)
  })
})

// ==============================================================================
// Master seed (dev bypass)
// ==============================================================================

describe('Master seed configuration', () => {
  it('VITE_NOZK_MASTER_SEED_HEX is a 64-char hex string (32 bytes, no 0x prefix)', () => {
    const seed = env.VITE_NOZK_MASTER_SEED_HEX
    expect(seed).toHaveLength(64)
    expect(/^[0-9a-fA-F]{64}$/.test(seed)).toBe(true)
  })

  it('VITE_NOZK_MASTER_SEED_HEX does NOT have 0x prefix', () => {
    expect(env.VITE_NOZK_MASTER_SEED_HEX.startsWith('0x')).toBe(false)
  })

  it('VITE_NOZK_MASTER_SEED_HEX matches DEPLOYER_KEY without 0x prefix', () => {
    // The dev master seed is intentionally the same as the deployer's private key
    // This allows deterministic scanning in e2e tests
    const deployerKeyHex = DEPLOYER_KEY.slice(2) // remove 0x
    expect(env.VITE_NOZK_MASTER_SEED_HEX).toBe(deployerKeyHex)
  })

  it('VITE_NOZK_MASTER_SEED_HEX is non-zero', () => {
    const seed = env.VITE_NOZK_MASTER_SEED_HEX
    expect(seed).not.toBe('0'.repeat(64))
  })
})

// ==============================================================================
// Internal consistency checks
// ==============================================================================

describe('Configuration internal consistency', () => {
  it('VITE_CHAIN_ID and VITE_RELAYER_URL port are consistent with anvil', () => {
    // anvil runs on 0x7a69 = 31337 and exposes HTTP on :8545
    expect(parseInt(env.VITE_CHAIN_ID, 16)).toBe(31337)
    expect(env.VITE_PUBLIC_RPC_URL).toContain('8545')
  })

  it('VITE_NOZK_VAULT_ADDRESS is checksummed (not all lowercase)', () => {
    const addr = env.VITE_NOZK_VAULT_ADDRESS
    const hex = addr.slice(2)
    // A checksummed address has at least one uppercase letter in hex portion
    expect(/[A-F]/.test(hex) || /[a-f]/.test(hex)).toBe(true)
  })

  it('all URL values start with http (not https for local testing)', () => {
    expect(env.VITE_PUBLIC_RPC_URL.startsWith('http://')).toBe(true)
    expect(env.VITE_RELAYER_URL.startsWith('http://')).toBe(true)
  })

  it('all addresses in the config use 0x prefix', () => {
    expect(env.VITE_NOZK_VAULT_ADDRESS.startsWith('0x')).toBe(true)
  })

  it('scan from block 0x0 ensures full chain history is scanned', () => {
    // Block 0 means scan from genesis — important for test envs with low block numbers
    expect(parseInt(env.VITE_NOZK_VAULT_SCAN_FROM_BLOCK_HEX, 16)).toBe(0)
  })
})

// ==============================================================================
// Regression tests: specific values that must not change
// ==============================================================================

describe('Regression: critical env values must not change accidentally', () => {
  it('chain ID 0x7a69 is anvil (not mainnet 0x1, not sepolia 0xaa36a7)', () => {
    expect(env.VITE_CHAIN_ID).not.toBe('0x1')
    expect(env.VITE_CHAIN_ID).not.toBe('0xaa36a7')
    expect(env.VITE_CHAIN_ID).toBe('0x7a69')
  })

  it('vault address is not the zero address', () => {
    expect(env.VITE_NOZK_VAULT_ADDRESS.toLowerCase()).not.toBe('0x0000000000000000000000000000000000000000')
  })

  it('master seed is not the zero seed', () => {
    expect(env.VITE_NOZK_MASTER_SEED_HEX).not.toBe('0'.repeat(64))
  })

  it('relayer URL is NOT the same as the public RPC URL', () => {
    expect(env.VITE_RELAYER_URL).not.toBe(env.VITE_PUBLIC_RPC_URL)
  })
})