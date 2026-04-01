/** Shared ABI encoding helpers for NozkVault deposit/redeem calldata. */

export function u256be(n: bigint): Uint8Array {
  const out = new Uint8Array(32)
  let x = n
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn)
    x >>= 8n
  }
  return out
}

export function hex0x(bytes: Uint8Array): `0x${string}` {
  return (
    '0x' +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  ) as `0x${string}`
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function encodeAddressWord(addr: string): Uint8Array {
  const word = new Uint8Array(32)
  const h = addr.replace(/^0x/i, '').toLowerCase()
  if (h.length !== 40) throw new Error(`Invalid address: ${addr}`)
  for (let i = 0; i < 20; i++) {
    word[12 + i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16)
  }
  return word
}
