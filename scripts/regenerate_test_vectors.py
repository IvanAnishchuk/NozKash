#!/usr/bin/env python3
"""Regenerate `test/test-vectors/token_*.json` curve + BLS fields + REDEEM_TX signing.

Matches `GhostVault`:
  - H(nullifier) = try-and-increment on keccak256(blsDomain ‖ address ‖ be32(i)) with blsDomain = 0.
  - B = r * Y, S' = sk_mint * B, S = r^{-1} * S' over BN128 G1.
  - Redemption digest: keccak256(b'Pay to: ' + 20-byte recipient), then secp256k1 sign (raw hash).

Requires: py_ecc, pycryptodome, eth-account (see project venv).
"""
from __future__ import annotations

import json
from pathlib import Path

from Crypto.Hash import keccak
from eth_account import Account
from py_ecc.bn128.bn128_curve import FQ, G2, b, curve_order, is_on_curve, multiply

ROOT = Path(__file__).resolve().parents[1]
VECTORS_DIR = ROOT / "test" / "test-vectors"

P = 21888242871839275222246405745257275088696311157297823662689037894645226208583


def _legendre(rhs: int) -> int:
    return pow(rhs, (P - 1) // 2, P)


def _mod_sqrt(rhs: int) -> int:
    return pow(rhs, (P + 1) // 4, P)


def hash_to_curve_preimage(domain32: bytes, spend_addr: str) -> tuple[int, int]:
    addr = bytes.fromhex(spend_addr.removeprefix("0x").lower())
    msg = domain32 + addr
    for i in range(65536):
        h = keccak.new(digest_bits=256)
        h.update(msg + i.to_bytes(4, "big"))
        x = int.from_bytes(h.digest(), "big") % P
        rhs = (pow(x, 3, P) + 3) % P
        if rhs == 0 or _legendre(rhs) != 1:
            continue
        y = _mod_sqrt(rhs)
        if pow(y, 2, P) == rhs:
            return x, y
    raise RuntimeError("hashToCurve: no point (impossible)")


def fq_g1(x: int, y: int):
    pt = (FQ(x), FQ(y))
    if not is_on_curve(pt, b):
        raise ValueError("G1 off curve")
    return pt


def hex64(n: int) -> str:
    return f"{n:064x}"


def regen_token(path: Path) -> None:
    j = json.loads(path.read_text())
    spend = j["SPEND_KEYPAIR"]["address"]
    x, y = hash_to_curve_preimage(bytes(32), spend)
    Y = fq_g1(x, y)

    r = int(j["BLIND_KEYPAIR"]["r"], 16) % curve_order
    if r == 0:
        raise ValueError("r == 0")
    B = multiply(Y, r)
    sk = int(j["MINT_BLS_PRIVKEY"], 16) % curve_order
    s_prime = multiply(B, sk)
    r_inv = pow(r, curve_order - 2, curve_order)
    s_un = multiply(s_prime, r_inv)

    j["Y_HASH_TO_CURVE"] = {"X": hex64(int(Y[0])), "Y": hex64(int(Y[1]))}
    j["B_BLINDED"] = {"X": hex64(int(B[0])), "Y": hex64(int(B[1]))}
    j["S_PRIME"] = {"X": hex64(int(s_prime[0])), "Y": hex64(int(s_prime[1]))}
    j["S_UNBLINDED"] = {"X": hex64(int(s_un[0])), "Y": hex64(int(s_un[1]))}

    recipient = j["REDEEM_TX"]["recipient"]
    addr20 = bytes.fromhex(recipient.removeprefix("0x").lower())
    digest = keccak.new(digest_bits=256)
    digest.update(b"Pay to: " + addr20)
    d = digest.digest()
    priv = j["SPEND_KEYPAIR"]["priv"].removeprefix("0x")
    acct = Account.from_key("0x" + priv)
    sig = Account._sign_hash(d, private_key=acct.key)
    v = sig.v + 27 if sig.v < 27 else sig.v
    j["REDEEM_TX"]["msg_hash"] = d.hex()
    j["REDEEM_TX"]["spend_signature"] = f"{sig.r:064x}{sig.s:064x}{v:02x}"
    j["REDEEM_TX"]["S_x"] = str(int(s_un[0]))
    j["REDEEM_TX"]["S_y"] = str(int(s_un[1]))

    path.write_text(json.dumps(j, indent=4) + "\n")


def main() -> None:
    for p in sorted(VECTORS_DIR.glob("token_*.json")):
        regen_token(p)
        print(p.name)


if __name__ == "__main__":
    main()
