---
title: "Safeguarding cryptocurrency by disclosing quantum vulnerabilities responsibly"
source: "google-2026-quantum-crypto.html"
generated: true
---

![](https://storage.googleapis.com/gweb-research2023-media/original_images/qaiforgrbloglogo.png)

1.  <a href="/" class="glue-breadcrumbs__link attribution">Home</a> <img
    src="data:image/svg+xml;base64,PHN2ZyByb2xlPSJwcmVzZW50YXRpb24iIGFyaWEtaGlkZGVuPSJ0cnVlIiBjbGFzcz0iZ2x1ZS1pY29uICAiPgogIDx1c2UgaHJlZj0iL2dyL3N0YXRpYy9hc3NldHMvaWNvbnMvZ2x1ZS1pY29ucy5zdmcjY2hldnJvbi1yaWdodCIgLz4KPC9zdmc+"
    class="glue-icon" />
2.  <a href="/blog/" class="glue-breadcrumbs__link attribution">Blog</a> <img
    src="data:image/svg+xml;base64,PHN2ZyByb2xlPSJwcmVzZW50YXRpb24iIGFyaWEtaGlkZGVuPSJ0cnVlIiBjbGFzcz0iZ2x1ZS1pY29uICAiPgogIDx1c2UgaHJlZj0iL2dyL3N0YXRpYy9hc3NldHMvaWNvbnMvZ2x1ZS1pY29ucy5zdmcjY2hldnJvbi1yaWdodCIgLz4KPC9zdmc+"
    class="glue-icon" />

# Safeguarding cryptocurrency by disclosing quantum vulnerabilities responsibly

March 31, 2026


Ryan Babbush, Director of Research, Quantum Algorithms, and Hartmut Neven, VP of Engineering, Google
Quantum AI, Google Research

We’re exploring a new model for how to elucidate the code breaking capabilities of future quantum
computers and outlining steps that should be taken to mitigate their consequences.

## Quick links

- <a href="https://arxiv.org/abs/2603.28846" class="not-glue quicklinks__item__link"> Paper</a>
-  Share
  - <a
    href="https://twitter.com/intent/tweet?text=https%3A//research.google/blog/safeguarding-cryptocurrency-by-disclosing-quantum-vulnerabilities-responsibly/"

    title="Share on Twitter"><img
    src="data:image/svg+xml;base64,PHN2ZyByb2xlPSJwcmVzZW50YXRpb24iIGFyaWEtaGlkZGVuPSJ0cnVlIiBjbGFzcz0iZ2x1ZS1pY29uIGdsdWUtaWNvbi0tc29jaWFsIGdsdWUtaWNvbi0tMjRweCI+CiAgICAgICAgICAgICAgPHVzZSBocmVmPSIvZ3Ivc3RhdGljL2Fzc2V0cy9pY29ucy90d2l0dGVyLXguc3ZnI3R3aXR0ZXIteCIgLz4KICAgICAgICAgIDwvc3ZnPg=="
    class="glue-icon glue-icon--social glue-icon--24px" /></a>

  - <a
    href="https://www.facebook.com/sharer/sharer.php?u=https%3A//research.google/blog/safeguarding-cryptocurrency-by-disclosing-quantum-vulnerabilities-responsibly/"

    title="Share on Facebook"><img
    src="data:image/svg+xml;base64,PHN2ZyByb2xlPSJwcmVzZW50YXRpb24iIGFyaWEtaGlkZGVuPSJ0cnVlIiBjbGFzcz0iZ2x1ZS1pY29uIGdsdWUtaWNvbi0tc29jaWFsIGdsdWUtaWNvbi0tY29sb3ItZmFjZWJvb2sgZ2x1ZS1pY29uLS0yNHB4Ij4KICAgICAgICAgICAgPHVzZSBocmVmPSIvZ3Ivc3RhdGljL2Fzc2V0cy9pY29ucy9mYWNlYm9vay5zdmcjZmFjZWJvb2siIC8+CiAgICAgICAgICA8L3N2Zz4="
    class="glue-icon glue-icon--social glue-icon--color-facebook glue-icon--24px" /></a>

  - <a
    href="https://www.linkedin.com/shareArticle?url=https%3A//research.google/blog/safeguarding-cryptocurrency-by-disclosing-quantum-vulnerabilities-responsibly/&amp;mini=true"

    title="Share on LinkedIn"><img
    src="data:image/svg+xml;base64,PHN2ZyByb2xlPSJwcmVzZW50YXRpb24iIGFyaWEtaGlkZGVuPSJ0cnVlIiBjbGFzcz0iZ2x1ZS1pY29uIGdsdWUtaWNvbi0tc29jaWFsIGdsdWUtaWNvbi0tY29sb3ItbGlua2VkaW4gZ2x1ZS1pY29uLS0yNHB4Ij4KICAgICAgICAgICAgPHVzZSBocmVmPSIvZ3Ivc3RhdGljL2Fzc2V0cy9pY29ucy9nbHVlLWljb25zLnN2ZyNwb3N0LWxpbmtlZGluIiAvPgogICAgICAgICAgPC9zdmc+"
    class="glue-icon glue-icon--social glue-icon--color-linkedin glue-icon--24px" /></a>

  - <a
    href="mailto:name@example.com?subject=Check%20out%20this%20site&amp;body=Check%20out%20https%3A//research.google/blog/safeguarding-cryptocurrency-by-disclosing-quantum-vulnerabilities-responsibly/"
    class="glue-social__link" data-gt-method="email"><img
    src="data:image/svg+xml;base64,PHN2ZyByb2xlPSJwcmVzZW50YXRpb24iIGFyaWEtaGlkZGVuPSJ0cnVlIiBjbGFzcz0iZ2x1ZS1pY29uIGdsdWUtaWNvbi0tc29jaWFsIGdsdWUtaWNvbi0tY29sb3Itc2hhcmVtYWlsIGdsdWUtaWNvbi0tMjRweCI+CiAgICAgICAgICAgIDx1c2UgaHJlZj0iL2dyL3N0YXRpYy9hc3NldHMvaWNvbnMvZ2x1ZS1pY29ucy5zdmcjZW1haWwiIC8+CiAgICAgICAgICA8L3N2Zz4="
    class="glue-icon glue-icon--social glue-icon--color-sharemail glue-icon--24px" /></a>

  - <img
    src="data:image/svg+xml;base64,PHN2ZyByb2xlPSJwcmVzZW50YXRpb24iIGFyaWEtaGlkZGVuPSJ0cnVlIiBjbGFzcz0iZ2x1ZS1pY29uIGdsdWUtaWNvbi0tc29jaWFsIGdsdWUtaWNvbi0tY29sb3Itc2hhcmVsaW5rIGdsdWUtaWNvbi0tMjRweCI+CiAgICAgICAgICAgICAgPHVzZSBocmVmPSIvcHVibGljL2ljb25zL2dsdWUtaWNvbnMuc3ZnI2xpbmsiIC8+CiAgICAgICAgICAgIDwvc3ZnPg=="
    class="glue-icon glue-icon--social glue-icon--color-sharelink glue-icon--24px" />
    Copy link

    ×

    <a
href="https://blog.google/innovation-and-ai/technology/safety-security/cryptography-migration-timeline/"
target="_blank" rel="noopener noreferrer">Google has led the responsible transition</a> to
post-quantum cryptography
<a href="https://security.googleblog.com/2016/07/experimenting-with-post-quantum.html"
target="_blank" rel="noopener noreferrer">since 2016</a>. In a new
<a href="https://arxiv.org/abs/2603.28846" target="_blank" rel="noopener noreferrer">whitepaper</a>,
we show that future quantum computers may break the
<a href="https://en.wikipedia.org/wiki/Elliptic-curve_cryptography" target="_blank"
rel="noopener noreferrer">elliptic curve cryptography</a> that protects cryptocurrency and other
systems with fewer qubits and gates than previously realized. We want to raise awareness on this
issue and are providing the cryptocurrency community with recommendations to improve security and
stability before this is possible, including transitioning blockchains to post-quantum cryptography
(PQC), which is resistant to quantum attacks.

To share this research responsibly, we engaged with the U.S. government and developed a new method
to describe these vulnerabilities via a zero-knowledge proof, so they can be verified without
providing a roadmap for bad actors. We urge other research teams to do the same to keep people safe.
We look forward to <a
href="https://blog.google/innovation-and-ai/technology/safety-security/the-quantum-era-is-coming-are-we-ready-to-secure-it/"
target="_blank" rel="noopener noreferrer">continuing our work across the industry</a> following our
2029 timeline alongside others working on responsible approaches, like Coinbase, the Stanford
Institute for Blockchain Research, and the Ethereum Foundation.

## Quantum resource estimates

Quantum computers promise to solve otherwise impossible problems, including examples in [chemistry,
drug discovery, and
energy](https://research.google/blog/developing-industrial-use-cases-for-physical-simulation-on-future-error-corrected-quantum-computers/).
However, large-scale cryptographically relevant quantum computers (CRQCs) will also be able to break
current, widely used public-key cryptography that protects things like people’s confidential
information. Governments and others, including Google, have been <a
href="https://blog.google/innovation-and-ai/technology/safety-security/the-quantum-era-is-coming-are-we-ready-to-secure-it/"
target="_blank" rel="noopener noreferrer">preparing for this security challenge for many years</a>.
With continued scientific and technological progress, CRQCs are getting closer to reality, requiring
a transition to PQC, which is why we recently introduced <a
href="https://blog.google/innovation-and-ai/technology/safety-security/cryptography-migration-timeline/"
target="_blank" rel="noopener noreferrer">our 2029 migration timeline</a>.

In our
<a href="https://arxiv.org/abs/2603.28846" target="_blank" rel="noopener noreferrer">whitepaper</a>,
we share updated estimates of the quantum computing “resources” (i.e., qubits and gates) necessary
to break the 256-bit elliptic curve discrete logarithm problem (ECDLP-256) on which elliptic curve
cryptography is based. We express our resource estimates in terms of the number of logical qubits
(error-corrected qubits composed of hundreds of physical qubits) and
<a href="https://en.wikipedia.org/wiki/Toffoli_gate#Relation_to_quantum_computing" target="_blank"
rel="noopener noreferrer">Toffoli gates</a> (expensive elementary operations on qubits that are the
primary driver of the time needed to execute many algorithms). Specifically, we have compiled two
quantum circuits (a sequence of quantum gates) that implement
<a href="https://en.wikipedia.org/wiki/Shor%27s_algorithm" target="_blank"
rel="noopener noreferrer">Shor's algorithm</a> for ECDLP-256: one that uses less than 1,200 logical
qubits and 90 million Toffoli gates and one that uses less than 1,450 logical qubits and 70 million
Toffoli gates. We estimate that these circuits can be executed on a superconducting qubit CRQC with
fewer than 500,000 physical qubits in a few minutes, given standard assumptions about hardware
capabilities that are consistent with some of
<a href="https://blog.google/innovation-and-ai/technology/research/google-willow-quantum-chip/"
target="_blank" rel="noopener noreferrer">Google’s flagship quantum processors</a>. This is an
approximately 20-fold reduction in the number of physical qubits required to solve ECDLP-256 and a
continuation of a long history of gradual optimization in compiling quantum algorithms to
fault-tolerant circuits.

## Protecting cryptocurrencies with post-quantum cryptography

Most blockchain technologies and cryptocurrencies currently rely on ECDLP-256 for critical aspects
of their security. As we argue in our paper, PQC represents a well-understood path to post-quantum
blockchain security, underwriting confidence in the long-term viability of cryptocurrencies and the
digital economy in a world with CRQCs. We provide examples of post-quantum blockchains and
experimental PQC deployments on otherwise quantum-vulnerable blockchains. We note that while viable
solutions like PQC exist, they will take time to implement, bringing increasing urgency to act. We
also lay out additional recommendations for the cryptocurrency community to help improve security
and stability in the short term and long term, including refraining from exposing or reusing
vulnerable wallet addresses as well as potential policy options to address abandoned cryptocoins.

## Our approach to vulnerability disclosure

Disclosure of security vulnerabilities is a controversial subject. On one hand, the "No Disclosure"
position holds that publicizing vulnerabilities provides bad actors with instruction manuals for
attacks. On the other, the "Full Disclosure" movement argues that knowledge of security
vulnerabilities enables the public to exercise caution and protect itself while incentivizing
security fixes. In computer security, the debate has converged around a set of compromises known as
"Responsible Disclosure" and "Coordinated Vulnerability Disclosure". Both advocate disclosing the
vulnerability with an embargo and some time allowing for security fixes to be rolled out to affected
systems. Variants of Responsible Disclosure with strict deadlines have been adopted by premier
security research institutions, such as
<a href="https://en.wikipedia.org/wiki/CERT_Coordination_Center" target="_blank"
rel="noopener noreferrer">CERT/CC</a> at Carnegie Mellon University and Google's
<a href="https://projectzero.google/" target="_blank" rel="noopener noreferrer">Project Zero</a>,
and have been adopted as an international standard
<a href="https://www.iso.org/standard/72311.html" target="_blank" rel="noopener noreferrer">ISO/IEC
29147:2018</a>.\
\
Disclosure of security vulnerabilities in blockchain technologies is further complicated by the fact
that cryptocurrencies are not simply decentralized data processing systems. Their value as digital
assets derives both from the digital security of the network and the public confidence in the
system. While their digital security can be attacked using CRQCs, public confidence can also be
undermined using
<a href="https://en.wikipedia.org/wiki/Fear,_uncertainty,_and_doubt" target="_blank"
rel="noopener noreferrer">fear, uncertainty and doubt</a> (FUD) techniques. Consequently,
unscientific and unsubstantiated resource estimates for quantum algorithms breaking ECDLP-256 can
themselves represent an attack on the system.

These considerations guide our careful disclosure of updated resource estimates for quantum attacks
on blockchain technology based on elliptic curve cryptography. First, we reduce the FUD potential of
our discussion by clarifying the areas where blockchains are immune to quantum attacks and by
highlighting the progress that has already been achieved towards post-quantum blockchain security.
Second, we substantiate our resource estimates without sharing the underlying quantum circuits by
publishing a state-of-the-art cryptographic construction called a "zero-knowledge proof", which
allows third parties to verify our claims without us leaking sensitive attack details.

We welcome further discussions with the quantum, security, cryptocurrency, and policy communities to
align on responsible disclosure norms going forward.

## Outlook

With this work, our goal is to support the long-term health of the cryptocurrency ecosystem and
blockchain technologies, which are an increasingly significant part of the digital economy. Moving
forward, we hope our approach to responsible disclosure can spur an important conversation among
quantum computing researchers and the broader public, and offer a model on which to build for the
quantum cryptanalysis research field.

- Labels:
- <a href="/blog/label/algorithms-theory" class="caption">Algorithms &amp; Theory</a>
  - <a href="/blog/label/quantum" class="caption">Quantum</a>
  - <a href="/blog/label/security-privacy-and-abuse-prevention" class="caption">Security, Privacy and
  Abuse Prevention</a>

## Quick links

- <a href="https://arxiv.org/abs/2603.28846" class="not-glue quicklinks__item__link"> Paper</a>
-  Share
  - <a
    href="https://twitter.com/intent/tweet?text=https%3A//research.google/blog/safeguarding-cryptocurrency-by-disclosing-quantum-vulnerabilities-responsibly/"

    title="Share on Twitter"><img
    src="data:image/svg+xml;base64,PHN2ZyByb2xlPSJwcmVzZW50YXRpb24iIGFyaWEtaGlkZGVuPSJ0cnVlIiBjbGFzcz0iZ2x1ZS1pY29uIGdsdWUtaWNvbi0tc29jaWFsIGdsdWUtaWNvbi0tMjRweCI+CiAgICAgICAgICAgICAgPHVzZSBocmVmPSIvZ3Ivc3RhdGljL2Fzc2V0cy9pY29ucy90d2l0dGVyLXguc3ZnI3R3aXR0ZXIteCIgLz4KICAgICAgICAgIDwvc3ZnPg=="
    class="glue-icon glue-icon--social glue-icon--24px" /></a>

  - <a
    href="https://www.facebook.com/sharer/sharer.php?u=https%3A//research.google/blog/safeguarding-cryptocurrency-by-disclosing-quantum-vulnerabilities-responsibly/"

    title="Share on Facebook"><img
    src="data:image/svg+xml;base64,PHN2ZyByb2xlPSJwcmVzZW50YXRpb24iIGFyaWEtaGlkZGVuPSJ0cnVlIiBjbGFzcz0iZ2x1ZS1pY29uIGdsdWUtaWNvbi0tc29jaWFsIGdsdWUtaWNvbi0tY29sb3ItZmFjZWJvb2sgZ2x1ZS1pY29uLS0yNHB4Ij4KICAgICAgICAgICAgPHVzZSBocmVmPSIvZ3Ivc3RhdGljL2Fzc2V0cy9pY29ucy9mYWNlYm9vay5zdmcjZmFjZWJvb2siIC8+CiAgICAgICAgICA8L3N2Zz4="
    class="glue-icon glue-icon--social glue-icon--color-facebook glue-icon--24px" /></a>

  - <a
    href="https://www.linkedin.com/shareArticle?url=https%3A//research.google/blog/safeguarding-cryptocurrency-by-disclosing-quantum-vulnerabilities-responsibly/&amp;mini=true"

    title="Share on LinkedIn"><img
    src="data:image/svg+xml;base64,PHN2ZyByb2xlPSJwcmVzZW50YXRpb24iIGFyaWEtaGlkZGVuPSJ0cnVlIiBjbGFzcz0iZ2x1ZS1pY29uIGdsdWUtaWNvbi0tc29jaWFsIGdsdWUtaWNvbi0tY29sb3ItbGlua2VkaW4gZ2x1ZS1pY29uLS0yNHB4Ij4KICAgICAgICAgICAgPHVzZSBocmVmPSIvZ3Ivc3RhdGljL2Fzc2V0cy9pY29ucy9nbHVlLWljb25zLnN2ZyNwb3N0LWxpbmtlZGluIiAvPgogICAgICAgICAgPC9zdmc+"
    class="glue-icon glue-icon--social glue-icon--color-linkedin glue-icon--24px" /></a>

  - <a
    href="mailto:name@example.com?subject=Check%20out%20this%20site&amp;body=Check%20out%20https%3A//research.google/blog/safeguarding-cryptocurrency-by-disclosing-quantum-vulnerabilities-responsibly/"
    class="glue-social__link" data-gt-method="email"><img
    src="data:image/svg+xml;base64,PHN2ZyByb2xlPSJwcmVzZW50YXRpb24iIGFyaWEtaGlkZGVuPSJ0cnVlIiBjbGFzcz0iZ2x1ZS1pY29uIGdsdWUtaWNvbi0tc29jaWFsIGdsdWUtaWNvbi0tY29sb3Itc2hhcmVtYWlsIGdsdWUtaWNvbi0tMjRweCI+CiAgICAgICAgICAgIDx1c2UgaHJlZj0iL2dyL3N0YXRpYy9hc3NldHMvaWNvbnMvZ2x1ZS1pY29ucy5zdmcjZW1haWwiIC8+CiAgICAgICAgICA8L3N2Zz4="
    class="glue-icon glue-icon--social glue-icon--color-sharemail glue-icon--24px" /></a>

  - <img
    src="data:image/svg+xml;base64,PHN2ZyByb2xlPSJwcmVzZW50YXRpb24iIGFyaWEtaGlkZGVuPSJ0cnVlIiBjbGFzcz0iZ2x1ZS1pY29uIGdsdWUtaWNvbi0tc29jaWFsIGdsdWUtaWNvbi0tY29sb3Itc2hhcmVsaW5rIGdsdWUtaWNvbi0tMjRweCI+CiAgICAgICAgICAgICAgPHVzZSBocmVmPSIvcHVibGljL2ljb25zL2dsdWUtaWNvbnMuc3ZnI2xpbmsiIC8+CiAgICAgICAgICAgIDwvc3ZnPg=="
    class="glue-icon glue-icon--social glue-icon--color-sharelink glue-icon--24px" />
    Copy link

    ×

    ### Other posts of interest

- <a href="/blog/building-better-ai-benchmarks-how-many-raters-are-enough/" class="glue-card not-glue"

  ![](https://storage.googleapis.com/gweb-research2023-media/original_images/ForestVTree-0-Hero.png)

  March 31, 2026

   Building better AI benchmarks: How many raters are enough?
  

  -  Algorithms & Theory
    · 
  -  Machine Intelligence 

  - <a href="/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/"

  ![](https://storage.googleapis.com/gweb-research2023-media/original_images/Quantization-hero.gif)

  March 24, 2026

   TurboQuant: Redefining AI efficiency with extreme
  compression 

  -  Algorithms & Theory
    · 
  -  Generative AI
    · 
  -  Machine Intelligence 

  - <a href="/blog/mapping-the-modern-world-how-s2vec-learns-the-language-of-our-cities/"

  ![](https://storage.googleapis.com/gweb-research2023-media/original_images/S2Vec-hero.png)

  March 24, 2026

   Mapping the modern world: How S2Vec learns the language of
  our cities 

  -  Algorithms & Theory
    · 
  -  Earth AI ·
    
  -  Machine Intelligence