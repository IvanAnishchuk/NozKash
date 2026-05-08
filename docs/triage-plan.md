# Forward Citation Triage Plan

How to process the ~102 forward citations in [forward-citations.md](forward-citations.md) into actionable downloads and reference updates.

---

## Process

### Phase 1: Prioritize by NozKash impact

Read each entry in `forward-citations.md` and assign one of:

| Label | Meaning | Action |
|-------|---------|--------|
| **DOWNLOAD** | Directly informs NozKash design or security | Fetch PDF/source, add to `papers/` or `standards/` |
| **REFERENCE** | Worth citing in our docs but not worth storing locally | Add URL + one-liner to the relevant reference doc |
| **SKIP** | Interesting but not actionable for NozKash | Leave in `forward-citations.md` for future review |

### Phase 2: Triage criteria

A paper earns **DOWNLOAD** if it meets ANY of these:

1. **Describes a primitive NozKash uses or plans to use** — BLS blind signatures, BLS aggregation, hash-to-curve, EIP-2537 applications, threshold blind signing
2. **Attacks or analyzes a primitive NozKash uses** — BN254/BLS12-381 security, blind signature unforgeability, deanonymization of similar systems
3. **Describes the most comparable system** — OCash, Cashu vulnerabilities, blind multisig tokens on EVM, trust-minimized mints
4. **Defines the post-quantum migration path** — lattice blind sigs (Jeudy et al.), CAPSS aggregation, Ethereum PQ roadmap, FN-DSA blinding
5. **Is a standard NozKash will need to implement** — Privacy Pass RFCs, IETF BLS updates, NIST PQ standards

A paper earns **REFERENCE** if:

6. It's a survey/SoK that positions NozKash in a taxonomy
7. It's a compliance/regulatory analysis relevant to our compliance doc
8. It's a competing system worth comparing in our docs (RAILGUN v3, Aztec, Privacy Pools)

Everything else is **SKIP** — we note its existence but don't spend bandwidth on it.

### Phase 3: Download batch

Group DOWNLOADs by source:
- **ePrint papers** — `curl https://eprint.iacr.org/YYYY/NNN.pdf`
- **arXiv papers** — `curl https://arxiv.org/pdf/NNNN.NNNNN`
- **IETF RFCs/drafts** — `curl https://www.rfc-editor.org/rfc/rfcNNNN.txt`
- **Conference papers** — use publisher PDF or author's copy

Naming convention: `author-year-short-description.pdf`

### Phase 4: Update docs

For each downloaded paper:
1. Add to `papers/README.md` in the appropriate section
2. If it changes our understanding, update the relevant reference doc (e.g., `security-research.md`, `cryptographic-primitives.md`)
3. Add to `reference-triage.md` with disposition

For REFERENCE-only entries:
1. Add URL + one-liner to the relevant reference doc
2. No local file needed

---

## Suggested Priority Order

Work through tiers in this order, stopping when time/context budget is exhausted:

### Batch 1: Threshold blind BLS (directly enables mint decentralization)
- Jarecki & Nazarian 2025 (threshold blind BLS)
- Bacho & Loss 2022 (adaptive security of threshold BLS)
- Das & Ren 2024 (standard-assumption adaptive BLS threshold)
- Karantaidou et al. 2024 (blind multisig tokens on EVM — 232K gas)

### Batch 2: Comparable systems & attacks
- Hansen et al. 2024 (OCash — most similar architecture)
- Conduition 2025 (Cashu vulnerabilities)
- Baldimtsi et al. 2024 (SoK: Privacy-Preserving Transactions)
- Chaliasos et al. 2025 (Tornado Cash cross-chain deanonymization)

### Batch 3: Post-quantum blind signatures
- Jeudy et al. 2024 (best practical lattice blind sig)
- Feneuil & Rivain 2025 (generic framework to blind Falcon/FN-DSA)
- Faller et al. 2025 (lattice threshold blind sigs)
- El Housni et al. 2023 (SoK: exotic PQ sigs for blockchain)

### Batch 4: Post-quantum aggregation & Ethereum roadmap
- Feneuil & Rivain 2025 (CAPSS: SNARK-friendly PQ sigs)
- Coratger et al. 2025 (hash-based multi-sigs for PQ Ethereum)
- pq.ethereum.org (PQ hub)
- EIP-8141 (frame transactions for signature agility)

### Batch 5: Privacy Pass RFC ecosystem
- RFC 9576, 9577, 9578 (Privacy Pass architecture + issuance)
- RFC 9474 (RSA Blind Signatures)
- RFC 9497 (OPRFs)

### Batch 6: Everything else from Tier 1-2
- Remaining blind sig security papers
- Remaining deanonymization analyses
- BN254 security estimates

---

## Tracking

After each batch, update `forward-citations.md` by adding a disposition column or moving triaged entries to `reference-triage.md`. Keep `forward-citations.md` as the single source of truth for untriaged items.
