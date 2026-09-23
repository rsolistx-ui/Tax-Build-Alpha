# Truepost Legal and Regulatory Compliance Review

**Date:** 2026-09-22 · **Scope:** federal rules for paid tax return preparers and the software they use, plus the California and New York rules the product computes. **Method:** primary sources only (regulation text, IRS publications and revenue procedures, state statutes, state tax forms). Every finding below cites where it came from.

**Status of this document:** research and engineering analysis, not legal advice. It was prepared to support review by a licensed attorney. Items marked **Attorney review** need that sign-off before the product relies on them in production.

---

## 1. Summary

| Area | Rule | Status after this pass |
|---|---|---|
| Client tax information sent to outside processing services | IRC § 7216; Treas. Reg. §§ 301.7216-1 to -3; Rev. Proc. 2013-14 | **Built:** written consent flow; automatic reading blocked without it |
| Multi-factor authentication | FTC Safeguards Rule, 16 CFR 314.4(c)(5) | **Built:** authenticator-app sign-in, enforced in the app; server enforcement ready behind `REQUIRE_MFA` |
| Form 8879 / 8878 signatures | IRS Publication 1345 (Rev. 12-2025) | **Built:** pen-signed and in-office methods; remote signing off until an identity vendor is contracted |
| State computations (CA, NY) | Cal. R&TC; N.Y. Tax Law; IT-225-I (2025) | **Five errors fixed** (section 4) |
| Marketing and UI claims | FTC Act § 5 (deceptive practices) | Unsupported compliance claims removed across the UI, generated PDFs and memos (2026-09-22) |
| Service-provider contract, written security program, incident response | 16 CFR 314.4(f), (h), (j); IRS Pub 4557 / 5708 | **Owner action:** documents, not code (section 6) |

---

## 2. IRC § 7216: disclosure and use of tax return information

**Sources:** [26 CFR 301.7216-1](https://www.law.cornell.edu/cfr/text/26/301.7216-1), [301.7216-2](https://www.law.cornell.edu/cfr/text/26/301.7216-2), [301.7216-3](https://www.law.cornell.edu/cfr/text/26/301.7216-3), [Rev. Proc. 2013-14](https://www.irs.gov/pub/irs-drop/rp-13-14.pdf).

**Penalties:** criminal misdemeanor, up to one year and $1,000 per violation (§ 7216(a)); civil penalty of $250 per disclosure or use, up to $10,000 per year (§ 6713(a)). Rev. Proc. 2013-14 § 3.

### 2.1 Findings

1. **Truepost and its processing services are "tax return preparers."** § 301.7216-1(b)(2)(i)(B) covers "any person who is engaged in the business of providing auxiliary services in connection with the preparation of tax returns, including a person who develops software that is used to prepare or file a tax return." Receipts and bank statements a client gives the firm to prepare a return are "tax return information" (§ 301.7216-1(b)(3)(i)).
2. **The no-consent exception covers only US-located recipients.** § 301.7216-2(d)(1) lets a preparer disclose to another preparer "located in the United States" for preparation or auxiliary services, "so long as the services provided are not substantive determinations or advice affecting the tax liability."
3. **The configured processing services do not guarantee US-only processing.** [Cloudflare](https://developers.cloudflare.com/data-localization/compatibility) states jurisdictional restrictions are "not supported for Workers AI today." [Groq](https://console.groq.com/docs/your-data) operates data centers in the US, Australia, Canada, Finland, and Saudi Arabia. Google's Gemini API is not region-pinned in this configuration.
4. **Conclusion:** before a client's documents go to those services, the firm needs the client's written consent under § 301.7216-3, in the format Rev. Proc. 2013-14 requires for Form 1040-series filers. Category suggestions may also approach "substantive determinations," which consent covers as well.
5. **Social Security numbers cannot be sent abroad, even with consent,** unless both parties maintain an "adequate data protection safeguard" (§ 301.7216-3(b)(4); Rev. Proc. 2013-14 § 5.07). Truepost has no such certified program, so the consent excludes documents showing a full SSN.

### 2.2 What was built

| Requirement (source) | Implementation |
|---|---|
| Separate documents for disclosure and use (Rev. Proc. § 5.01, § 5.05; Reg. -3(c)) | Two consents: "Disclosure (automatic reading)" and optional "Use (bookkeeping)", each signed separately |
| Mandatory statements, verbatim, in sequence (§ 5.04(1)(b), (c), (d), (e)(i)) | Built from fixed text in `services/taxpayer-consent.ts`; a test asserts the exact wording and order |
| Names preparer and taxpayer; specifies information, recipients, purpose (Reg. -3(a)(3)) | Preparer = firm name; taxpayer = client legal name; recipients listed by legal name from the live configuration |
| Affirmative consent, no opt-out (§ 5.04(2)) | Unchecked box; "I do not consent" is always available and records nothing |
| Not conditioned on service (§ 5.04(1)(a), (c)) | Declining leaves manual entry available ("If you do not sign, we will enter your documents by hand") |
| Electronic signature (§ 6.02(b)) | Taxpayer types their own name; the field is never pre-filled |
| Signed and dated; duration; one-year default (§ 5.03, § 5.04(1)) | Date recorded at signing; taxpayer picks one year or an end date |
| Screen contains only consent text; printable; readable size (§ 5.03) | Dedicated `/consent` page; print button; body text at standard size |
| Paper consent: 8.5 × 11, 12-point, only consent text (§ 5.02) | Printable form route renders 12-point on letter size |
| No altering after signing; no blanks for the preparer (§ 5.04(4)) | Signed text stored with SHA-256; database trigger blocks edits except a one-time revocation |
| Consent obtained before disclosure (Reg. -3(b)) | Receipt pipeline checks for a valid consent before any outside call; without it the file is saved and routed to manual entry |
| Consent must cover every recipient | A consent that does not name a newly configured service does not cover it; reading pauses until the client signs again |

### 2.3 Residual risks and open items

- **Attorney review:** the consent wording beyond the mandatory statements (description of information, purpose, SSN exclusion, revocation language).
- **Attorney review:** whether the firm should obtain the *use* consent for bookkeeping. § 301.7216-2(h) permits use for other accounting services only for preparers "lawfully engaged in the practice of law or accountancy"; whether a non-CPA bookkeeper qualifies depends on state law.
- **Recipient legal name:** the consent names Truepost as "operated by Solis Equity Holdings LLC."
- **US-only reading (built 2026-09-23):** with `US_ONLY_READING=true` and an Azure AI Document Intelligence resource in a US region, receipts are read only in the US (Microsoft processes input in the resource's region and Truepost deletes it immediately after reading). Under § 301.7216-2(d)(1) no consent is then required, and the consent flow switches off automatically.
- **SSN leakage through the receipt tray:** the product instructs users to keep W-2s and 1099s in Documents (never machine-read), but it cannot detect an SSN before a receipt is read. The real fix is US-only processing (for example a US-region-pinned provider), which would also remove the foreign-disclosure element of the consent.
- **Other outside calls:** the rule-drafting helper sends the practitioner's typed rule text to Cloudflare Workers AI; the client's name was removed from that prompt. The rule-test helper sends a practitioner-typed sample expense. Neither sends client documents, but practitioners should not paste client identifiers into them.
- **Contractor notice:** § 301.7216-2(d)(2) requires written notice of §§ 6713 and 7216 to individuals at contractors receiving tax information without consent. Consent removes reliance on this exception for the reading services; Truepost's own staff agreements should include the notice.

---

## 3. FTC Safeguards Rule (16 CFR Part 314)

**Sources:** [16 CFR 314.2](https://www.law.cornell.edu/cfr/text/16/314.2), [314.4](https://www.law.cornell.edu/cfr/text/16/314.4), [314.6](https://www.law.cornell.edu/cfr/text/16/314.6).

Tax preparers are covered: "An accountant or other tax preparation service that is in the business of completing income tax returns is a financial institution" (§ 314.2).

| Requirement | Applies to a firm under 5,000 consumers? (§ 314.6) | Truepost |
|---|---|---|
| (c)(3) Encrypt customer information in transit and at rest | Yes | Neon and Cloudflare R2 encrypt at rest (provider default); HTTPS with HSTS |
| (c)(5) Multi-factor authentication for anyone accessing the system | Yes | **Built this session.** TOTP authenticator plus backup codes; the app requires enrollment before any client data loads. Set `REQUIRE_MFA=true` to also enforce at the API once owners have enrolled |
| (c)(8) Log and monitor authorized-user activity | Yes | Partial: audit events for signing, consent, returns and receipts. Not every read is logged |
| (c)(6) Secure disposal within two years after last use, unless required to retain | Yes | Not built: no disposal job. Signed e-file records and consents are intentionally undeletable for their retention periods |
| (f) Oversee service providers by contract | Yes | **Owner action:** the firm needs a written agreement with Truepost describing safeguards; Truepost needs its own with Neon, Cloudflare and each processing service |
| (b)(1) Written risk assessment | No (exempt) | — |
| (d)(2) Continuous monitoring or annual pen test | No (exempt) | — |
| (h) Written incident response plan | No (exempt) | Recommended anyway |
| (j) Notify the FTC within 30 days of a breach affecting 500+ consumers | Yes | Owner process |

Known gap: the owner "fast-pass" workstation pairing code creates a session without the authenticator step. Keep it owner-only, or require the second factor after pairing.

---

## 4. State computations: verified against primary sources

All citations were checked on 2026-09-22 against the statute text or the state's own form instructions. Tests in `services/state-tax-rules.test.ts` pin each result.

### Errors found and fixed

| # | Item | Was | Now (source) |
|---|---|---|---|
| 1 | NY bonus depreciation codes | IT-225 "A-201 / S-201" | **A-209 / S-213** via Form IT-398 ([IT-225-I 2025](https://www.tax.ny.gov/pdf/current_forms/it/it225i.pdf)). S-201 is the small business modification |
| 2 | NY "SALT add-back" | Added back **Schedule A** state and local taxes as "A-101" | **A-201** covers only income taxes deducted **in computing federal AGI** (for example NYC UBT on Schedule C), per Tax Law § 612(b)(3) and IT-225-I. Itemized taxes are handled on IT-196. The old code overstated NY income |
| 3 | NY MCTMT self-employment rates and threshold | 0.60% / 0.34% and $50,000 for every year | Before 2023: 0.34%; 2023: Zone 1 **0.47%**; 2024–2025: 0.60% / 0.34%, $50,000 per zone ([Part Q, ch. 58 L. 2023](https://www.tax.ny.gov/legal/2023/pit-corp-changes.htm)); **2026+: $150,000 threshold per zone** ([Part VV, ch. 59 L. 2025](https://www.tax.ny.gov/legal/2025/pit-corp-changes.htm)) |
| 4 | CA HSA citation | R&TC § 17215 (which governs Archer MSAs, IRC § 220) | **R&TC § 17215.4** ("Section 223 of the Internal Revenue Code ... shall not apply") |
| 5 | CA PTE elective tax | Individual add-back citing § 17052.10(h); one section for all years | § 17052.10(h) is a statement of legislative purpose, not an add-back. Owner-level add-back removed (the entity adds it back). Credit cites **§ 17052.10 for 2021–2025** and **§ 17052.11 for 2026–2030** (SB 132), with the 12.5% reduction for a missed June 15 payment |

Also corrected: the CA § 179 limit now applies the **$200,000 phase-out** in R&TC § 17255 (it previously applied only the $25,000 cap), and the LLC fee input is labeled "total income" (gross income plus cost of goods sold) as § 17942(b) defines it.

### Verified correct as written

CA: § 17250(a)(4) bonus depreciation non-conformity; § 17941 $800 annual tax; § 17942 fee tiers ($900 / $2,500 / $6,000 / $11,790 at $250k / $500k / $1M / $5M). NY: § 612(b)(8) and (c)(16); § 612(b)(43) and IT-225 A-219 PTET add-back; § 606(kkk) PTET credit (refundable).

### Not independently verified (flagged in the product)

- The 12.5% reduction in § 17052.11 comes from practitioner summaries of SB 132 (the FTB and bill-text sites refused automated access). The worksheet shows a note to confirm it against the statute before filing.

---

## 5. IRS Publication 1345: Forms 8879 and 8878

See `docs/NATIVE_ESIGN_STATUS.md`. Summary: pen signatures returned electronically need no identity check (p.17); in-office electronic signatures need a government photo ID inspection or a verified multi-year relationship (p.16); remote electronic signatures need credit-bureau identity questions (p.16–17) and are built but switched off. Returns cannot be transmitted until every live 8879 is signed (p.30, rule 9).

---

## 6. Firm obligations Truepost cannot fulfill in code

These belong to the practitioner. The product can help, but it cannot make a firm compliant on its own.

1. **Written information security program.** Required by the Safeguards Rule; IRS Publication 5708 provides a template, and Publication 4557 explains safeguards.
2. **Service-provider agreement** with Truepost (16 CFR 314.4(f)).
3. **Record retention:** keep a copy of each return or a list of returns for three years (IRC § 6107(b)); keep Forms 8879/8878 for three years (Pub 1345).
4. **PTIN** on every return prepared (IRC § 6109(a)(4)); annual renewal.
5. **State preparer registration.** California: non-exempt preparers (not a CPA, EA, or attorney) register with CTEC and carry a bond (Bus. & Prof. Code § 22250 et seq.). New York: commercial preparers register annually (Tax Law § 32). Not verified this session; confirm current requirements before relying on them.
6. **Breach response:** FTC notice at 500+ consumers (16 CFR 314.4(j)); state breach-notification laws where clients reside.
7. **Circular 230 and IRC § 6694:** every figure Truepost produces is a draft for the preparer's review. The product must never state a preparer representation on their behalf; the auto-generated "practitioner declaration" was removed.

---

## 7. Claims policy

Do not claim: "IRS certified" or "IRS approved" (the IRS does not certify e-signature or bookkeeping software), "ESIGN/UETA compliant," "Circular 230 compliant," "audit-proof," or any mandatory retention period the code does not enforce. Accurate: "Form 8879 signing built to IRS Publication 1345," "client consent built to Rev. Proc. 2013-14," "two-step sign-in."
