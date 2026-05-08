# Forward Citation Search Results

Papers, standards, and projects that **cite** documents in our collection or are independently relevant to NozKash. Compiled for future triage — not yet downloaded.

Generated: 2026-05-08

---

## Tier 1: Directly Applicable to NozKash

These papers describe systems, primitives, or analyses that NozKash could directly adopt or must account for.

### Blind BLS Signatures & Threshold Blind Signing

- Karantaidou, Renawi, Baldimtsi, Kamarinakis, Katz, Loss. **"Blind Multisignatures for Anonymous Tokens with Decentralized Issuance"** (2024) — ACM CCS 2024 — <https://eprint.iacr.org/2024/1406> — BLS-based blind multisig verified on-chain at ~232K gas; closest published academic work to NozKash's architecture.
- Karantaidou et al. **"Non-Transferable Anonymous Tokens With Decentralized Issuance by Blind Multisignatures"** (2025) — IEEE — Extended version with non-transferability; compliance-oriented.
- Jarecki, Nazarian. **"Adaptively Secure Threshold Blind BLS Signatures and Threshold Oblivious PRF"** (2025) — ASIACRYPT 2025 — <https://eprint.iacr.org/2025/483> — First adaptively secure threshold blind BLS; key primitive for decentralizing NozKash's mint.
- Lehmann, Nazarian, Ozbay. **"Stronger Security for Threshold Blind Signatures"** (2025) — EUROCRYPT 2025 — <https://link.springer.com/chapter/10.1007/978-3-031-91124-8_12> — Advances security definitions for threshold blind sigs.
- Das, Ren. **"Adaptively Secure BLS Threshold Signatures from DDH and co-CDH"** (2024) — CRYPTO 2024 — <https://eprint.iacr.org/2023/1553> — Standard-assumption adaptive security for BLS threshold.
- Bacho, Loss. **"On the Adaptive Security of the Threshold BLS Signature Scheme"** (2022) — ACM CCS 2022 — <https://eprint.iacr.org/2022/534> — First proof of adaptive security for Boldyreva's threshold BLS.
- Reichle, Reinke. **"Threshold Blind Signatures from CDH"** (2025) — ePrint 2025/1798 — <https://eprint.iacr.org/2025/1798> — Minimal-assumption threshold blind sigs.
- Tang, Jiang, Guo, Susilo, Zhu. **"Rainblind: Fully Adaptive Threshold Blind Signature Without AGM"** (2026) — ePrint 2026/740 — <https://eprint.iacr.org/2026/740> — First TBS with adaptive security without AGM.

### Anonymous eCash on Blockchain

- Hansen, Nielsen, Simkin. **"OCash: Fully Anonymous Payments between Blockchain Light Clients"** (2024) — PKC 2025 — <https://eprint.iacr.org/2024/246> — Blind-signature anonymous payments for light clients; most architecturally similar to NozKash.
- Maire, Pulval-Dady. **"Blind ECDSA from the ECDSA Assumption"** (2025) — ePrint 2025/1827 — <https://eprint.iacr.org/2025/1827> — Blind ECDSA producing standard sigs; could enable ecash on chains without pairing precompiles.

### Trust-Minimized Mints

- Dufka et al. **"Trust-minimizing BDHKE-based e-cash mint using secure hardware and distributed computation"** (2024) — ARES 2024 / ACM — <https://dl.acm.org/doi/10.1145/3664476.3670889> — Multi-party BDHKE mint with JavaCard hardware; directly addresses NozKash's trusted-mint limitation.

### Surveys & Systematization of Knowledge

- Baldimtsi, Chalkias, Madathil, Roy. **"SoK: Privacy-Preserving Transactions in Blockchains"** (2024) — ePrint 2024/1959 — <https://eprint.iacr.org/2024/1959> — Definitive SoK for positioning NozKash in the privacy taxonomy.
- Mariani, Homoliak. **"SoK: A Survey of Mixing Techniques and Mixers for Cryptocurrencies"** (2025) — arXiv 2504.20296 — <https://arxiv.org/abs/2504.20296> — Mixer/privacy pool taxonomy; classifies NozKash-style approaches.
- Herranz, Sola. **"A Gentle Introduction to Blind Signatures: From RSA to Lattice-based Cryptography"** (2025) — arXiv 2509.02189 — <https://arxiv.org/html/2509.02189v1> — Survey covering full blind signature landscape.

### EIP-2537 / BLS12-381 On-Chain

- drand project. **"Verifying the Quicknet Beacons on Ethereum"** (2025) — drand blog — First deployed use of EIP-2537 for on-chain BLS12-381 verification.
- Kasheparov. **"Will BLS12-381 Precompiles Change Everything?"** (2025) — Distributed Lab — <https://medium.com/distributed-lab/will-bls12-381-precompiles-change-everything-74336c751a9f> — Gas cost analysis BN254 vs BLS12-381 post-Pectra.

---

## Tier 2: Security Analysis & Attacks

### Blind Signature Security

- Fuchsbauer, Plouviez, Seurin. **"Blind Schnorr Signatures in the Algebraic Group Model"** (2020) — EUROCRYPT 2020 — <https://eprint.iacr.org/2019/877> — AGM+ROM security for blind Schnorr; references BLS blind sig as baseline.
- Tessaro, Zhu. **"Short Pairing-Free Blind Signatures with Exponential Security"** (2022) — EUROCRYPT 2022 — <https://eprint.iacr.org/2022/047.pdf> — First practical pairing-free concurrent blind sigs.
- Chairattana-Apirom, Tessaro, Zhu. **"Pairing-Free Blind Signatures from CDH Assumptions"** (2024) — CRYPTO 2024 — <https://eprint.iacr.org/2023/1780> — Concurrently-secure without AGM.
- Crites, Komlo, Maller, Tessaro, Zhu. **"Snowblind: Threshold Blind Signature in Pairing-Free Groups"** (2023) — CRYPTO 2023 — <https://eprint.iacr.org/2023/1228> — First threshold blind sigs without pairings.
- Brandt, Hofheinz, Kloss, Reichle. **"Tightly-Secure Blind Signatures in Pairing-Free Groups"** (2025) — ASIACRYPT 2025 — <https://eprint.iacr.org/2024/2075> — Tight security reductions.
- Hanzlik. **"A Note on the Blindness of the Scheme from ePrint 2025/397"** (2025) — ePrint 2025/425 — <https://eprint.iacr.org/2025/425.pdf> — Blindness failure in a proposed scheme; cautionary.
- ePrint 2023/491. **"On the Security of Blind Signatures in the Multi-Signer Setting"** (2023) — <https://eprint.iacr.org/2023/491> — Multi-signer unforgeability with reduction loss proportional to signer count.
- ePrint 2026/789. **"Foundations of Verifiably Encrypted (Blind) Signatures"** (2026) — <https://eprint.iacr.org/2026/789> — New VEBS primitive combining verifiable encryption with blindness.

### BLS Aggregate Signature Security

- Hohenberger, Waters, Wu. **"Pairing-Based Aggregate Signatures without Random Oracles"** (2025) — ASIACRYPT 2025 — <https://eprint.iacr.org/2025/1548> — Removes ROM from BGLS aggregation.

### Deanonymization & Privacy Attacks

- Chaliasos et al. **"Clustering Deposit and Withdrawal Activity in Tornado Cash: A Cross-Chain Analysis"** (2025) — arXiv 2510.09433 — <https://arxiv.org/abs/2510.09433> — Links $2.3B via address-reuse and FIFO heuristics.
- Ferretti et al. **"Attacking Anonymity Set in Tornado Cash via Wallet Fingerprints"** (2025) — ACM SAC '25 — Deanonymizes via wallet software fingerprints.
- Chaliasos et al. **"The Impact of Sanctions on Decentralised Privacy Tools"** (2025) — arXiv 2510.09443 — <https://arxiv.org/html/2510.09443v2> — >90% volume decline post-OFAC sanctions.
- Beres et al. **"Anonymity Analysis of the Umbra Stealth Address Scheme on Ethereum"** (2024) — ACM Web Conf. — Majority of Umbra payments deanonymizable.

### BN254 Security Level

- Guillevic. **"A Short-List of Pairing-Friendly Curves Resistant to Special TNFS at the 128-Bit Security Level"** (2020) — PKC 2020 — <https://link.springer.com/chapter/10.1007/978-3-030-45388-6_19> — Reassesses curve families post-TNFS.
- NCC Group. **"Estimating the Bit Security of Pairing-Friendly Curves"** (2022) — BLS12-381 at 117-120 bits; BN254 at ~100 bits.
- Kumar, Chand. **"Pairing-Friendly Elliptic Curves: Revisited Taxonomy, Attacks and Security Concern"** (2022) — arXiv 2212.01855 — BN256 at only 99.92 bits after TNFS.

---

## Tier 3: Privacy Protocols & Compliance

### Privacy Pools & Compliance

- Chaudhary et al. **"SeDe: Balancing Blockchain Privacy and Regulatory Compliance by Selective De-Anonymization"** (2024) — arXiv 2311.08167 — Threshold-encryption selective deanonymization alternative.
- Chaudhary et al. **"zkFi: Privacy-Preserving and Regulation Compliant Transactions"** (2025) — arXiv 2307.00521 — Multi-chain ZKP compliance middleware.
- Popov et al. **"Blockchain Privacy and Self-regulatory Compliance"** (2024) — SSRN 4787693 — Survey of privacy-preserving compliance measures.

### CBDC & Institutional eCash

- BIS Innovation Hub. **"Project Tourbillon"** (2023) — <https://www.bis.org/publ/othp80.pdf> — eCash 2.0 prototype for CBDC; blind signatures at scale.
- Chaum, Grothoff, Moser. **"How to Issue a Central Bank Digital Currency"** (2024) — arXiv 2103.00254 — GNU Taler CBDC with blind RSA.
- ePrint 2024/1746. **"Secure CBDC Offline Payments using a Secure Element"** — Pointcheval-Sanders blind sigs + anonymous credentials for offline CBDC.
- Bank of England. **"Digital pound experiment: Offline payments"** (2025) — Feasibility assessment including blind signature approaches.

### Stealth Addresses

- Wahrstatter et al. **"BaseSAP: Modular Stealth Address Protocol"** (2024) — IEEE TIFS — Formal modular protocol built on EIP-5564.
- Fan et al. **"Key derivable signature for blockchain stealth address"** (2024) — Cybersecurity (Springer) — Compact single-key-pair stealth address protocol.
- Kaur et al. **"Post-quantum stealth address protocols"** (2026) — J. Cyber Security Technology — PQ extension of stealth addresses.

### Nullifier Systems

- Gupta. **"PLUME: Unique Pseudonymity with Ethereum"** / ERC-7524 — <https://blog.aayushg.com/nullifier/> — Deterministic ECDSA nullifiers for Ethereum keys.
- HackMD/Summa. **"What's Wrong with Current Nullifier Designs"** (2023) — <https://hackmd.io/@summa/HklvJjgH2> — Critique of existing nullifier schemes.

---

## Tier 4: Post-Quantum Migration

### Quantum Threat Analysis

- Google Quantum AI et al. **"Safeguarding cryptocurrency by disclosing quantum vulnerabilities responsibly"** (2026) — <https://research.google/blog/safeguarding-cryptocurrency-by-disclosing-quantum-vulnerabilities-responsibly/> — ECDLP-256 breakable with <500K physical qubits; co-authored with Justin Drake (EF) and Dan Boneh.
- **"Q-Day Just Got Closer: Three Papers in Three Months"** (2026) — The Quantum Insider — ~20x reduction in qubit requirements vs prior estimates.
- **"Quantum Disruption: SoK of How Post-Quantum Attackers Reshape Blockchain Security"** (2024) — arXiv 2512.13333 — Systematic review of quantum attacks on blockchain crypto.
- Valsorda. **"A Cryptography Engineer's Perspective on Quantum Computing Timelines"** (2026) — Practitioner timeline analysis.

### Post-Quantum Blind Signatures

- Jeudy et al. **"Improved Lattice Blind Signatures from Recycled Entropy"** (2024) — ASIACRYPT 2025 — <https://eprint.iacr.org/2024/1289> — ~36 KB signatures, ~500ms issuance; most practical lattice blind sig.
- del Pino et al. **"Lattice-Based Blind Signatures: Short, Efficient, and Round-Optimal"** (2023) — CCS 2023 — <https://eprint.iacr.org/2023/077.pdf> — First truly practical round-optimal lattice blind sig.
- Baldimtsi, Goyal, Yadav. **"Batched & Non-interactive Blind Signatures from Lattices"** (2025) — PKC 2026 — <https://eprint.iacr.org/2025/1771> — Non-interactive with batch issuance; 308 KB sigs but <1 KB communication.
- Faller, Niot et al. **"Lattice-based Threshold Blind Signatures"** (2025) — <https://eprint.iacr.org/2025/1566> — Threshold signing in 1.5s distributed; relevant for decentralized PQ mint.
- Baldimtsi et al. **"Non-interactive Blind Signatures with Threshold Issuance"** (2026) — <https://eprint.iacr.org/2026/400> — Extends NIBS to threshold setting.
- Katsumata et al. **"CSI-Otter: Isogeny-Based Blind Signatures"** (2023) — CRYPTO 2023 — 128 B pubkey, 8 KB sig; smallest PQ blind sig.
- Hanzlik et al. **"Tanuki: Blind Signatures from Post-Quantum Group Actions"** (2025) — ASIACRYPT 2025 — <https://eprint.iacr.org/2025/1100> — 4.5 KB isogeny-based blind sigs with concurrent security.
- Feneuil, Rivain. **"Blinding Post-Quantum Hash-and-Sign Signatures"** (2025) — <https://eprint.iacr.org/2025/895> — Generic framework to blind Falcon/UOV/MAYO signatures.
- Herranz, Louiso. **"Hash-Based Blind Signatures: First Steps"** (2025) — <https://eprint.iacr.org/2025/2097> — Security from hash functions only; most conservative.
- Beullens et al. **"Lattice-Based Blind Signatures: Short, Efficient, and Round-Optimal"** (2023) — CCS 2023 — PQ blind sigs; cites Boldyreva as classical baseline.
- Lai, Persichetti. **"LEAF: Compact Code-Based Blind Signatures"** (2025) — <https://eprint.iacr.org/2025/1585> — Code-based alternative.
- **"Post-Quantum Blind Signatures from Matrix Code Equivalence"** (2025) — <https://eprint.iacr.org/2025/274> — MEBS scheme.

### Post-Quantum Aggregate Signatures

- Aardal et al. **"Aggregating Falcon Signatures with LaBRADOR"** (2024) — CRYPTO 2024 — Lattice-SNARK-based Falcon aggregation.
- Feneuil, Rivain. **"CAPSS: SNARK-Friendly Post-Quantum Signatures"** (2025) — <https://eprint.iacr.org/2025/061> — 9.5-15.5 KB sigs, sub-KB amortized; 4-6x smaller than Loquat.
- Glaser et al. **"HAPPIER: Aggregatable PQ Signatures with Risc0"** (2025) — Aggregates up to 2^16 sigs on a laptop.
- Coratger et al. **"Hash-Based Multi-Signatures for Post-Quantum Ethereum"** (2025) — <https://eprint.iacr.org/2025/055> — Directly targets Ethereum validator sig aggregation.
- del Pino et al. **"Finally! A Compact Lattice-Based Threshold Signature"** (2025) — <https://eprint.iacr.org/2025/872> — Compact threshold sigs for T<=8.
- PSE Blog. **"Post-Quantum Signature Aggregation with Falcon + LaBRADOR"** (2025) — Practical engineering perspective.

### Post-Quantum Ethereum Roadmap

- Ethereum Foundation. **pq.ethereum.org** (2026) — Official PQ hub with roadmap, specs, repos, EIPs.
- EIP-8141: Frame Transaction — Enables accounts to use any signature scheme; expected H2 2026 Hegota fork.
- **"poqeth: Efficient post-quantum signature verification on Ethereum"** (2025) — <https://eprint.iacr.org/2025/091> — On-chain PQ signature verification research.
- **"Tasklist for post-quantum ETH"** (2025) — ethresear.ch — Detailed migration task list.

### PQ Anonymous Tokens / Credentials

- Cloudflare. **"Post-quantum anonymous credentials for everyone"** (2025) — <https://blog.cloudflare.com/pq-anonymous-credentials/> — Prototype: ~7 KB tokens, sub-second ops.
- Policharla et al. **"Post-Quantum Privacy Pass via Post-Quantum Anonymous Credentials"** (2023) — <https://eprint.iacr.org/2023/414> — Foundational PQ Privacy Pass.
- Argo et al. **"Practical Post-Quantum Signatures for Privacy"** (2024) — CCS 2024 — <https://dl.acm.org/doi/10.1145/3658644.3670297> — ~700 KB anonymous credential presentations.
- IBM / Boschini et al. **"The LaZer Library"** (2024) — CCS 2024 — Open-source lattice ZK proofs for PQ privacy.
- El Housni, Music, Music. **"A Survey on Exotic Signatures for Post-quantum Blockchain"** (2023) — ACM Computing Surveys — <https://dl.acm.org/doi/10.1145/3572771> — Comprehensive PQ blind/aggregate/ring/threshold survey.

### NIST Standards Status

- **FIPS 204: ML-DSA** (2024) — No native blind/aggregate support.
- **FIPS 205: SLH-DSA** (2024) — Hash-based; no blind support; 7-50 KB sigs.
- **FIPS 206: FN-DSA (Falcon)** — Draft 2025, final ~2027 — Best NIST candidate for blinding (via Feneuil et al. framework).
- **NIST IR 8547** — U.S. PQ migration: vendors 2025-2030, full government 2035.

---

## Tier 5: Privacy Pass Ecosystem (RFC-Track)

- **RFC 9576: Privacy Pass Architecture** (2024) — <https://www.rfc-editor.org/rfc/rfc9576>
- **RFC 9577: Privacy Pass HTTP Authentication** (2024) — <https://datatracker.ietf.org/doc/rfc9577/>
- **RFC 9578: Privacy Pass Issuance Protocols** (2024) — <https://datatracker.ietf.org/doc/rfc9578/>
- **RFC 9474: RSA Blind Signatures** (2023) — <https://www.rfc-editor.org/rfc/rfc9474.html>
- **RFC 9497: OPRFs Using Prime-Order Groups** (2023) — <https://datatracker.ietf.org/doc/rfc9497/>
- Chu et al. **"On the Security of Rate-limited Privacy Pass"** (2023) — CCS 2023
- Kreuter, Lepoint et al. **"Non-interactive Anonymous Tokens with Private Metadata Bit"** (2025) — <https://eprint.iacr.org/2025/430>
- Chairattana-Apirom et al. **"Everlasting Anonymous Rate-Limited Tokens"** (2025) — ASIACRYPT 2025 — <https://eprint.iacr.org/2025/1030>
- **"Security Analysis of Privately Verifiable Privacy Pass"** (2025) — CCS 2025 — <https://eprint.iacr.org/2025/1847>
- **"Scalable Privacy Pass from Group VRFs"** (2025) — <https://eprint.iacr.org/2025/659>
- Baldimtsi et al. **"Privacy-Preserving Authentication: Theory vs. Practice"** (2025) — EUROCRYPT 2025 — <https://arxiv.org/abs/2501.07209>

---

## Tier 6: Cashu / Fedimint / Modern eCash

- Conduition. **"Vulnerabilities in the Cashu ECash Protocol"** (2025) — <https://conduition.io/code/cashu-disclosure/> — NUT-13 keyset ID collision attack.
- Cashu/Calle. **"Bringing Zero Knowledge Proofs to Cashu"** (2024) — <https://blog.cashu.space/bringing-zero-knowledge-proofs-to-cashu/> — ZK programmable spending conditions.
- Somsen. **"Blind-DH-ecash.md"** (2020) — <https://gist.github.com/RubenSomsen/be7a4760dd4596d06963d67baf140406> — BDHKE construction origin for Cashu.
- lollerfirst. **"cashu-kvac"** (2024) — <https://github.com/lollerfirst/cashu-kvac> — KVAC-based alternative to blind sigs for eCash.
- Sonnino et al. **"Coconut: Threshold Issuance Selective Disclosure Credentials"** (2019) — NDSS — <https://arxiv.org/pdf/1802.07344> — Threshold blind sig credentials with on-chain verification.
- Geometry Research. **"Optimized BLS multisignatures on EVM"** (2023) — <https://geometry.xyz/notebook/Optimized-BLS-multisignatures-on-EVM> — Gas optimization for on-chain BLS.

---

## Tier 7: Hash-to-Curve Improvements

- Koshelev. **"Some Remarks on How to Hash Faster onto Elliptic Curves"** (2021) — <https://eprint.iacr.org/2021/1082>
- Koshelev. **"Hashing to Elliptic Curves through Cipolla-Lehmer-Muller"** (2023) — <https://eprint.iacr.org/2023/390> — Journal of Cryptology 2024.
- Koshelev. **"Hashing-Friendly Elliptic Curves"** (2025) — <https://eprint.iacr.org/2025/1926>
- Koshelev. **"Simultaneously Simple Universal and Indifferentiable Hashing"** (2024) — <https://eprint.iacr.org/2024/085>

---

## Tier 8: Ethereum Privacy Roadmap

- Buterin. **"A maximally simple L1 privacy roadmap"** (April 2025) — <https://ethereum-magicians.org/t/a-maximally-simple-l1-privacy-roadmap/23459> — Nine-step roadmap: Privacy Pools, shielded balances, stealth addresses, private RPC.
- Benarroch et al. **"SoK: Programmable Privacy in Distributed Systems"** (2024) — <https://eprint.iacr.org/2024/982>
- **"A Survey on Ethereum Pseudonymity"** (2024) — Computer Networks — <https://www.sciencedirect.com/science/article/abs/pii/S1084804524001966>
- **"On Identity, Transaction, and Smart Contract Privacy: A Comprehensive Survey"** (2024) — ACM Computing Surveys — <https://dl.acm.org/doi/10.1145/3676164>
- Nansen Research. **"Aztec Network and the Role of Privacy Protocols"** (2025)

---

## Summary Statistics

| Tier | Count | Description |
|------|-------|-------------|
| 1 — Directly applicable | ~18 | Blind BLS, anonymous eCash, trust-minimized mints, SoKs |
| 2 — Security analysis | ~14 | Blind sig proofs, deanonymization attacks, BN254 security |
| 3 — Privacy & compliance | ~14 | Privacy Pools, CBDC, stealth addresses, nullifiers |
| 4 — Post-quantum | ~30 | PQ blind sigs, PQ aggregation, PQ Ethereum roadmap, PQ tokens |
| 5 — Privacy Pass RFCs | ~11 | RFC-track blind token standards |
| 6 — Modern eCash | ~6 | Cashu, Fedimint, Coconut, KVAC |
| 7 — Hash-to-curve | ~4 | Optimization papers |
| 8 — Ethereum privacy | ~5 | L1 roadmap, surveys |
| **Total** | **~102** | |
