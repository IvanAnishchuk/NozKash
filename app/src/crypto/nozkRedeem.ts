import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak256 } from 'ethereum-cryptography/keccak'
import mcl from 'mcl-wasm'
import {
  CURVE_ORDER,
  padHex64,
  formatG1ForSolidity,
} from '@nozk/bn254-crypto'
import { ensureNozkCrypto } from './nozkDeposit'
import {
  deriveTokenSecrets,
  generateRedemptionProof,
  getDepositId,
  getSpendAddress,
  unblindSignature,
  type RedemptionProof,
} from '@nozk/nozk-library'

const LS_KEY = 'nozk:redemption-draft-v1' as const

/**
 * Local draft for redeem step 2 (e.g. another wallet account).
 * - `spendPrivHex` + `spendAddress`: ECDSA + nullifier (do not use the blind key for that).
 * - `blindPrivHex`: scalar `r` for `unblindSignature` on S′ from `MintFulfilled`.
 */
export type RedemptionDraftV1 = {
  v: 1
  tokenIndex: number
  depositId: string
  /** Nullifier = spend pair address (must match `ecrecover` on redeem). */
  spendAddress: string
  blindPrivHex: `0x${string}`
  spendPrivHex: `0x${string}`
  savedAt: number
  /** Wallet account that saved the draft (step 1). On-chain redeem is often sent from another account. */
  prepareAccount?: string
}

function hex0x(bytes: Uint8Array): `0x${string}` {
  return (
    '0x' +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  ) as `0x${string}`
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Must match `nozk-library` / contract (nullifier = address(spend·G)). */
function addressFromSpendPriv(priv: Uint8Array): string {
  const pub = secp256k1.getPublicKey(priv, false)
  const hash = keccak256(pub.subarray(1))
  return ('0x' + bytesToHex(hash.subarray(-20))).toLowerCase()
}

function hexToBytes32(hex: string): Uint8Array {
  const h = hex.replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(h)) {
    throw new Error('Expected 32-byte hex private key')
  }
  return Uint8Array.from(h.match(/.{2}/g)!.map((b) => parseInt(b, 16)))
}

function u256be(n: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let x = n
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn)
    x >>= 8n
  }
  return out
}

function encodeAddressWord(addr: string): Uint8Array {
  const word = new Uint8Array(32)
  const h = addr.replace(/^0x/i, '').toLowerCase()
  if (h.length !== 40) throw new Error(`Invalid address: ${addr}`)
  for (let i = 0; i < 20; i++) {
    word[12 + i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16)
  }
  return word
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** First 4 bytes of `keccak256("redeem(address,bytes,address,uint256,uint256[2])")`. */
const REDEEM_SELECTOR = keccak256(
  new TextEncoder().encode('redeem(address,bytes,address,uint256,uint256[2])')
).subarray(0, 4)

export const NOZK_VAULT_REDEEM_SELECTOR_HEX = hex0x(REDEEM_SELECTOR)

/**
 * ABI `redeem(address,bytes,address,uint256,uint256[2])` — same as `NozkVault.redeem` in Solidity.
 */
export function encodeNozkVaultRedeemCalldata(
  recipient: string,
  spendSignature65: Uint8Array,
  nullifier: string,
  deadline: bigint,
  sx: bigint,
  sy: bigint
): `0x${string}` {
  if (spendSignature65.length !== 65) {
    throw new Error(`spendSignature must be 65 bytes, got ${spendSignature65.length}`)
  }

  // ABI head: 5 static words + 1 dynamic offset for bytes
  // word 0: recipient (address)
  // word 1: offset to spendSignature dynamic data (6 * 32 = 192)
  // word 2: nullifier (address)
  // word 3: deadline (uint256)
  // word 4: S[0] (uint256)
  // word 5: S[1] (uint256)
  const head = concatBytes(
    encodeAddressWord(recipient),
    u256be(192n),
    encodeAddressWord(nullifier),
    u256be(deadline),
    u256be(sx),
    u256be(sy)
  )

  const lenWord = u256be(65n)
  const sigPadded = new Uint8Array(96)
  sigPadded.set(spendSignature65, 0)

  const body = concatBytes(head, lenWord, sigPadded)
  const full = concatBytes(REDEEM_SELECTOR, body)
  return (
    '0x' +
    Array.from(full)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  ) as `0x${string}`
}

/** 65 bytes: r (32) ‖ s (32) ‖ v (1), with v = 27 or 28 (EVM `ecrecover`). */
export function packSpendSignature65(proof: RedemptionProof): Uint8Array {
  const v = proof.recoveryBit + 27
  const out = new Uint8Array(65)
  out.set(proof.signatureObj, 0)
  out[64] = v
  return out
}

function blindPrivToR(blindPriv: Uint8Array): bigint {
  let x = 0n
  for (const b of blindPriv) {
    x = (x << 8n) | BigInt(b)
  }
  return x % CURVE_ORDER
}

export function buildRedemptionDraftFromSeed(
  masterSeed: Uint8Array,
  tokenIndex: number,
  prepareAccount?: string | null
): RedemptionDraftV1 {
  const secrets = deriveTokenSecrets(masterSeed, tokenIndex)
  return {
    v: 1,
    tokenIndex,
    depositId: getDepositId(secrets),
    spendAddress: getSpendAddress(secrets),
    blindPrivHex: hex0x(secrets.blind.priv),
    spendPrivHex: hex0x(secrets.spend.priv),
    savedAt: Date.now(),
    ...(prepareAccount
      ? { prepareAccount: prepareAccount.toLowerCase() }
      : {}),
  }
}

/**
 * Home · step 1: save keys in `localStorage` for this token (account that holds the seed).
 */
export function canStartHomeRedeem(
  item: { type: string; tokenIndex?: number },
  draft: RedemptionDraftV1 | null
): boolean {
  if (item.type !== 'Deposit' || item.tokenIndex === undefined) return false
  if (!draft) return true
  if (draft.tokenIndex !== item.tokenIndex) return true
  if (!draft.prepareAccount) return true
  return false
}

/**
 * Home · step 2: send `redeem` tx (wallet signs the transaction; often a different account than step 1).
 */
export function isHomeRedeemReady(
  item: { type: string; tokenIndex?: number },
  draft: RedemptionDraftV1 | null,
  account: string | null
): boolean {
  if (item.type !== 'Deposit' || item.tokenIndex === undefined) return false
  if (!draft || !account) return false
  if (draft.tokenIndex !== item.tokenIndex) return false
  if (draft.prepareAccount) {
    return account.toLowerCase() !== draft.prepareAccount.toLowerCase()
  }
  return true
}

/** Returns whether the draft matches derivation from the current seed. */
export function redemptionDraftMatchesSecrets(
  draft: RedemptionDraftV1,
  masterSeed: Uint8Array
): boolean {
  try {
    const secrets = deriveTokenSecrets(masterSeed, draft.tokenIndex)
    return (
      getDepositId(secrets).toLowerCase() === draft.depositId.toLowerCase() &&
      getSpendAddress(secrets).toLowerCase() === draft.spendAddress.toLowerCase()
    )
  } catch {
    return false
  }
}

export function saveRedemptionDraft(draft: RedemptionDraftV1): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(draft))
  } catch {
    /* quota / private mode */
  }
}

export function loadRedemptionDraft(): RedemptionDraftV1 | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as Partial<RedemptionDraftV1>
    if (
      o.v !== 1 ||
      typeof o.tokenIndex !== 'number' ||
      typeof o.depositId !== 'string' ||
      typeof o.spendAddress !== 'string' ||
      typeof o.blindPrivHex !== 'string' ||
      typeof o.spendPrivHex !== 'string'
    ) {
      return null
    }
    if (
      o.prepareAccount != null &&
      typeof o.prepareAccount !== 'string'
    ) {
      return null
    }
    return o as RedemptionDraftV1
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

export type BuildRedeemCalldataInput = {
  draft: RedemptionDraftV1
  recipient: string
  mintFulfilled: { sx: bigint; sy: bigint }
  chainId: number
  contractAddress: string
}

/**
 * Builds `redeem` calldata: S = unblind(S′, r), ECDSA with **spend** key (nullifier).
 */
export async function buildNozkVaultRedeemCalldata(
  input: BuildRedeemCalldataInput
): Promise<`0x${string}`> {
  await ensureNozkCrypto()

  const blindPriv = hexToBytes32(input.draft.blindPrivHex)
  const spendPriv = hexToBytes32(input.draft.spendPrivHex)

  const derivedSpend = addressFromSpendPriv(spendPriv)
  if (derivedSpend !== input.draft.spendAddress.toLowerCase()) {
    throw new Error(
      'Redeem draft mismatch: spend private key does not match nullifier address'
    )
  }

  const r = blindPrivToR(blindPriv)
  if (r === 0n) {
    throw new Error('Invalid blinding factor r = 0')
  }

  const S_prime = new mcl.G1()
  S_prime.setStr(
    `1 ${padHex64(input.mintFulfilled.sx.toString(16))} ${padHex64(input.mintFulfilled.sy.toString(16))}`,
    16
  )

  const S = unblindSignature(S_prime, r)
  const [xs, ys] = formatG1ForSolidity(S)
  const sx = BigInt(xs)
  const sy = BigInt(ys)

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hour
  const proof = await generateRedemptionProof(
    spendPriv,
    input.recipient,
    input.chainId,
    input.contractAddress,
    deadline,
  )
  const spendSig65 = packSpendSignature65(proof)

  return encodeNozkVaultRedeemCalldata(
    input.recipient,
    spendSig65,
    input.draft.spendAddress,
    deadline,
    sx,
    sy
  )
}
