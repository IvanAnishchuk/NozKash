# Reference Triage Log

Complete list of every reference discovered by scanning our source documents, with disposition.

Legend:
- **DOWNLOADED** — in our collection
- **ADDED THIS ROUND** — downloaded during the reference-scanning pass
- **SKIPPED** — considered and rejected, with reason

---

## References from EIPs

### eip-155.md (Simple Replay Attack Protection)
| Reference | Disposition |
|-----------|------------|
| EIP-607 (Spurious Dragon hard fork) | SKIPPED — hard fork meta-EIP, no crypto content |
| chainid.network / ethereum-lists/chains | SKIPPED — registry websites, not specs |

### eip-191.md (Signed Data Standard)
| Reference | Disposition |
|-----------|------------|
| EIP-712 (Typed structured data) | DOWNLOADED (round 1) |
| go-ethereum PR #2940 (personal_sign) | SKIPPED — implementation PR, not a standard |

### eip-196.md (ecAdd/ecMul alt_bn128)
| Reference | Disposition |
|-----------|------------|
| EIP-197 (ecPairing) | DOWNLOADED (round 1) |
| libff C++ implementation | SKIPPED — library source code |
| bn Rust implementation | SKIPPED — library source code |
| py_pairing Python implementation | SKIPPED — library source code |

### eip-197.md (ecPairing alt_bn128)
| Reference | Disposition |
|-----------|------------|
| EIP-196 (ecAdd/ecMul) | DOWNLOADED (round 1) |
| libff, bn, py_pairing implementations | SKIPPED — library source code |

### eip-712.md (Typed Structured Data Hashing and Signing)
| Reference | Disposition |
|-----------|------------|
| EIP-155 (Chain ID) | DOWNLOADED (round 1) |
| EIP-191 (Signed Data Standard) | DOWNLOADED (round 1) |
| ERC-20 (Token Standard) | SKIPPED — token standard, not crypto-relevant to NozKash |
| ERC-721 (NFT Standard) | SKIPPED — NFT standard, not relevant |
| Example.sol / Example.js assets | SKIPPED — example code, not specs |

### eip-2333.md (BLS12-381 Key Generation)
| Reference | Disposition |
|-----------|------------|
| BIP-32 (HD Wallets) | DOWNLOADED (round 1) |
| BIP-39 (Mnemonic Seeds) | DOWNLOADED (round 1) |
| BIP-44 (Multi-Account HD) | DOWNLOADED (round 1) |
| RFC 5869 (HKDF) | DOWNLOADED (round 1) |
| RFC 3447 (PKCS#1 — I2OSP/OS2IP) | ADDED THIS ROUND |
| IETF BLS signature draft | DOWNLOADED (round 1) |

### eip-2334.md (BLS12-381 Account Hierarchy)
| Reference | Disposition |
|-----------|------------|
| EIP-2333 (Key Generation) | DOWNLOADED (round 1) |
| BIP-32 (HD Wallets) | DOWNLOADED (round 1) |
| BIP-43 (Purpose Field) | DOWNLOADED (round 1) |
| BIP-44 (Multi-Account) | DOWNLOADED (round 1) |
| ERC-600 (Ethereum wallet paths) | SKIPPED — obsolete predecessor to EIP-2334, minimal content |
| ERC-601 (Ethereum wallet paths) | SKIPPED — obsolete predecessor to EIP-2334, minimal content |

### eip-2335.md (BLS12-381 Keystore)
| Reference | Disposition |
|-----------|------------|
| EIP-2333 (Key Generation) | DOWNLOADED (round 1) |
| EIP-2334 (Account Hierarchy) | DOWNLOADED (round 1) |
| RFC 2898 (PBKDF2) | DOWNLOADED (round 1) |
| RFC 7914 (scrypt) | DOWNLOADED (round 1) |
| RFC 6234 (SHA-256) | DOWNLOADED (round 1) |
| RFC 3686 (AES-CTR) | DOWNLOADED (round 1) |
| RFC 4122 (UUID) | DOWNLOADED (round 1) |
| Ethereum Web3 Secret Storage Definition | SKIPPED — predecessor spec, superseded by EIP-2335 |

### eip-2494.md (Baby Jubjub Elliptic Curve)
| Reference | Disposition |
|-----------|------------|
| EIP-196/197 (alt_bn128 precompiles) | DOWNLOADED (round 1) |
| Groth16 paper (ePrint 2016/260) | DOWNLOADED (round 1) |
| RFC 7748 (Elliptic Curves for Security) | ADDED THIS ROUND |
| RFC 8032 (EdDSA) | ADDED THIS ROUND |
| Blum, Feldman, Micali — "Non-Interactive Zero-Knowledge" | SKIPPED — foundational ZK theory, not directly needed for NozKash |
| Gennaro et al. — "Pinocchio: Quadratic Span Programs" (ePrint 2013/279) | SKIPPED — SNARK construction, NozKash doesn't use SNARKs |
| Bernstein et al. — "Elligator" (ePrint 2013/325) | SKIPPED — point encoding indistinguishability, not needed |
| Bernstein et al. — "Twisted Edwards Curves" (ePrint 2008/013) | SKIPPED — Edwards form, NozKash uses Weierstrass (BN254/BLS12-381) |
| Blake, Seroussi, Smart — "Elliptic Curves in Cryptography" (book) | SKIPPED — textbook |
| Montgomery — "Speeding Pollard and EC Methods" | SKIPPED — factoring optimization, not relevant |
| SafeCurves website | SKIPPED — website, not a downloadable spec |
| barryWhiteHat/roll_up (zk-Rollup) | SKIPPED — implementation repo |
| barryWhiteHat/baby_jubjub | SKIPPED — implementation repo |
| Zcash protocol spec (Pedersen Hash section) | SKIPPED — very large spec, only Pedersen section relevant; covered in our zk-primitives.md |
| Various implementations (Python, JS, circom, Rust, Solidity, Go) | SKIPPED — library source code |

### eip-2537.md (BLS12-381 Precompiles)
| Reference | Disposition |
|-----------|------------|
| EIP-196 (alt_bn128) | DOWNLOADED (round 1) |
| field_to_curve.md asset | SKIPPED — supplementary spec bundled with EIP |
| fast_subgroup_checks.md asset | SKIPPED — supplementary spec bundled with EIP |
| test-vectors.md / bench_vectors.md assets | SKIPPED — test data |

### eip-5564.md (Stealth Addresses)
| Reference | Disposition |
|-----------|------------|
| ERC-6538 (Stealth Meta-Address Registry) | DOWNLOADED (round 1) |
| ERC-4337 (Account Abstraction) | ADDED THIS ROUND |
| ERC-3770 (Chain-specific addresses) | SKIPPED — address format convention, minimal crypto content |
| ERC-20, ERC-721 (token metadata refs) | SKIPPED — token standards, not relevant |
| RFC 2119 (Requirement keywords) | SKIPPED — boilerplate language spec |
| IERC5564Announcer.sol asset | SKIPPED — reference implementation code |

### eip-6538.md (Stealth Meta-Address Registry)
| Reference | Disposition |
|-----------|------------|
| EIP-5564 (Stealth Addresses) | DOWNLOADED (round 1) |
| EIP-712 (Typed data signing) | DOWNLOADED (round 1) |
| EIP-1271 (Contract Signature Validation) | ADDED THIS ROUND |
| ERC-3770 (Chain-specific addresses) | SKIPPED — address format, minimal content |
| RFC 2119 (Requirement keywords) | SKIPPED — boilerplate |
| IERC6538Registry.sol asset | SKIPPED — reference implementation code |

### eip-7591.md (BLS Signed Transactions)
| Reference | Disposition |
|-----------|------------|
| EIP-2718 (Typed Transaction Envelope) | ADDED THIS ROUND |

---

## References from RFCs / IETF Drafts

### rfc9380.txt (Hashing to Elliptic Curves)

**Normative:**
| Reference | Disposition |
|-----------|------------|
| RFC 7748 (Elliptic Curves for Security) | ADDED THIS ROUND |
| RFC 8017 (PKCS#1 v2.2 — I2OSP/OS2IP) | SKIPPED — supersedes RFC 3447 which we already have |

**Informative — relevant:**
| Reference | Disposition |
|-----------|------------|
| draft-irtf-cfrg-bls-signature-05 (BLS Signatures) | DOWNLOADED (round 1) |
| Boneh, Lynn, Shacham 2001 (BLS paper) | DOWNLOADED (round 1) |
| Barreto, Lynn, Scott 2002 (BLS curve construction) | SKIPPED — superseded by BN05 and BLS12-381 which we have |
| Bowe — BLS12-381 construction | SKIPPED — blog post, covered in our cryptographic-primitives.md |
| Barreto, Naehrig 2005 (BN curves) | DOWNLOADED (round 1) |
| Boneh, Franklin 2001 (IBE from Weil Pairing) | ADDED THIS ROUND |
| Fouque, Tibouchi 2012 (Hashing to BN curves) | ADDED THIS ROUND |
| Budroni, Pintore 2017 (Hash maps to G2 on BLS) | SKIPPED — G2 hashing optimization, NozKash hashes to G1 |
| Wahby, Boneh 2019 (Hash to BLS12-381) | ADDED THIS ROUND |
| Brier et al. 2010 (Indifferentiable hashing to EC) | SKIPPED — theoretical foundation for SWU, covered by RFC 9380 itself |
| FIPS 180-4 (SHA standard) | SKIPPED — NozKash uses keccak, not SHA |
| FIPS 202 (SHA-3/Keccak) | SKIPPED — keccak spec is well-known; NozKash uses eth_utils.keccak |
| RFC 5869 (HKDF) | DOWNLOADED (round 1) |
| draft-irtf-cfrg-voprf (OPRFs) | SKIPPED — structurally similar to blind sigs but different protocol |
| draft-irtf-cfrg-vrf (VRFs) | SKIPPED — VRF construction, not directly used |
| Bellare, Rogaway 1993 (Random oracles) | SKIPPED — foundational theory, not needed as source doc |
| SEC1, SEC2 (EC standards) | SKIPPED — SECG standards, secp256k1 is well-known |
| RFC 2104 (HMAC) | SKIPPED — HMAC construction, utility standard |
| RFC 7693 (BLAKE2) | SKIPPED — alternative hash, not used by NozKash |
| RFC 9106 (Argon2) | SKIPPED — memory-hard KDF, not used |
| ristretto255/decaf448 | SKIPPED — prime-order group abstraction, not used |
| Renes et al. 2016 (Complete addition formulas) | SKIPPED — EC implementation detail |

**Informative — skipped (30+ references):**
Elligator variants, PAKE protocols, sponge constructions, specialized math papers, Hessian curves, implementation tools, number theory textbooks — none directly applicable to NozKash.

### draft-irtf-cfrg-bls-signature.txt (BLS Signatures)

**Normative:**
| Reference | Disposition |
|-----------|------------|
| Zcash BLS12-381 serialization | SKIPPED — serialization format doc, covered by our EIP-2537 |

**Informative — relevant:**
| Reference | Disposition |
|-----------|------------|
| Boldyreva 2003 (Threshold/Blind Signatures from Gap-DH) | ADDED THIS ROUND — THE security proof for BLS blind sigs |
| draft-irtf-cfrg-pairing-friendly-curves | DOWNLOADED (round 1) |
| Bowe 2019 (Faster subgroup checks for BLS12-381) | SKIPPED — optimization detail, covered by EIP-2537 |
| Boneh, Lynn, Shacham 2001 (BLS paper) | DOWNLOADED (round 1) |
| Scott 2021 (Group membership tests for BLS) | SKIPPED — subgroup check optimization |
| RFC 9380 (Hash-to-curve) | DOWNLOADED (round 1) |
| RFC 5869 (HKDF) | DOWNLOADED (round 1) |
| FIPS 180-4 (SHA) | SKIPPED — NozKash uses keccak |
| Boneh, Gentry, Lynn, Shacham 2003 (Aggregate sigs) | ADDED THIS ROUND |
| Bellare, Namprempre, Neven 2007 (Unrestricted aggregate sigs) | SKIPPED — aggregate sig security variant, covered by Quan 2021 survey |
| Boneh, Drijvers, Neven 2018 (Compact multi-sigs for blockchains) | SKIPPED — multi-sig variant, covered in our security-research.md |
| Lu et al. 2006 (Sequential aggregate sigs) | SKIPPED — sequential aggregate, not applicable |
| Ristenpart, Yilek 2007 (Proofs-of-Possession) | SKIPPED — PoP defense, covered in our security-research.md |
| Guillevic, Masson, Thome 2019 (Pairing computation) | SKIPPED — pairing optimization detail |

**Skipped:**
| Reference | Disposition |
|-----------|------------|
| RFC 2119, RFC 8174 | SKIPPED — boilerplate |
| RFC 8017 (PKCS#1) | SKIPPED — RSA, only I2OSP used; we have RFC 3447 |
| An, Dodis, Rabin 2002 (Sign+encrypt) | SKIPPED — sign+encrypt, not relevant |
| Heninger et al. 2012 (Weak key detection) | SKIPPED — key quality, not applicable |

### draft-irtf-cfrg-pairing-friendly-curves.txt (Pairing-Friendly Curves)

**Relevant:**
| Reference | Disposition |
|-----------|------------|
| Barbulescu, Duquesne 2018 (Key size estimates post-TNFS) | ADDED THIS ROUND |
| Barreto, Lynn, Scott 2002 (BLS curve construction) | SKIPPED — superseded by BN05 and BLS12-381 |
| Barreto, Naehrig 2005 (BN curves) | DOWNLOADED (round 1) |
| Kim, Barbulescu 2016 (exTNFS attack) | ADDED THIS ROUND |
| Bowe — BLS12-381 construction | SKIPPED — blog post, covered in docs |
| RFC 9380 (Hash-to-curve) | DOWNLOADED (round 1) |
| Vercauteren 2009 (Optimal pairings) | SKIPPED — pairing algorithm optimization |
| Kiyomura et al. 2017 (256-bit security pairings) | SKIPPED — higher security level, beyond NozKash scope |
| NIST SP 800-57 (Key management guidance) | SKIPPED — general key management, not curve-specific |
| Beuchat et al. 2010 (BN curve pairing implementation) | SKIPPED — BN implementation detail |
| Devegili, Scott, Dahab 2007 (BN pairing implementation) | SKIPPED — BN implementation detail |
| Barreto et al. 2015 (Subgroup security) | SKIPPED — covered in our security-research.md |
| Cheon 2006 (Strong DH problem security) | SKIPPED — DH security analysis, theoretical |
| Costello, Lange, Naehrig 2009 (Faster pairings, high-degree twists) | SKIPPED — pairing optimization |
| Joux 2000 (Tripartite DH) | SKIPPED — foundational but covered by Boneh-Franklin |
| Bowe et al. 2020 (ZEXE) | SKIPPED — decentralized private computation, different approach |
| Scott, Guillevic 2019 (New pairing curve families) | SKIPPED — newer curves, beyond current scope |
| Fotiadis, Konstantinou 2018 (TNFS-resistant families) | SKIPPED — advanced curve construction |
| Fotiadis, Martindale 2019 (Optimal TNFS-secure pairings) | SKIPPED — advanced curve construction |
| RFC 5091 (IBE standard) | SKIPPED — IBE protocol, not relevant |
| SEC1 (EC crypto) | SKIPPED — general EC standard |
| libsnark | SKIPPED — SNARK library |

**Skipped (30+ references):** Library implementations (AMCL, mcl, MIRACL, PBC, RELIC, etc.), EPID/TPM/FIDO hardware attestation, specific protocol applications (DFINITY, Cloudflare, SAKKE), textbooks, MNT/KSS/BW curve constructions, Pollard/Hellman DLP algorithms, IEEE/ISO standards.

### rfc5869.txt (HKDF)

| Reference | Disposition |
|-----------|------------|
| RFC 2104 (HMAC) | SKIPPED — utility building block, well-known |
| FIPS PUB 180-3 (SHA) | SKIPPED — hash standard, NozKash uses keccak |
| Krawczyk 2010 (HKDF formal security proof) | SKIPPED — formal proof for HKDF, theoretical |
| NIST SP 800-108 (KDF guidance) | SKIPPED — general KDF guidance |
| NIST SP 800-56A (DH key establishment) | SKIPPED — DH key establishment, not relevant |
| RFC 2898 (PBKDF2) | DOWNLOADED (round 1) |

### rfc7914.txt (scrypt)

| Reference | Disposition |
|-----------|------------|
| RFC 2898 (PBKDF2) | DOWNLOADED (round 1) |
| RFC 6234 (SHA-256) | DOWNLOADED (round 1) |
| Percival 2009 (Original scrypt paper) | SKIPPED — full scrypt paper, RFC 7914 covers it |
| Provos, Mazieres 1999 (bcrypt) | SKIPPED — alternative password hash, not relevant |
| Bernstein (Salsa20 core/spec) | SKIPPED — mixing function detail |
| RFC 4086 (Randomness requirements) | SKIPPED — general randomness guidance |

---

## References from Research Papers

### boneh-lynn-shacham-2001 (Short Signatures from the Weil Pairing)
| Reference | Disposition |
|-----------|------------|
| Boneh, Franklin 2001 (IBE from Weil Pairing) | ADDED THIS ROUND |
| Coron 2000 (Exact Security of FDH) | ADDED THIS ROUND |
| Boneh, Gentry, Lynn, Shacham 2003 (Aggregate sigs) | ADDED THIS ROUND |
| Joux 2000 (Tripartite DH) | SKIPPED — foundational pairing use, covered by Boneh-Franklin |
| Frey, Muller, Ruck 1999 (Tate pairing) | SKIPPED — pairing implementation detail |
| Galbraith, Paterson, Smart 2008 (Pairings for cryptographers) | SKIPPED — survey paper, our collection covers the key results |
| Chaum, Pedersen 1992 (Wallet databases with observers) | SKIPPED — early eCash variant, covered by Chaum 1988 |
| Menezes, Okamoto, Vanstone 1993 (MOV attack) | SKIPPED — historical attack, not applicable to current curve choices |

### barreto-naehrig-2005 (Pairing-Friendly Curves of Prime Order)
| Reference | Disposition |
|-----------|------------|
| Barreto, Lynn, Scott 2002/2003/2004 (BLS curve construction, group selection, efficient implementation) | SKIPPED — predecessor work, superseded by this paper |
| Scott, Barreto 2004 (Compressed pairings) | SKIPPED — pairing compression optimization |
| Brezing, Weng 2003 (Alternative curve families) | SKIPPED — alternative constructions |
| Blake, Seroussi, Smart 2005 (Advances in EC Crypto, book) | SKIPPED — textbook |

### groth16 (Pairing-based Non-interactive Arguments)
| Reference | Disposition |
|-----------|------------|
| Ben-Sasson et al. 2014 (Zerocash) | ADDED THIS ROUND |
| Danezis et al. 2013 (Pinocchio Coin) | SKIPPED — applying SNARKs to eCash, superseded by Zerocash |
| Ben-Sasson et al. 2013 (SNARKs for C) | SKIPPED — SNARK construction, NozKash doesn't use SNARKs |
| Bunz et al. 2018 (Bulletproofs) | SKIPPED — range proof alternative, not used by NozKash |
| Ben-Sasson et al. 2014 (Recursive SNARKs) | SKIPPED — recursive proofs, future research |
| Gabizon et al. 2019 (PLONK) | SKIPPED — universal SNARK, NozKash doesn't use SNARKs |
| Chiesa et al. 2020 (Marlin) | SKIPPED — updatable SRS SNARK |
| Blum, Feldman, Micali 1988 (Non-interactive ZK) | SKIPPED — foundational ZK theory |
| Goldwasser, Micali, Rackoff 1989 (Knowledge complexity) | SKIPPED — foundational ZK theory |
| libsnark | SKIPPED — implementation |
| Schoenmakers et al. 2016 (Trinocchio) | SKIPPED — privacy-preserving computation |
| Parno et al. 2013 (Pinocchio) | SKIPPED — verifiable computation |

### chaum-fiat-naor-1988 (Untraceable Electronic Cash)
| Reference | Disposition |
|-----------|------------|
| Chaum 1985 ("Security without identification") | SKIPPED — the original blind sig eCash proposal; covered conceptually in our docs, paper is behind paywall (CACM) |
| Chaum 1988 (Privacy protected payments) | SKIPPED — extension of eCash model, Smartcard 2000 proceedings |
| Chaum, Evertse 1987 (Credentials without identification) | SKIPPED — credential transfer, not directly applicable |
| Rivest, Shamir, Adleman 1978 (RSA) | SKIPPED — RSA paper, foundational but not needed |
| Goldwasser, Micali, Rackoff 1985 (ZK complexity) | SKIPPED — foundational ZK |

### chaum-2022 (eCash 2.0)
| Reference | Disposition |
|-----------|------------|
| Chaum 1981 (Untraceable electronic mail / mix networks) | SKIPPED — mix networks, different privacy approach |
| Chaum 1985 (Security without identification) | SKIPPED — see above |
| Chaum (forthcoming, Offline eCash 2.0) | SKIPPED — not yet published |

### tornado-cash-whitepaper-2019
| Reference | Disposition |
|-----------|------------|
| Groth16 paper | DOWNLOADED (round 1) |
| Albrecht et al. 2016 (MiMC hash) | SKIPPED — SNARK-friendly hash, NozKash doesn't use SNARKs |
| iden3 — Pedersen Hash (2019) | SKIPPED — Pedersen hash implementation, covered in zk-primitives.md |

### poseidon-hash-2019
| Reference | Disposition |
|-----------|------------|
| Groth16 | DOWNLOADED (round 1) |
| Gabizon et al. 2019 (PLONK) | SKIPPED — universal SNARK |
| Ben-Sasson et al. 2019 (ZK-STARKs) | SKIPPED — post-quantum ZK, different system |
| Bunz et al. 2018 (Bulletproofs) | SKIPPED — range proofs |
| Grassi et al. 2020 (HADES design strategy) | SKIPPED — Poseidon internals |
| Camenisch et al. 2009 (Accumulator for anonymous credentials) | SKIPPED — accumulators, different approach |
| Camenisch, Lysyanskaya 2002 (Dynamic accumulators) | SKIPPED — accumulator theory |
| Hopwood et al. 2019 (Zcash protocol spec) | SKIPPED — very large spec, relevant sections covered in our docs |
| Wood et al. 2014 (Ethereum yellow paper) | SKIPPED — Ethereum spec, well-known |
| Parno et al. 2013 (Pinocchio) | SKIPPED — verifiable computation |
| Ben-Sasson, Goldberg, Levit 2020 (STARK-friendly hash survey) | SKIPPED — STARK hashes |

### pauwels-2021 (zkKYC)
| Reference | Disposition |
|-----------|------------|
| Trask et al. 2020 (Structured Transparency) | SKIPPED — transparency framework, conceptual; covered in privacy-compliance.md |
| Maxwell 2021 (Privacy-preserving AML analysis) | SKIPPED — AML analysis methods |
| FATF 2020 (Digital ID guidance) | SKIPPED — regulatory guidance, covered in privacy-compliance.md |
| Allen 2016 (Path to Self-Sovereign Identity) | SKIPPED — SSI principles, conceptual |
| W3C Verifiable Credentials 1.0 | SKIPPED — VC standard, different domain |
| W3C DIDs v1.0 | SKIPPED — DID standard, different domain |
| Kongsuwan et al. 2020/2021 (CL signatures, BBS+ signatures) | SKIPPED — anonymous credential schemes, not directly applicable |
| Zundel 2021 (BBS+ for VCs) | SKIPPED — VC-specific |

### a16z-2022 (Privacy-Protecting Regulatory Solutions)
| Reference | Disposition |
|-----------|------------|
| Tornado Cash whitepaper | DOWNLOADED (round 1) |
| Privacy Pools concept | DOWNLOADED (round 1) |
| Fisch 2022 (Partitioned Privacy Pools) | SKIPPED — Espresso Systems blog post, conceptual |
| Nadler, Schar 2023 (Tornado Cash primer) | SKIPPED — academic treatment, covered in privacy-compliance.md |
| Comolli, Korver 2021 (Crypto AML legal framework) | SKIPPED — legal analysis, covered in privacy-compliance.md |

### quan-2021 (BLS Aggregate Signature Attacks)
| Reference | Disposition |
|-----------|------------|
| BLS signature IETF draft | DOWNLOADED (round 1) |
| Pairing-friendly curves draft | DOWNLOADED (round 1) |
| Camenisch, Hohenberger, Pedersen 2007 (Batch verification of short sigs) | SKIPPED — batch BLS verification detail, covered by Quan's survey |
| Boneh, Gentry, Lynn, Shacham 2003 (Aggregate sigs) | ADDED THIS ROUND |
| Boneh, Shoup (Grad course in applied crypto, ongoing) | SKIPPED — textbook |
| Drake, Yakira 2019 (Pragmatic BLS aggregation, ethresear.ch) | SKIPPED — forum post, covered in rd-melt-epochs-batching.md |
| Bernstein et al. (Ed25519) | SKIPPED — alternative signature scheme |

### eaton-2023 (Key Blinding Security)
| Reference | Disposition |
|-----------|------------|
| Denis et al. 2023 (IETF Key Blinding draft) | SKIPPED — IETF draft for key blinding; NozKash uses multiplicative blinding on points, not key blinding |
| Denis, Jacobs, Wood 2022 (RSA Blind Signatures draft) | SKIPPED — RSA blind sigs, NozKash uses BLS |
| Davidson et al. 2018 (Privacy Pass) | ADDED THIS ROUND |
| Davidson, Iyengar, Wood 2023 (Privacy Pass Architecture) | SKIPPED — architecture spec, Davidson 2018 covers the crypto |
| Hendrickson et al. 2022 (Rate-Limited Token Issuance) | SKIPPED — rate limiting protocol, different domain |
| Wahby, Boneh, Jeffrey, Poon 2020 (Private Airdrop) | ADDED THIS ROUND |
| Faz-Hernandez et al. 2022 (Hash-to-curve draft) | SKIPPED — became RFC 9380 which we have |
| Groth, Shoup 2022 (ECDSA security with key derivation) | SKIPPED — ECDSA key derivation security, NozKash's ECDSA usage is straightforward |
| Eaton, Stebila, Stracovsky 2021 (Post-quantum key blinding) | SKIPPED — post-quantum, future work |
| Fleischhacker et al. 2016 (Unlinkable sanitizable sigs) | SKIPPED — alternative unlinkability approach |
| Morita et al. 2015 (Schnorr related-key attacks) | SKIPPED — Schnorr scheme, not used |
| Fersch et al. 2017 (ECDSA one-per-message unforgeability) | SKIPPED — ECDSA theory |

### buterin-2023 (Privacy Pools / Blockchain Privacy and Regulatory Compliance)
| Reference | Disposition |
|-----------|------------|
| Soleimani 2023 (Privacy Pools implementation) | SKIPPED — GitHub repo, not a paper |
| Tornado Cash whitepaper | DOWNLOADED (round 1) |
| Nadler, Schar 2023 (Tornado Cash primer) | SKIPPED — see a16z section |
| Nakamoto 2008 (Bitcoin whitepaper) | SKIPPED — foundational but universally available |
| Meiklejohn et al. 2013 (Bitcoin deanonymization) | SKIPPED — Bitcoin-specific analysis |
| Kang et al. 2020 (Bitcoin address clustering) | SKIPPED — Bitcoin-specific |
| Maxwell 2013 (CoinJoin) | SKIPPED — Bitcoin mixing, forum post |
| Liu et al. 2004 (Linkable ring signatures) | SKIPPED — Monero-style ring sigs, different approach |
| Goodell et al. 2019 (Concise linkable ring sigs) | SKIPPED — ring sig optimization |
| Moser et al. 2018 (Monero traceability) | SKIPPED — Monero-specific |
| Petkus 2019 (Why and how zk-SNARKs work) | SKIPPED — educational explainer |
| Berentsen et al. 2023 (ZKP in blockchains and economics) | SKIPPED — economics survey |
| Buterin 2021 (Incomplete guide to rollups) | SKIPPED — rollup overview, different domain |
| Zcash | SKIPPED — covered in zk-primitives.md |

---

## Totals

| Category | Considered | Downloaded (round 1) | Added (round 2) | Skipped |
|----------|-----------|---------------------|-----------------|---------|
| EIPs/ERCs | 19 unique | 13 | 3 | 3 |
| RFCs/IETF drafts | 25+ unique | 9 | 3 | 13+ |
| BIPs | 4 | 4 | 0 | 0 |
| Papers | 80+ unique | 12 | 11 | 57+ |
| **Total** | **~130+** | **38** | **17** | **73+** |

Grand total in collection: **55 source documents** (38 + 17) across 75 files.
