import { bytesToHex, hexToBytes } from '@nozk/bn254-crypto'
import {
  deriveTokenSecrets as deriveTokenSecretsLib,
  getDepositId,
  getR,
  getSpendAddress,
  getSpendPriv,
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
  spendPriv: Uint8Array
  spendAddress: string
  blindPriv: Uint8Array
  blindAddress: string
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
    spendPriv: getSpendPriv(s),
    spendAddress: getSpendAddress(s),
    blindPriv: s.blind.priv,
    blindAddress: getDepositId(s),
    r: getR(s),
  }
}

/** Uses global seed from `setMasterSeed`. */
export function deriveTokenSecrets(tokenIndex: number): DerivedTokenSecrets {
  return deriveTokenSecretsFromSeed(getMasterSeed(), tokenIndex)
}

export { bytesToHex, hexToBytes }
