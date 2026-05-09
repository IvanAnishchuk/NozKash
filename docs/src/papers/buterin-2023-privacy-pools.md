# Blockchain Privacy and Regulatory Compliance: Towards a Practical Equilibrium

## Authors
- Vitalik Buterin (Ethereum Foundation)
- Jacob Illum (Chainalysis)
- Matthias Nadler (University of Basel)
- Fabian Schar (University of Basel)
- Ameen Soleimani (Privacy Pools)

## Publication
- **Year:** 2023
- **Journal:** SSRN Electronic Journal
- **DOI:** [10.2139/ssrn.4563364](https://doi.org/10.2139/ssrn.4563364)
- **SSRN:** [https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4563364](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4563364)
- **PDF:** Also saved locally as `buterin-2023-privacy-pools.pdf`

## Abstract

In this paper we study Privacy Pools, a novel smart contract-based privacy-enhancing
protocol. We discuss the pros and cons of this protocol, and show how it could be employed
to create a separating equilibrium between honest and dishonest users. The core idea of the
proposal is to allow users to publish a zero-knowledge proof, demonstrating that their funds
(do not) originate from known (un-)lawful sources, without publicly revealing their entire
transaction graph. This is achieved by proving membership in custom association sets that
satisfy certain properties, required by regulation or social consensus. The proposal may be
a first step towards a future where people could prove regulatory compliance without having
to reveal their entire transaction history.

## Index Terms
Blockchain, Privacy, Regulation, Smart Contracts, Zero-Knowledge Proofs

## Relevance to NozKash

This paper is directly relevant to NozKash's planned compliance features. The Privacy Pools
model demonstrates how privacy-preserving eCash systems can incorporate regulatory compliance
through association sets and proof-of-innocence mechanisms, without sacrificing the core
unlinkability property that NozKash provides via BLS blind signatures.
