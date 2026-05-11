/**
 * Unit tests for abi/nozk_vault_v2_abi.json
 *
 * Validates the ABI structure for NozkVaultV2:
 * - All expected functions are present with correct signatures
 * - Events have correct indexed parameter structure
 * - Custom errors are present
 * - Parameter types match the BLS12-381 contract interface
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'

// ==============================================================================
// Load ABI
// ==============================================================================

type AbiEntry = {
  type: string
  name?: string
  inputs?: Array<{ name: string; type: string; internalType?: string; indexed?: boolean }>
  outputs?: Array<{ name: string; type: string; internalType?: string }>
  stateMutability?: string
  anonymous?: boolean
}

let abi: AbiEntry[]

beforeAll(() => {
  const abiPath = resolve(__dirname, '..', '..', '..', '..', 'abi', 'nozk_vault_v2_abi.json')
  abi = JSON.parse(readFileSync(abiPath, 'utf-8'))
})

// ==============================================================================
// Helpers
// ==============================================================================

function findByNameAndType(name: string, type: string): AbiEntry | undefined {
  return abi.find(e => e.name === name && e.type === type)
}

function findFunction(name: string): AbiEntry | undefined {
  return findByNameAndType(name, 'function')
}

function findEvent(name: string): AbiEntry | undefined {
  return findByNameAndType(name, 'event')
}

function findError(name: string): AbiEntry | undefined {
  return findByNameAndType(name, 'error')
}

function getAllFunctionNames(): string[] {
  return abi.filter(e => e.type === 'function').map(e => e.name!)
}

function getAllEventNames(): string[] {
  return abi.filter(e => e.type === 'event').map(e => e.name!)
}

function getAllErrorNames(): string[] {
  return abi.filter(e => e.type === 'error').map(e => e.name!)
}

// ==============================================================================
// Top-level structure
// ==============================================================================

describe('ABI top-level structure', () => {
  it('is an array', () => {
    expect(Array.isArray(abi)).toBe(true)
  })

  it('is non-empty', () => {
    expect(abi.length).toBeGreaterThan(0)
  })

  it('has a constructor entry', () => {
    const ctor = abi.find(e => e.type === 'constructor')
    expect(ctor).toBeDefined()
  })

  it('has function entries', () => {
    const fns = abi.filter(e => e.type === 'function')
    expect(fns.length).toBeGreaterThan(0)
  })

  it('has event entries', () => {
    const events = abi.filter(e => e.type === 'event')
    expect(events.length).toBeGreaterThan(0)
  })

  it('has error entries', () => {
    const errors = abi.filter(e => e.type === 'error')
    expect(errors.length).toBeGreaterThan(0)
  })
})

// ==============================================================================
// Constructor
// ==============================================================================

describe('Constructor', () => {
  it('has pkMint_ input of type uint256[4] (G1 point = 4 × uint256)', () => {
    const ctor = abi.find(e => e.type === 'constructor')!
    const pkMint = ctor.inputs?.find(i => i.name === 'pkMint_')
    expect(pkMint).toBeDefined()
    expect(pkMint!.type).toBe('uint256[4]')
  })

  it('has mintAuthority_ input of type address', () => {
    const ctor = abi.find(e => e.type === 'constructor')!
    const authority = ctor.inputs?.find(i => i.name === 'mintAuthority_')
    expect(authority).toBeDefined()
    expect(authority!.type).toBe('address')
  })

  it('is nonpayable', () => {
    const ctor = abi.find(e => e.type === 'constructor')!
    expect(ctor.stateMutability).toBe('nonpayable')
  })
})

// ==============================================================================
// Core lifecycle functions
// ==============================================================================

describe('deposit() function', () => {
  it('exists in the ABI', () => {
    expect(findFunction('deposit')).toBeDefined()
  })

  it('accepts depositId of type address', () => {
    const fn = findFunction('deposit')!
    const depositId = fn.inputs?.find(i => i.name === 'depositId')
    expect(depositId?.type).toBe('address')
  })

  it('accepts blindedPointB of type uint256[8] (G2 point = 8 × uint256)', () => {
    const fn = findFunction('deposit')!
    const b = fn.inputs?.find(i => i.name === 'blindedPointB')
    expect(b?.type).toBe('uint256[8]')
  })

  it('is payable', () => {
    const fn = findFunction('deposit')!
    expect(fn.stateMutability).toBe('payable')
  })

  it('has no outputs', () => {
    const fn = findFunction('deposit')!
    expect(fn.outputs).toEqual([])
  })
})

describe('announce() function', () => {
  it('exists in the ABI', () => {
    expect(findFunction('announce')).toBeDefined()
  })

  it('accepts depositId of type address', () => {
    const fn = findFunction('announce')!
    const depositId = fn.inputs?.find(i => i.name === 'depositId')
    expect(depositId?.type).toBe('address')
  })

  it('accepts S_prime of type uint256[8] (blind signature G2 point)', () => {
    const fn = findFunction('announce')!
    const sPrime = fn.inputs?.find(i => i.name === 'S_prime')
    expect(sPrime?.type).toBe('uint256[8]')
  })

  it('is nonpayable', () => {
    const fn = findFunction('announce')!
    expect(fn.stateMutability).toBe('nonpayable')
  })
})

describe('reveal() function', () => {
  it('exists in the ABI', () => {
    expect(findFunction('reveal')).toBeDefined()
  })

  it('accepts spendPub of type uint256[4] (G1 spend pubkey = 4 × uint256)', () => {
    const fn = findFunction('reveal')!
    const spendPub = fn.inputs?.find(i => i.name === 'spendPub')
    expect(spendPub?.type).toBe('uint256[4]')
  })

  it('accepts S of type uint256[8] (unblinded signature G2 point)', () => {
    const fn = findFunction('reveal')!
    const s = fn.inputs?.find(i => i.name === 'S')
    expect(s?.type).toBe('uint256[8]')
  })

  it('is nonpayable', () => {
    const fn = findFunction('reveal')!
    expect(fn.stateMutability).toBe('nonpayable')
  })
})

describe('redeem() function', () => {
  it('exists in the ABI', () => {
    expect(findFunction('redeem')).toBeDefined()
  })

  it('accepts recipient of type address', () => {
    const fn = findFunction('redeem')!
    const recipient = fn.inputs?.find(i => i.name === 'recipient')
    expect(recipient?.type).toBe('address')
  })

  it('accepts spendSig of type uint256[8] (BLS spend signature G2 point)', () => {
    const fn = findFunction('redeem')!
    const sig = fn.inputs?.find(i => i.name === 'spendSig')
    expect(sig?.type).toBe('uint256[8]')
  })

  it('accepts nId of type bytes32 (nullifier ID)', () => {
    const fn = findFunction('redeem')!
    const nId = fn.inputs?.find(i => i.name === 'nId')
    expect(nId?.type).toBe('bytes32')
  })

  it('accepts deadline of type uint256', () => {
    const fn = findFunction('redeem')!
    const deadline = fn.inputs?.find(i => i.name === 'deadline')
    expect(deadline?.type).toBe('uint256')
  })

  it('is nonpayable', () => {
    const fn = findFunction('redeem')!
    expect(fn.stateMutability).toBe('nonpayable')
  })

  it('has exactly 4 inputs', () => {
    const fn = findFunction('redeem')!
    expect(fn.inputs).toHaveLength(4)
  })
})

describe('refund() function', () => {
  it('exists in the ABI', () => {
    expect(findFunction('refund')).toBeDefined()
  })

  it('accepts depositId of type address', () => {
    const fn = findFunction('refund')!
    const depositId = fn.inputs?.find(i => i.name === 'depositId')
    expect(depositId?.type).toBe('address')
  })

  it('is nonpayable', () => {
    const fn = findFunction('refund')!
    expect(fn.stateMutability).toBe('nonpayable')
  })
})

// ==============================================================================
// Aggregated batch functions
// ==============================================================================

describe('revealAggregated() function', () => {
  it('exists in the ABI', () => {
    expect(findFunction('revealAggregated')).toBeDefined()
  })

  it('accepts spendPubs as uint256[4][] (array of G1 points)', () => {
    const fn = findFunction('revealAggregated')!
    const spendPubs = fn.inputs?.find(i => i.name === 'spendPubs')
    expect(spendPubs?.type).toBe('uint256[4][]')
  })

  it('accepts sigma of type uint256[8] (aggregated G2 signature)', () => {
    const fn = findFunction('revealAggregated')!
    const sigma = fn.inputs?.find(i => i.name === 'sigma')
    expect(sigma?.type).toBe('uint256[8]')
  })
})

describe('redeemAggregated() function', () => {
  it('exists in the ABI', () => {
    expect(findFunction('redeemAggregated')).toBeDefined()
  })

  it('accepts recipient of type address', () => {
    const fn = findFunction('redeemAggregated')!
    const recipient = fn.inputs?.find(i => i.name === 'recipient')
    expect(recipient?.type).toBe('address')
  })

  it('accepts sigma of type uint256[8]', () => {
    const fn = findFunction('redeemAggregated')!
    const sigma = fn.inputs?.find(i => i.name === 'sigma')
    expect(sigma?.type).toBe('uint256[8]')
  })

  it('accepts nIds as bytes32[] (array of nullifier IDs)', () => {
    const fn = findFunction('redeemAggregated')!
    const nIds = fn.inputs?.find(i => i.name === 'nIds')
    expect(nIds?.type).toBe('bytes32[]')
  })

  it('accepts deadline of type uint256', () => {
    const fn = findFunction('redeemAggregated')!
    const deadline = fn.inputs?.find(i => i.name === 'deadline')
    expect(deadline?.type).toBe('uint256')
  })
})

// ==============================================================================
// View functions
// ==============================================================================

describe('DENOMINATION() view function', () => {
  it('exists in the ABI', () => {
    expect(findFunction('DENOMINATION')).toBeDefined()
  })

  it('returns a uint256', () => {
    const fn = findFunction('DENOMINATION')!
    expect(fn.outputs?.[0]?.type).toBe('uint256')
  })

  it('is a view function', () => {
    const fn = findFunction('DENOMINATION')!
    expect(fn.stateMutability).toBe('view')
  })
})

describe('nullifierId() pure function', () => {
  it('exists in the ABI', () => {
    expect(findFunction('nullifierId')).toBeDefined()
  })

  it('accepts spendPub of type uint256[4]', () => {
    const fn = findFunction('nullifierId')!
    const spendPub = fn.inputs?.find(i => i.name === 'spendPub')
    expect(spendPub?.type).toBe('uint256[4]')
  })

  it('returns bytes32 (the nullifier hash)', () => {
    const fn = findFunction('nullifierId')!
    expect(fn.outputs?.[0]?.type).toBe('bytes32')
  })

  it('is a pure function', () => {
    const fn = findFunction('nullifierId')!
    expect(fn.stateMutability).toBe('pure')
  })
})

describe('nullifierState() view function', () => {
  it('exists in the ABI', () => {
    expect(findFunction('nullifierState')).toBeDefined()
  })

  it('accepts a bytes32 key', () => {
    const fn = findFunction('nullifierState')!
    expect(fn.inputs?.[0]?.type).toBe('bytes32')
  })

  it('returns uint8 (enum NullifierState: 0=UNREVEALED, 1=REVEALED, 2=SPENT)', () => {
    const fn = findFunction('nullifierState')!
    expect(fn.outputs?.[0]?.type).toBe('uint8')
  })
})

describe('depositPending() view function', () => {
  it('exists in the ABI', () => {
    expect(findFunction('depositPending')).toBeDefined()
  })

  it('returns bool', () => {
    const fn = findFunction('depositPending')!
    expect(fn.outputs?.[0]?.type).toBe('bool')
  })
})

describe('depositFulfilled() view function', () => {
  it('exists in the ABI', () => {
    expect(findFunction('depositFulfilled')).toBeDefined()
  })

  it('returns bool', () => {
    const fn = findFunction('depositFulfilled')!
    expect(fn.outputs?.[0]?.type).toBe('bool')
  })
})

describe('redemptionMessageHash() view function', () => {
  it('exists in the ABI', () => {
    expect(findFunction('redemptionMessageHash')).toBeDefined()
  })

  it('accepts recipient (address) and deadline (uint256)', () => {
    const fn = findFunction('redemptionMessageHash')!
    const recipient = fn.inputs?.find(i => i.name === 'recipient')
    const deadline = fn.inputs?.find(i => i.name === 'deadline')
    expect(recipient?.type).toBe('address')
    expect(deadline?.type).toBe('uint256')
  })

  it('returns bytes32 (EIP-712 hash)', () => {
    const fn = findFunction('redemptionMessageHash')!
    expect(fn.outputs?.[0]?.type).toBe('bytes32')
  })
})

// ==============================================================================
// Events
// ==============================================================================

describe('DepositLocked event', () => {
  it('exists in the ABI', () => {
    expect(findEvent('DepositLocked')).toBeDefined()
  })

  it('depositId is an indexed address', () => {
    const ev = findEvent('DepositLocked')!
    const depositId = ev.inputs?.find(i => i.name === 'depositId')
    expect(depositId?.type).toBe('address')
    expect(depositId?.indexed).toBe(true)
  })

  it('B is a non-indexed uint256[8] (the blinded G2 point)', () => {
    const ev = findEvent('DepositLocked')!
    const b = ev.inputs?.find(i => i.name === 'B')
    expect(b?.type).toBe('uint256[8]')
    expect(b?.indexed).toBe(false)
  })
})

describe('MintFulfilled event', () => {
  it('exists in the ABI', () => {
    expect(findEvent('MintFulfilled')).toBeDefined()
  })

  it('depositId is an indexed address', () => {
    const ev = findEvent('MintFulfilled')!
    const depositId = ev.inputs?.find(i => i.name === 'depositId')
    expect(depositId?.indexed).toBe(true)
    expect(depositId?.type).toBe('address')
  })

  it('S_prime is non-indexed uint256[8] (blind signature G2 point)', () => {
    const ev = findEvent('MintFulfilled')!
    const sPrime = ev.inputs?.find(i => i.name === 'S_prime')
    expect(sPrime?.type).toBe('uint256[8]')
    expect(sPrime?.indexed).toBe(false)
  })
})

describe('NullifierRevealed event', () => {
  it('exists in the ABI', () => {
    expect(findEvent('NullifierRevealed')).toBeDefined()
  })

  it('nullifierId is an indexed bytes32', () => {
    const ev = findEvent('NullifierRevealed')!
    const nId = ev.inputs?.find(i => i.name === 'nullifierId')
    expect(nId?.type).toBe('bytes32')
    expect(nId?.indexed).toBe(true)
  })

  it('amount is a non-indexed uint256', () => {
    const ev = findEvent('NullifierRevealed')!
    const amount = ev.inputs?.find(i => i.name === 'amount')
    expect(amount?.type).toBe('uint256')
    expect(amount?.indexed).toBe(false)
  })
})

describe('Redeemed event', () => {
  it('exists in the ABI', () => {
    expect(findEvent('Redeemed')).toBeDefined()
  })

  it('nullifierId is an indexed bytes32', () => {
    const ev = findEvent('Redeemed')!
    const nId = ev.inputs?.find(i => i.name === 'nullifierId')
    expect(nId?.type).toBe('bytes32')
    expect(nId?.indexed).toBe(true)
  })

  it('recipient is an indexed address', () => {
    const ev = findEvent('Redeemed')!
    const recipient = ev.inputs?.find(i => i.name === 'recipient')
    expect(recipient?.type).toBe('address')
    expect(recipient?.indexed).toBe(true)
  })

  it('amount is a non-indexed uint256', () => {
    const ev = findEvent('Redeemed')!
    const amount = ev.inputs?.find(i => i.name === 'amount')
    expect(amount?.type).toBe('uint256')
    expect(amount?.indexed).toBe(false)
  })
})

describe('Refunded event', () => {
  it('exists in the ABI', () => {
    expect(findEvent('Refunded')).toBeDefined()
  })

  it('depositId is an indexed address', () => {
    const ev = findEvent('Refunded')!
    const depositId = ev.inputs?.find(i => i.name === 'depositId')
    expect(depositId?.indexed).toBe(true)
    expect(depositId?.type).toBe('address')
  })

  it('to is an indexed address (recipient of refund)', () => {
    const ev = findEvent('Refunded')!
    const to = ev.inputs?.find(i => i.name === 'to')
    expect(to?.indexed).toBe(true)
    expect(to?.type).toBe('address')
  })
})

// ==============================================================================
// Custom errors
// ==============================================================================

describe('Custom errors', () => {
  const requiredErrors = [
    'AlreadyFulfilled',
    'AlreadyRevealed',
    'AlreadySpent',
    'BatchLengthMismatch',
    'DepositIdAlreadyUsed',
    'DepositNotFound',
    'EmptyBatch',
    'EthSendFailed',
    'ExpiredSignature',
    'InvalidBLS',
    'InvalidDepositId',
    'InvalidValue',
    'NotDepositor',
    'NotMintAuthority',
    'NotRevealed',
    'NothingToRefund',
    'PairingCheckFailed',
    'PrecompileFailed',
  ]

  for (const errName of requiredErrors) {
    it(`has ${errName} error`, () => {
      expect(findError(errName)).toBeDefined()
    })
  }

  it('AlreadyRevealed replaces old AlreadySpent-only pattern', () => {
    // The V2 contract distinguishes between double-reveal and double-spend
    expect(findError('AlreadyRevealed')).toBeDefined()
    expect(findError('AlreadySpent')).toBeDefined()
  })

  it('PairingCheckFailed error exists (BLS pairing failure)', () => {
    expect(findError('PairingCheckFailed')).toBeDefined()
  })

  it('PrecompileFailed error exists (EIP-2537 precompile call failed)', () => {
    expect(findError('PrecompileFailed')).toBeDefined()
  })

  it('ExpiredSignature error exists (deadline enforcement)', () => {
    expect(findError('ExpiredSignature')).toBeDefined()
  })
})

// ==============================================================================
// Complete function coverage
// ==============================================================================

describe('All expected functions are present', () => {
  const requiredFunctions = [
    'DENOMINATION',
    'DOMAIN_SEPARATOR',
    'EIP712_DOMAIN_TYPEHASH',
    'NOZKREDEEM_TYPEHASH',
    'announce',
    'deposit',
    'depositFulfilled',
    'depositPending',
    'depositors',
    'mintAuthority',
    'nullifierId',
    'nullifierState',
    'pkMint',
    'redeem',
    'redeemAggregated',
    'redemptionMessageHash',
    'refund',
    'reveal',
    'revealAggregated',
    'revealBatch',
    'revealedAmount',
  ]

  for (const fnName of requiredFunctions) {
    it(`has function ${fnName}`, () => {
      expect(findFunction(fnName)).toBeDefined()
    })
  }
})

// ==============================================================================
// BLS12-381 type annotations
// All G2 points use uint256[8], G1 points use uint256[4]
// ==============================================================================

describe('BLS12-381 point type consistency', () => {
  it('G2 type uint256[8] is used for: deposit B, announce S_prime, reveal S, redeem spendSig', () => {
    const g2Functions = [
      { fn: 'deposit', param: 'blindedPointB' },
      { fn: 'announce', param: 'S_prime' },
      { fn: 'reveal', param: 'S' },
      { fn: 'redeem', param: 'spendSig' },
    ]

    for (const { fn, param } of g2Functions) {
      const abiEntry = findFunction(fn)!
      const input = abiEntry.inputs?.find(i => i.name === param)
      expect(input?.type, `${fn}.${param} should be uint256[8]`).toBe('uint256[8]')
    }
  })

  it('G1 type uint256[4] is used for: reveal spendPub, nullifierId spendPub', () => {
    const g1Functions = [
      { fn: 'reveal', param: 'spendPub' },
      { fn: 'nullifierId', param: 'spendPub' },
    ]

    for (const { fn, param } of g1Functions) {
      const abiEntry = findFunction(fn)!
      const input = abiEntry.inputs?.find(i => i.name === param)
      expect(input?.type, `${fn}.${param} should be uint256[4]`).toBe('uint256[4]')
    }
  })

  it('nullifier IDs use bytes32 type (not address)', () => {
    const nIdInput = findFunction('redeem')!.inputs?.find(i => i.name === 'nId')
    expect(nIdInput?.type).toBe('bytes32')
    // Ensure it's NOT an address (previous version used address for nullifier)
    expect(nIdInput?.type).not.toBe('address')
  })

  it('NullifierRevealed event uses bytes32 for nullifierId (not address)', () => {
    const ev = findEvent('NullifierRevealed')!
    const nId = ev.inputs?.find(i => i.name === 'nullifierId')
    expect(nId?.type).toBe('bytes32')
    expect(nId?.type).not.toBe('address')
  })
})