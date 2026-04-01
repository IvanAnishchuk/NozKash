import { keccak256 } from 'ethereum-cryptography/keccak.js'

export const NOZK_MASTER_DERIVATION_MSG_VERSION = 'v1'

/**
 * EIP-191 message the user signs with their wallet.
 * Includes account and chain so the derived `masterSeed` is bound to that context.
 */
export function buildNozkDerivationSignMessage(
  walletAddress: string,
  chainIdHex: string
): string {
  const id = Number.parseInt(chainIdHex, 16)
  const chainLabel = Number.isFinite(id) ? String(id) : chainIdHex
  return [
    'NozkTip — derive vault secret (this device only)',
    '',
    `Version: ${NOZK_MASTER_DERIVATION_MSG_VERSION}`,
    `Account: ${walletAddress}`,
    `Chain ID: ${chainLabel}`,
    '',
    'No transaction is sent. The signature provides local entropy for deriveTokenSecrets.',
  ].join('\n')
}

function hexToBytesStrict(hex: string): Uint8Array {
  const h = hex.replace(/^0x/i, '')
  if (h.length % 2 !== 0) throw new Error('Invalid hex length')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * `keccak256` of the raw signature (typical 65-byte ECDSA) → 32 bytes as `masterSeed`.
 */
export function masterSeedFromPersonalSignSignature(sigHex: string): Uint8Array {
  const bytes = hexToBytesStrict(sigHex)
  if (bytes.length < 64) {
    throw new Error('Signature too short')
  }
  return keccak256(bytes)
}
