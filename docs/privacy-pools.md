# Privacy Pools

Privacy Pools extend Tornado Cash's design with compliance mechanisms — users can prove their funds are not from flagged sources, without revealing which specific deposit is theirs.

---

## Research Paper

> V. Buterin, J. Illum, M. Nadler, F. Schar, A. Soleimani.
> **"Blockchain Privacy and Regulatory Compliance: Towards a Practical Equilibrium."**
> September 2023.

- **SSRN:** <https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4563364>

The paper introduces the concept of **association sets** — subsets of deposits that a withdrawer can prove membership in (or exclusion from):

- **Membership proof:** "My withdrawal comes from one of these deposits" (inclusion in a set of known-good deposits)
- **Exclusion proof:** "My withdrawal does NOT come from one of these deposits" (exclusion from a set of flagged deposits)

This enables a spectrum between full privacy and full transparency. Honest users generate proofs of innocence; bad actors who cannot generate such proofs become the only ones without them, creating social/regulatory pressure.

---

## 0xbow Implementation

The production implementation of Privacy Pools on Ethereum.

- **Website:** <https://0xbow.io/>
- **Core contracts:** <https://github.com/0xbow-io/privacy-pools-core>
- **Documentation:** <https://docs.privacypools.com/>
- **Ethereum.org listing:** <https://ethereum.org/apps/privacy-pools/>

### Architecture

```
Entrypoint Contract (registry + orchestrator)
  └─ Asset-Specific Privacy Pool (one per asset: ETH, USDC, ...)
       ├─ Merkle tree of deposit commitments
       ├─ Nullifier set (double-spend prevention)
       └─ Association set verification (compliance proofs)
```

**Monorepo packages:**
- `circuits/` — Zero-knowledge circuits (Groth16)
- `contracts/` — Solidity smart contracts
- `relayer/` — Minimal relayer implementation
- `sdk/` — TypeScript toolkit

### Timeline
- April 2025 — Mainnet deployment addresses published
- May 2025 — Entrypoint contract upgrade (signed off by Ameen Soleimani)
- September 2025 — v1.1.1 release

---

## How Privacy Pools Differ from Tornado Cash

| Aspect | Tornado Cash | Privacy Pools |
|--------|-------------|---------------|
| Compliance | None — full anonymity set | Association sets + proof of innocence |
| Anonymity set | All deposits in the pool | User-chosen subset of deposits |
| Regulatory stance | Sanctioned (OFAC 2022) | Designed for compliance compatibility |
| Proof system | Groth16 zk-SNARK | Groth16 zk-SNARK |
| Denomination | Fixed (0.1, 1, 10, 100 ETH) | Fixed per asset pool |

---

## Relevance to NozKash

NozKash shares the fixed-denomination deposit/redeem model but uses blind signatures instead of zk-SNARKs, resulting in dramatically lower gas costs (~120k vs ~500k-1.5M). The Privacy Pools compliance model (association sets) is architecturally interesting for NozKash's planned compliance features — the mint could refuse to blind-sign deposits from flagged addresses, achieving a similar effect without zk proofs.
