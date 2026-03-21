import { keccak256 } from 'ethereum-cryptography/keccak';
import { secp256k1 } from '@noble/curves/secp256k1.js';

const BN254_ORDER = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

let masterSeed: Uint8Array | null = null;

export function setMasterSeed(seed: Uint8Array) {
  masterSeed = seed;
}

export function getMasterSeed(): Uint8Array {
  if (!masterSeed) throw new Error('Master seed not initialized');
  return masterSeed;
}

// ✅ Reemplaza Buffer.from con TextEncoder (browser-safe)
const enc = new TextEncoder();

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toEthereumAddress(publicKey: Uint8Array): string {
  const pubKeyNoPrefix = publicKey.slice(1); // quita el 04
  const hash = keccak256(pubKeyNoPrefix);
  return '0x' + bytesToHex(hash.slice(-20));
}

export function deriveTokenSecrets(tokenIndex: number) {
  const seed = getMasterSeed();

  const indexBytes = new Uint8Array(32);
  new DataView(indexBytes.buffer).setUint32(28, tokenIndex, false);

  const baseMaterial = keccak256(new Uint8Array([...seed, ...indexBytes]));

  // Spend keypair
  const spendPriv = keccak256(new Uint8Array([...enc.encode('spend'), ...baseMaterial]));
  const spendPubKey = secp256k1.getPublicKey(spendPriv, false);
  const spendAddress = toEthereumAddress(spendPubKey);

  // View keypair
  const viewPriv = keccak256(new Uint8Array([...enc.encode('view'), ...baseMaterial]));
  const viewPub = secp256k1.getPublicKey(viewPriv, true);

  // Blinding factor r
  const rBytes = keccak256(new Uint8Array([...enc.encode('blind'), ...baseMaterial]));
  const r = BigInt('0x' + bytesToHex(rBytes)) % BN254_ORDER;

  return { spendPriv, spendAddress, viewPriv, viewPub, r };
}

export { hexToBytes, bytesToHex };
