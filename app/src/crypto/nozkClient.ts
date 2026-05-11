import { bytesToHex, hexToBytes, type G1Point } from '@nozk/bls12-381-crypto'
import {
  deriveTokenSecrets as deriveTokenSecretsLib,
  getDepositId,
  getR,
  getNullifierIdHex,
} from '@nozk/nozk-library'

let masterSeed: Uint8Array | null = null

export function setMasterSeed(seed: Uint8Array) {
  masterSeed = seed
}

export function getMasterSeed(): Uint8Array {
  if (!masterSeed) throw new Error('Master seed not initialized')
  return masterSeed
}

export type DerivedTokenSecrets = {
  spendBlsPriv: bigint
  spendBlsPub: G1Point
  spendPubCompressed: Uint8Array
  nullifierIdHex: string
  depositId: string
  r: bigint
}

/**
 * Flat shape for wallet UI / vault helpers; crypto from `nozk-library.ts`.
 */
export function deriveTokenSecretsFromSeed(
  masterSeed: Uint8Array,
  tokenIndex: number
): DerivedTokenSecrets {
  const s = deriveTokenSecretsLib(masterSeed, tokenIndex)
  return {
    spendBlsPriv: s.spendBlsPriv,
    spendBlsPub: s.spendBlsPub,
    spendPubCompressed: s.spendPubCompressed,
    nullifierIdHex: getNullifierIdHex(s),
    depositId: getDepositId(s),
    r: getR(s),
  }
}

/** Uses global seed from `setMasterSeed`. */
export function deriveTokenSecrets(tokenIndex: number): DerivedTokenSecrets {
  return deriveTokenSecretsFromSeed(getMasterSeed(), tokenIndex)
}

export { bytesToHex, hexToBytes }
