import { keccak256 } from 'ethereum-cryptography/keccak.js'
import { serializeG2Sol } from '@nozk/bls12-381-crypto'
import { isNozkVaultDebugEnabled } from '../lib/nozkDebug'
import {
  blindToken,
  deriveTokenSecrets,
  getDepositId,
  getR,
  getNullifierIdHex,
  type TokenSecrets,
} from '@nozk/nozk-library'
import { hex0x, u256be } from './abiHelpers'

/**
 * No async init needed — @noble/curves is pure JS, no WASM step.
 * Kept for backward compat with callers that still `await` it.
 */
export async function ensureNozkCrypto(): Promise<void> {}

export function evmSelector4(signature: string): `0x${string}` {
  const h = keccak256(new TextEncoder().encode(signature)).subarray(0, 4)
  return hex0x(h) as `0x${string}`
}

/** V2: `deposit(address,uint256[8])` — B is now a G2 point (8 uint256). */
const DEPOSIT_ABI_SIG = 'deposit(address,uint256[8])' as const
const DEPOSIT_SELECTOR_BYTES = keccak256(
  new TextEncoder().encode(DEPOSIT_ABI_SIG)
).subarray(0, 4)

export const NOZK_VAULT_DEPOSIT_SELECTOR_HEX = hex0x(
  DEPOSIT_SELECTOR_BYTES
) as `0x${string}`

/**
 * ABI `deposit(address,uint256[8])`: word 0 = `depositId` (address in 32 bytes),
 * words 1–8 = `blindedPointB` G2 coordinates (uint256 BE).
 */
export function encodeNozkVaultDepositCalldata(
  depositId: string,
  bCoords: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
): `0x${string}` {
  const addrHex = depositId.replace(/^0x/i, '')
  const wordAddr = new Uint8Array(32)
  for (let i = 0; i < 20; i++) {
    wordAddr[12 + i] = Number.parseInt(addrHex.slice(i * 2, i * 2 + 2), 16)
  }

  // selector(4) + address(32) + 8 × uint256(32) = 292 bytes
  const out = new Uint8Array(4 + 32 + 8 * 32)
  out.set(DEPOSIT_SELECTOR_BYTES, 0)
  out.set(wordAddr, 4)
  for (let i = 0; i < 8; i++) {
    out.set(u256be(bCoords[i]), 4 + 32 + i * 32)
  }

  return ('0x' + Array.from(out).map((b) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
}

/** Decodes the ABI body of `deposit(address,uint256[8])` (without the selector). */
export function parseNozkVaultDepositCalldataArgs(data: `0x${string}`): {
  blindedPointB: bigint[]
  depositId: string
} {
  const h = data.replace(/^0x/i, '')
  const expectedLen = 8 + 64 + 512 // selector + address + 8×uint256
  const expectedSelector = NOZK_VAULT_DEPOSIT_SELECTOR_HEX.slice(2)
  if (h.length !== expectedLen) {
    throw new Error(`NozkVault deposit calldata has invalid length (expected ${expectedLen}, got ${h.length})`)
  }
  if (!h.startsWith(expectedSelector)) {
    throw new Error('NozkVault deposit calldata has invalid selector')
  }
  const body = h.slice(8)
  const word0 = body.slice(0, 64)
  const depositId = ('0x' + word0.slice(24)).toLowerCase()
  const coords: bigint[] = []
  for (let i = 0; i < 8; i++) {
    coords.push(BigInt('0x' + body.slice(64 + i * 64, 64 + (i + 1) * 64)))
  }
  return { blindedPointB: coords, depositId }
}

/** `depositPending(address)` — view read. */
export function encodeDepositPendingCalldata(depositId: string): `0x${string}` {
  const sel = keccak256(
    new TextEncoder().encode('depositPending(address)')
  ).subarray(0, 4)
  const h = depositId.replace(/^0x/i, '').toLowerCase()
  if (h.length !== 40) {
    throw new Error(`encodeDepositPendingCalldata: invalid address ${depositId}`)
  }
  const word = `${'0'.repeat(24)}${h}`
  const selHex = Array.from(sel)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return (`0x${selHex}${word}`) as `0x${string}`
}

/**
 * V2: `blindToken(spendBlsPub, r)` returns `{ B: G2Point, Y: G2Point }`.
 * We serialize B as 8 uint256 for the contract call.
 */
async function assembleNozkVaultDeposit(secrets: TokenSecrets): Promise<{
  depositId: string
  data: `0x${string}`
  r: bigint
  bCoords: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
}> {
  const depositId = getDepositId(secrets)
  const r = getR(secrets)
  if (r === 0n) {
    throw new Error('Invalid blinding factor (r = 0); retry with another seed')
  }
  const { B } = blindToken(secrets.spendBlsPub, r)
  const bCoords = serializeG2Sol(B)
  const data = encodeNozkVaultDepositCalldata(depositId, bCoords)
  return { depositId, data, r, bCoords }
}

export async function buildNozkVaultDepositFromSecrets(
  secrets: TokenSecrets
): Promise<{ depositId: string; data: `0x${string}` }> {
  const { depositId, data } = await assembleNozkVaultDeposit(secrets)
  return { depositId, data }
}

export async function buildNozkVaultDepositCalldata(
  masterSeed: Uint8Array,
  tokenIndex: number
): Promise<{ depositId: string; data: `0x${string}` }> {
  const secrets = deriveTokenSecrets(masterSeed, tokenIndex)

  if (isNozkVaultDebugEnabled()) {
    console.log('[NozkVault deposit debug] derivation inputs', {
      tokenIndex,
      depositId: getDepositId(secrets),
      nullifierIdHex: getNullifierIdHex(secrets),
    })
  }

  const { depositId, data, bCoords } =
    await assembleNozkVaultDeposit(secrets)

  if (isNozkVaultDebugEnabled()) {
    console.log('[NozkVault deposit debug] deposit(address,uint256[8]) payload', {
      tokenIndex,
      B_coords: bCoords.map((c) => '0x' + c.toString(16)),
      depositId,
      calldata: data,
    })
  }

  return { depositId, data }
}
