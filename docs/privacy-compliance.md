# Privacy Compliance

Regulatory landscape and privacy-preserving compliance approaches for cryptocurrency privacy tools.

---

## Regulatory Framework

### OFAC & Tornado Cash Sanctions

The U.S. Treasury's Office of Foreign Assets Control (OFAC) sanctioned Tornado Cash on August 8, 2022, citing $7B+ in laundered funds including $455M by DPRK's Lazarus Group. This was the first time a decentralized protocol (rather than an entity) was sanctioned.

**Key legal developments:**
- **Nov 2024:** Fifth Circuit Court of Appeals ruled OFAC exceeded its authority — immutable smart contracts are not "property" under IEEPA because no person controls them
- **Mar 2025:** OFAC lifted sanctions, removing all Tornado Cash addresses from the SDN list

**Implications for privacy protocol design:** The ruling established that immutable, autonomous smart contracts may fall outside OFAC's sanctioning power, but the prosecution of individual developers (Pertsev, Semenov, Storm) continues separately.

- **Treasury press release:** <https://home.treasury.gov/news/press-releases/jy0916>
- **Fifth Circuit ruling analysis:** <https://www.mayerbrown.com/en/insights/publications/2024/12/federal-appeals-court-tosses-ofac-sanctions-on-tornado-cash-and-limits-federal-governments-ability-to-police-crypto-transactions>
- **Sanctions lifted:** <https://www.venable.com/insights/publications/2025/04/a-legal-whirlwind-settles-treasury-lifts-sanctions>
- **Impact analysis (research paper):** <https://arxiv.org/html/2510.09443v2>

### FinCEN: Mixers as Primary Money Laundering Concern

In October 2023, FinCEN invoked Section 311 of the USA PATRIOT Act to propose designating **all** CVC (convertible virtual currency) mixing transactions as a "primary money laundering concern" — the first time targeting a *class of transactions* rather than specific institutions.

The proposed rule requires covered financial institutions to record and report transactions they know or suspect involve virtual currency mixing with foreign jurisdictions.

- **NPRM (Federal Register):** <https://www.federalregister.gov/documents/2023/10/23/2023-23449/proposal-of-special-measure-regarding-convertible-virtual-currency-mixing-as-a-class-of-transactions>
- **FinCEN press release:** <https://www.fincen.gov/news/news-releases/fincen-proposes-new-regulation-enhance-transparency-convertible-virtual-currency>

### FATF Travel Rule

FATF Recommendation 16 (the "Travel Rule"), extended to virtual assets in 2019, requires VASPs to collect and transmit originator and beneficiary information for all crypto transfers.

**Implementation status (2024):**
- 99 of 151 jurisdictions have passed or are passing legislation
- Enforcement remains weak — only 17 of 65 with legislation have taken enforcement actions
- EU: EBA Travel Rule Guidelines effective December 30, 2024
- UK: Money Laundering Regulations amended, in force September 1, 2023

- **FATF 2024 Targeted Update:** <https://www.fatf-gafi.org/content/dam/fatf-gafi/recommendations/2024-Targeted-Update-VA-VASP.pdf.coredownload.inline.pdf>
- **FATF 2023 Targeted Update:** <https://www.fatf-gafi.org/en/publications/Fatfrecommendations/targeted-update-virtual-assets-vasps-2023.html>

### EU Markets in Crypto-Assets Regulation (MiCA)

MiCA establishes uniform EU rules for crypto-assets, effective in two phases:
- **June 2024:** Rules on asset-referenced tokens (ARTs) and e-money tokens (EMTs)
- **December 2024:** CASP licensing, public offering rules, Transfer of Funds Regulation (Travel Rule for crypto)

CASPs must collect and transmit identifying information for **all** crypto transfers regardless of amount. Privacy tokens are not explicitly banned but face heightened compliance burdens.

- **ESMA overview:** <https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica>
- **Practical guide:** <https://www.nortonrosefulbright.com/en/knowledge/publications/2cec201e/regulating-crypto-assets-in-europe-practical-guide-to-mica>

---

## Privacy-Preserving Compliance Approaches

### Association Sets (Privacy Pools)

The Buterin et al. model where users prove membership in (or exclusion from) subsets of deposits:
- Users choose which deposits to associate with via ZK proof
- "Proof of innocence" = exclusion proof showing funds don't come from flagged sources
- No individual transaction details revealed

See [Privacy Pools](privacy-pools.md) for full details.

- **Paper:** <https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4563364>

### Private Proofs of Innocence (RAILGUN)

RAILGUN's approach to compliance within a shielded UTXO system:
- Each transaction includes a zk-SNARK proof that UTXOs don't originate from flagged sources
- Proofs are generated client-side, verified on-chain
- Bad actors who can't generate valid proofs are isolated

See [RAILGUN](railgun.md) for full details.

- **RAILGUN PPOI docs:** <https://docs.railgun.org/wiki/assurance/private-proofs-of-innocence>

### zkKYC: KYC Without Knowing Your Customer

> P. Pauwels. **"zkKYC: A solution concept for KYC without knowing your customer, leveraging self-sovereign identity and zero-knowledge proofs."** 2021.

- **ePrint:** <https://eprint.iacr.org/2021/907>
- **Follow-up (zkKYC in DeFi):** <https://eprint.iacr.org/2022/321>

Proposes a system where:
1. A trusted **KYC Issuer** verifies the user's identity and issues a verifiable credential
2. The user stores the credential in their wallet (self-sovereign)
3. To access a regulated service, the user generates a **ZK proof** of the credential
4. The service verifies the proof without learning the user's identity
5. A designated **governing entity** (regulator/law enforcement) can request de-anonymization through a defined legal process

The KYC Issuer knows identity but not wallets; the DeFi protocol knows wallets but not identity. Neither has the complete picture.

### a16z: Privacy-Protecting Regulatory Solutions

> **"Privacy-Protecting Regulatory Solutions Using Zero-Knowledge Proofs."**
> a16z crypto, 2022.

- **Full paper (PDF):** <https://api.a16zcrypto.com/wp-content/uploads/2022/11/ZKPs-and-Regulatory-Compliant-Privacy.pdf>
- **Summary post:** <https://a16zcrypto.com/posts/article/privacy-protecting-regulatory-solutions-using-zero-knowledge-proofs-full-paper/>
- **Companion post:** <https://a16zcrypto.com/posts/article/achieving-crypto-privacy-and-regulatory-compliance/>

Uses Tornado Cash as a case study to propose several ZK-based compliance solutions. Covers:
- Selective disclosure of transaction attributes
- Deposit screening (prove source of funds is not sanctioned)
- Withdrawal limits / velocity checks
- Opt-in audit trails for institutional users

### Selective Disclosure via Zero-Knowledge Proofs

The general pattern emerging across compliance research:

```
User ←→ Identity Issuer: Full KYC (traditional, off-chain)
User → Wallet: Verifiable credential stored locally
User → Protocol: ZK proof of credential properties
                  (e.g., "I am not on OFAC SDN list"
                   or "I am a resident of a non-sanctioned jurisdiction")
Protocol: Verifies proof, never sees identity
```

- **Chainlink zkKYC explainer:** <https://chain.link/article/zero-knowledge-proof-kyc>
- **On-chain permissioning research:** <https://arxiv.org/html/2510.05807v1>

---

## Relevance to NozKash

NozKash has a natural compliance hook: **the mint**. Since the mint must blind-sign each deposit, it can:

1. **Screen depositor addresses** before signing (the deposit ID is a public Ethereum address)
2. **Refuse to sign** deposits from sanctioned/flagged addresses
3. **Rate-limit** deposits per address or per time window
4. **Require ZK proofs** of compliance (e.g., zkKYC credential) before signing

This is simpler than the zk-SNARK association set approach because the mint is already a trusted party for liveness. The mint never learns which deposit corresponds to which redemption (blind signature privacy is preserved), but it can enforce compliance at the deposit gate.

The planned compliance screening feature (see project memory) adds a pluggable address-screening step between deposit detection and blind signing — a blocklist implementation first, with room for more sophisticated approaches later.

**Key difference from trustless protocols:** NozKash's compliance is enforced by the mint (trusted for liveness anyway), not by on-chain ZK proofs. This is cheaper but centralizes the compliance decision. Threshold blind signatures (N-of-M mint committee) can distribute this trust.
