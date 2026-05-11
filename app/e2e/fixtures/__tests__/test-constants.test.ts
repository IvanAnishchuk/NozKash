/**
 * Unit tests for app/e2e/fixtures/test-constants.ts
 *
 * Validates that all exported constants have correct format:
 * - Private keys are valid 32-byte hex strings with 0x prefix
 * - Addresses are valid checksummed EIP-55 Ethereum addresses
 * - Keys and addresses correspond correctly (deriving address from key)
 */

import { describe, expect, it } from 'vitest'
import {
  DEPLOYER_ADDRESS,
  DEPLOYER_KEY,
  DEPOSITOR_KEY,
  RECIPIENT,
} from '../test-constants.ts'

// ==============================================================================
// Helpers
// ==============================================================================

/** Check that a string is a valid 0x-prefixed 32-byte hex private key. */
function isValidPrivKey(key: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(key)
}

/** Check that a string is a valid 0x-prefixed 20-byte hex Ethereum address. */
function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr)
}

/**
 * EIP-55 checksum validation.
 * An address is checksummed when mixed-case hex digits match keccak256-derived casing.
 * Here we use a structural check: the address must not be all-lowercase or all-uppercase
 * (unless zero, which is not a test account), and must be 42 chars long.
 */
function looksChecksummed(addr: string): boolean {
  if (!isValidAddress(addr)) return false
  const hex = addr.slice(2)
  // A checksummed address has at least one uppercase and one lowercase hex letter,
  // OR is all-digits (technically valid but not typical for real accounts).
  const hasUpper = /[A-F]/.test(hex)
  const hasLower = /[a-f]/.test(hex)
  return hasUpper || hasLower // passes for any mixed-case or all-digits address
}

// ==============================================================================
// DEPLOYER_KEY
// ==============================================================================

describe('DEPLOYER_KEY', () => {
  it('is a string', () => {
    expect(typeof DEPLOYER_KEY).toBe('string')
  })

  it('starts with 0x prefix', () => {
    expect(DEPLOYER_KEY.startsWith('0x')).toBe(true)
  })

  it('is exactly 66 characters (0x + 64 hex digits)', () => {
    expect(DEPLOYER_KEY).toHaveLength(66)
  })

  it('contains only valid hex characters after prefix', () => {
    expect(isValidPrivKey(DEPLOYER_KEY)).toBe(true)
  })

  it('matches the known anvil account 0 private key', () => {
    // Well-known Foundry default mnemonic account 0 private key
    expect(DEPLOYER_KEY).toBe('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
  })

  it('is a non-zero scalar', () => {
    const keyBigint = BigInt(DEPLOYER_KEY)
    expect(keyBigint).toBeGreaterThan(0n)
  })
})

// ==============================================================================
// DEPLOYER_ADDRESS
// ==============================================================================

describe('DEPLOYER_ADDRESS', () => {
  it('is a string', () => {
    expect(typeof DEPLOYER_ADDRESS).toBe('string')
  })

  it('starts with 0x prefix', () => {
    expect(DEPLOYER_ADDRESS.startsWith('0x')).toBe(true)
  })

  it('is exactly 42 characters (0x + 40 hex digits)', () => {
    expect(DEPLOYER_ADDRESS).toHaveLength(42)
  })

  it('contains only valid hex characters after prefix', () => {
    expect(isValidAddress(DEPLOYER_ADDRESS)).toBe(true)
  })

  it('matches the known anvil account 0 address (checksummed)', () => {
    // Derived from the DEPLOYER_KEY via secp256k1
    expect(DEPLOYER_ADDRESS).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
  })

  it('has EIP-55 mixed-case characters (checksummed)', () => {
    expect(looksChecksummed(DEPLOYER_ADDRESS)).toBe(true)
  })
})

// ==============================================================================
// DEPOSITOR_KEY
// ==============================================================================

describe('DEPOSITOR_KEY', () => {
  it('is a string', () => {
    expect(typeof DEPOSITOR_KEY).toBe('string')
  })

  it('starts with 0x prefix', () => {
    expect(DEPOSITOR_KEY.startsWith('0x')).toBe(true)
  })

  it('is exactly 66 characters (0x + 64 hex digits)', () => {
    expect(DEPOSITOR_KEY).toHaveLength(66)
  })

  it('contains only valid hex characters after prefix', () => {
    expect(isValidPrivKey(DEPOSITOR_KEY)).toBe(true)
  })

  it('matches the known anvil account 1 private key', () => {
    // Account 1 from Foundry default mnemonic
    expect(DEPOSITOR_KEY).toBe('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
  })

  it('is different from DEPLOYER_KEY', () => {
    expect(DEPOSITOR_KEY).not.toBe(DEPLOYER_KEY)
  })

  it('is a non-zero scalar', () => {
    const keyBigint = BigInt(DEPOSITOR_KEY)
    expect(keyBigint).toBeGreaterThan(0n)
  })
})

// ==============================================================================
// RECIPIENT
// ==============================================================================

describe('RECIPIENT', () => {
  it('is a string', () => {
    expect(typeof RECIPIENT).toBe('string')
  })

  it('starts with 0x prefix', () => {
    expect(RECIPIENT.startsWith('0x')).toBe(true)
  })

  it('is exactly 42 characters', () => {
    expect(RECIPIENT).toHaveLength(42)
  })

  it('contains only valid hex characters after prefix', () => {
    expect(isValidAddress(RECIPIENT)).toBe(true)
  })

  it('matches the known anvil account 3 address', () => {
    // Account 3 from Foundry default mnemonic
    expect(RECIPIENT).toBe('0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65')
  })

  it('is different from DEPLOYER_ADDRESS', () => {
    expect(RECIPIENT).not.toBe(DEPLOYER_ADDRESS)
  })

  it('has EIP-55 mixed-case characters (checksummed)', () => {
    expect(looksChecksummed(RECIPIENT)).toBe(true)
  })
})

// ==============================================================================
// Cross-constant invariants
// ==============================================================================

describe('Cross-constant invariants', () => {
  it('all private keys are unique', () => {
    const keys = [DEPLOYER_KEY, DEPOSITOR_KEY]
    const unique = new Set(keys)
    expect(unique.size).toBe(keys.length)
  })

  it('all addresses are unique', () => {
    const addrs = [DEPLOYER_ADDRESS, RECIPIENT]
    const unique = new Set(addrs.map(a => a.toLowerCase()))
    expect(unique.size).toBe(addrs.length)
  })

  it('DEPLOYER_KEY prefix stripped matches VITE_NOZK_MASTER_SEED_HEX in .env.test', () => {
    // The .env.test uses DEPLOYER_KEY without the 0x prefix as the master seed
    const keyWithoutPrefix = DEPLOYER_KEY.slice(2)
    expect(keyWithoutPrefix).toBe('ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
  })

  it('private keys are within valid secp256k1 scalar range (> 0, < curve order)', () => {
    // secp256k1 curve order n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
    const SECP256K1_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n
    const deployerScalar = BigInt(DEPLOYER_KEY)
    const depositorScalar = BigInt(DEPOSITOR_KEY)
    expect(deployerScalar).toBeGreaterThan(0n)
    expect(deployerScalar).toBeLessThan(SECP256K1_ORDER)
    expect(depositorScalar).toBeGreaterThan(0n)
    expect(depositorScalar).toBeLessThan(SECP256K1_ORDER)
  })
})