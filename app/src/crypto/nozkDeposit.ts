import { keccak256 } from 'ethereum-cryptography/keccak.js'
import { initBN254, formatG1ForSolidity } from '@nozk/bn254-crypto'
import { isNozkVaultDebugEnabled } from '../lib/nozkDebug'
import {
  blindToken,
  deriveTokenSecrets,
  getDepositId,
  getR,
  getSpendAddressBytes,
  type TokenSecrets,
} from '@nozk/nozk-library'
import { hex0x, u256be } from './abiHelpers'

let mclInit: Promise<void> | null = null

export async function ensureNozkCrypto(): Promise<void> {
  if (!mclInit) mclInit = initBN254()
  await mclInit
}

/** Same as `deriveTokenSecrets`: index as 4-byte big-endian. */
function tokenIndexU32BE(tokenIndex: number): Uint8Array {
  const buf = new ArrayBuffer(4)
  new DataView(buf).setUint32(0, tokenIndex, false)
  return new Uint8Array(buf)
}

export function evmSelector4(signature: string): `0x${string}` {
  const h = keccak256(new TextEncoder().encode(signature)).subarray(0, 4)
  return hex0x(h) as `0x${string}`
}

/** Same function signature as `NozkVault.deposit` in Solidity (verified with Python). */
const DEPOSIT_ABI_SIG = 'deposit(address,uint256[2])' as const
const DEPOSIT_SELECTOR_BYTES = keccak256(
  new TextEncoder().encode(DEPOSIT_ABI_SIG)
).subarray(0, 4)

/** First 4 bytes of `deposit` calldata — sanity-check against the contract. */
export const NOZK_VAULT_DEPOSIT_SELECTOR_HEX = hex0x(
  DEPOSIT_SELECTOR_BYTES
) as `0x${string}`

/**
 * ABI `deposit(address,uint256[2])`: word 0 = `depositId` (address in 32 bytes),
 * words 1–2 = `blindedPointB` (uint256 BE).
 */
export function encodeNozkVaultDepositCalldata(
  depositId: string,
  bx: bigint,
  by: bigint
): `0x${string}` {
  const wx = u256be(bx)
  const wy = u256be(by)
  const addrHex = depositId.replace(/^0x/i, '')
  const addrBytes = new Uint8Array(20)
  for (let i = 0; i < 20; i++) {
    addrBytes[i] = Number.parseInt(addrHex.slice(i * 2, i * 2 + 2), 16)
  }
  const wordAddr = new Uint8Array(32)
  wordAddr.set(addrBytes, 12)

  const body = new Uint8Array(96)
  body.set(wordAddr, 0)
  body.set(wx, 32)
  body.set(wy, 64)

  const out = new Uint8Array(4 + 96)
  out.set(DEPOSIT_SELECTOR_BYTES, 0)
  out.set(body, 4)
  return (
    '0x' +
    Array.from(out)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  ) as `0x${string}`
}

/** Decodes the ABI body of `deposit(address,uint256[2])` (without the selector). */
export function parseNozkVaultDepositCalldataArgs(data: `0x${string}`): {
  blindedPointB: [string, string]
  depositId: string
} {
  const h = data.replace(/^0x/i, '')
  if (h.length < 8 + 192) {
    throw new Error('NozkVault deposit calldata too short')
  }
  const body = h.slice(8)
  const word0 = body.slice(0, 64)
  const depositId = ('0x' + word0.slice(24)).toLowerCase()
  const bx = BigInt('0x' + body.slice(64, 128)).toString(10)
  const by = BigInt('0x' + body.slice(128, 192)).toString(10)
  return { blindedPointB: [bx, by], depositId }
}

/** `depositPending(address)` — view read to debug “deposit already exists for this depositId”. */
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
 * `NozkVault.deposit(depositId, blindedPointB)` — cryptographic payload (Solidity order).
 *
 * - `depositId`: address of **`secrets.blind`** (same as `getDepositId`).
 * - `blindedPointB`: coordinates of **`B`** from
 *   `blindToken(spendAddressBytes, r)` with
 *   `spendAddressBytes` = address of **`secrets.spend`** (20 bytes),
 *   `r` = BN254 scalar from **`secrets.blind`** private material (`getR`).
 */
async function assembleNozkVaultDeposit(secrets: TokenSecrets): Promise<{
  depositId: string
  data: `0x${string}`
  r: bigint
  bxDec: string
  byDec: string
}> {
  await ensureNozkCrypto()
  const depositId = getDepositId(secrets)
  const r = getR(secrets)
  if (r === 0n) {
    throw new Error('Invalid blinding factor (r = 0); retry with another seed')
  }
  const { B } = blindToken(getSpendAddressBytes(secrets), r)
  const [xs, ys] = formatG1ForSolidity(B)
  const data = encodeNozkVaultDepositCalldata(depositId, BigInt(xs), BigInt(ys))
  if (data.length < 10) {
    throw new Error('encodeNozkVaultDepositCalldata produced empty selector')
  }
  return { depositId, data, r, bxDec: xs, byDec: ys }
}

export async function buildNozkVaultDepositFromSecrets(
  secrets: TokenSecrets
): Promise<{ depositId: string; data: `0x${string}` }> {
  const { depositId, data } = await assembleNozkVaultDeposit(secrets)
  return { depositId, data }
}

/**
 * Same as {@link buildNozkVaultDepositFromSecrets}, with
 * `secrets = deriveTokenSecrets(masterSeed, tokenIndex)`.
 * `masterSeed` must be **32 bytes** (e.g. raw EVM private key).
 */
export async function buildNozkVaultDepositCalldata(
  masterSeed: Uint8Array,
  tokenIndex: number
): Promise<{ depositId: string; data: `0x${string}` }> {
  const secrets = deriveTokenSecrets(masterSeed, tokenIndex)
  const indexBe = tokenIndexU32BE(tokenIndex)
  const baseMaterial = keccak256(
    new Uint8Array([...masterSeed, ...indexBe])
  )

  if (isNozkVaultDebugEnabled()) {
    console.log('[NozkVault deposit debug] derivation inputs + keypairs', {
      tokenIndex,
      masterSeedHex: hex0x(masterSeed),
      tokenIndexU32BE_Hex: hex0x(indexBe),
      baseMaterialHex: hex0x(baseMaterial),
      spend: {
        privHex: hex0x(secrets.spend.priv),
        pubHex: secrets.spend.pubHex,
        address: secrets.spend.address,
        addressBytesHex: hex0x(secrets.spend.addressBytes),
      },
      blind: {
        privHex: hex0x(secrets.blind.priv),
        pubHex: secrets.blind.pubHex,
        address: secrets.blind.address,
        addressBytesHex: hex0x(secrets.blind.addressBytes),
      },
    })
  }

  const { depositId, data, r, bxDec, byDec } =
    await assembleNozkVaultDeposit(secrets)

  if (isNozkVaultDebugEnabled()) {
    console.log('[NozkVault deposit debug] deposit(address,uint256[2]) payload', {
      tokenIndex,
      rDecimal: r.toString(),
      rHex: '0x' + r.toString(16),
      Bx_uint256_decimalString: bxDec,
      By_uint256_decimalString: byDec,
      depositId,
      calldata: data,
    })
  }

  return { depositId, data }
}
