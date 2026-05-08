import {
  bytesToHex,
  hexToBytes,
  serializeG1Sol,
  serializeG2Sol,
  parseG2Sol,
} from '@nozk/bls12-381-crypto'
import {
  deriveTokenSecrets,
  generateRedemptionProof,
  getDepositId,
  getNullifierIdHex,
  unblindSignature,
} from '@nozk/nozk-library'
import { concatBytes, hex0x, u256be } from './abiHelpers'

const LS_KEY = 'nozk:redemption-draft-v2' as const

/**
 * V2 redemption draft — BLS12-381. No private keys stored; re-derive from seed.
 */
export type RedemptionDraftV2 = {
  v: 2
  tokenIndex: number
  depositId: string
  nullifierIdHex: string
  savedAt: number
  prepareAccount?: string
}

/** V2 reveal: `reveal(uint256[4],uint256[8])` */
const REVEAL_SELECTOR = new Uint8Array([0x4f, 0x55, 0x70, 0x25]) // 0x4f557025

/** V2 redeem: `redeem(address,uint256[8],bytes32,uint256)` */
const REDEEM_SELECTOR = new Uint8Array([0x64, 0x56, 0x7c, 0x59]) // 0x64567c59

export const NOZK_VAULT_REVEAL_SELECTOR_HEX = hex0x(REVEAL_SELECTOR) as `0x${string}`
export const NOZK_VAULT_REDEEM_SELECTOR_HEX = hex0x(REDEEM_SELECTOR) as `0x${string}`

/**
 * ABI `reveal(uint256[4], uint256[8])`:
 * - 4 uint256 = G1 spend pub (spendBlsPub)
 * - 8 uint256 = G2 unblinded mint signature (S)
 */
export function encodeNozkVaultRevealCalldata(
  spendPubG1: readonly [bigint, bigint, bigint, bigint],
  sG2: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
): `0x${string}` {
  const body = new Uint8Array(4 * 32 + 8 * 32) // 384 bytes
  for (let i = 0; i < 4; i++) body.set(u256be(spendPubG1[i]), i * 32)
  for (let i = 0; i < 8; i++) body.set(u256be(sG2[i]), 4 * 32 + i * 32)

  const full = concatBytes(REVEAL_SELECTOR, body)
  return ('0x' + Array.from(full).map((b) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
}

/**
 * ABI `redeem(address, uint256[8], bytes32, uint256)`:
 * - word 0: recipient address
 * - words 1-8: G2 BLS spend signature (8 uint256)
 * - word 9: nullifier ID (bytes32)
 * - word 10: deadline (uint256)
 */
export function encodeNozkVaultRedeemCalldata(
  recipient: string,
  spendSigG2: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
  nullifierIdHex: string,
  deadline: bigint
): `0x${string}` {
  const addrWord = new Uint8Array(32)
  const h = recipient.replace(/^0x/i, '').toLowerCase()
  for (let i = 0; i < 20; i++) addrWord[12 + i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16)

  const nidBytes = hexToBytes(nullifierIdHex.replace(/^0x/i, ''))
  const nidWord = new Uint8Array(32)
  nidWord.set(nidBytes, 0) // left-aligned (bytes32)

  const body = new Uint8Array(32 + 8 * 32 + 32 + 32) // 352 bytes
  body.set(addrWord, 0)
  for (let i = 0; i < 8; i++) body.set(u256be(spendSigG2[i]), 32 + i * 32)
  body.set(nidWord, 32 + 8 * 32)
  body.set(u256be(deadline), 32 + 8 * 32 + 32)

  const full = concatBytes(REDEEM_SELECTOR, body)
  return ('0x' + Array.from(full).map((b) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
}

export function buildRedemptionDraftFromSeed(
  masterSeed: Uint8Array,
  tokenIndex: number,
  prepareAccount?: string | null
): RedemptionDraftV2 {
  const secrets = deriveTokenSecrets(masterSeed, tokenIndex)
  return {
    v: 2,
    tokenIndex,
    depositId: getDepositId(secrets),
    nullifierIdHex: getNullifierIdHex(secrets),
    savedAt: Date.now(),
    ...(prepareAccount
      ? { prepareAccount: prepareAccount.toLowerCase() }
      : {}),
  }
}

/**
 * Can start a reveal+redeem flow for this row?
 */
export function canStartHomeRedeem(
  item: { type: string; tokenIndex?: number },
  draft: RedemptionDraftV2 | null
): boolean {
  if ((item.type !== 'Deposit' && item.type !== 'Revealed') || item.tokenIndex === undefined) return false
  if (!draft) return true
  if (draft.tokenIndex !== item.tokenIndex) return true
  return false
}

/**
 * Is this row ready for the relayer reveal+redeem step?
 */
export function isHomeRedeemReady(
  item: { type: string; tokenIndex?: number },
  draft: RedemptionDraftV2 | null
): boolean {
  if ((item.type !== 'Deposit' && item.type !== 'Revealed') || item.tokenIndex === undefined) return false
  if (!draft) return false
  return draft.tokenIndex === item.tokenIndex
}

export function redemptionDraftMatchesSecrets(
  draft: RedemptionDraftV2,
  masterSeed: Uint8Array
): boolean {
  try {
    const secrets = deriveTokenSecrets(masterSeed, draft.tokenIndex)
    return (
      getDepositId(secrets).toLowerCase() === draft.depositId.toLowerCase() &&
      getNullifierIdHex(secrets) === draft.nullifierIdHex.replace(/^0x/i, '')
    )
  } catch {
    return false
  }
}

export function saveRedemptionDraft(draft: RedemptionDraftV2): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(draft))
  } catch {
    /* quota / private mode */
  }
}

export function loadRedemptionDraft(): RedemptionDraftV2 | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as Partial<RedemptionDraftV2>
    if (
      o.v !== 2 ||
      typeof o.tokenIndex !== 'number' ||
      typeof o.depositId !== 'string' ||
      typeof o.nullifierIdHex !== 'string'
    ) {
      return null
    }
    return o as RedemptionDraftV2
  } catch {
    return null
  }
}

export function clearRedemptionDraft(): void {
  try {
    localStorage.removeItem(LS_KEY)
  } catch {
    /* ignore */
  }
}

export type BuildRevealCalldataInput = {
  masterSeed: Uint8Array
  tokenIndex: number
  /** MintFulfilled S' as 8 uint256 (G2 coords from event data). */
  mintFulfilledCoords: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
}

/**
 * Builds `reveal(uint256[4], uint256[8])` calldata.
 * Unblinds S' to S, serializes spendPub (G1) + S (G2).
 */
export function buildNozkVaultRevealCalldata(
  input: BuildRevealCalldataInput
): { data: `0x${string}`; spendPubCoords: readonly [bigint, bigint, bigint, bigint]; sCoords: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] } {
  const secrets = deriveTokenSecrets(input.masterSeed, input.tokenIndex)

  const sPrime = parseG2Sol(
    input.mintFulfilledCoords[0], input.mintFulfilledCoords[1],
    input.mintFulfilledCoords[2], input.mintFulfilledCoords[3],
    input.mintFulfilledCoords[4], input.mintFulfilledCoords[5],
    input.mintFulfilledCoords[6], input.mintFulfilledCoords[7],
  )
  const S = unblindSignature(sPrime, secrets.r)

  const spendPubCoords = serializeG1Sol(secrets.spendBlsPub)
  const sCoords = serializeG2Sol(S)

  const data = encodeNozkVaultRevealCalldata(spendPubCoords, sCoords)
  return { data, spendPubCoords, sCoords }
}

export type BuildRedeemPayload = {
  masterSeed: Uint8Array
  tokenIndex: number
  recipient: string
  chainId: number
  contractAddress: string
}

/**
 * Builds the relayer redeem payload (BLS spend signature via AugSchemeMPL).
 */
export function buildRelayerRedeemPayload(
  input: BuildRedeemPayload
): {
  recipient: string
  spendSigmaCompressedHex: string
  spendPkCompressedHex: string
  nullifierIdHex: string
  deadline: number
} {
  const secrets = deriveTokenSecrets(input.masterSeed, input.tokenIndex)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hour

  const proof = generateRedemptionProof(
    secrets.spendBlsPriv,
    secrets.spendPubCompressed,
    input.recipient,
    input.chainId,
    input.contractAddress,
    deadline,
  )

  return {
    recipient: input.recipient,
    spendSigmaCompressedHex: bytesToHex(proof.sigma),
    spendPkCompressedHex: bytesToHex(proof.spendPubCompressed),
    nullifierIdHex: getNullifierIdHex(secrets),
    deadline: Number(deadline),
  }
}
