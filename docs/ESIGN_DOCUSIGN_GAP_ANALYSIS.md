# E-Signature: Truepost vs DocuSign

Written 2026-09-22. DocuSign pricing comes from the research recorded in `HANDOFF.md` §4 (2026 list prices). Truepost status is verified against the code in this repo; see `docs/NATIVE_ESIGN_STATUS.md`.

## Scorecard

| Area | DocuSign | Truepost today | Verdict |
|---|---|---|---|
| Price | $10-15/mo Personal (5 envelopes), $25-45/user/mo Standard, $40-65 Business Pro; ID verification $2.50+/attempt; SMS $0.40+/send | Included in the subscription; $0 per envelope; no seat pricing | **Truepost wins** |
| IRS Form 8879/8878 | No dedicated product; firms add the KBA add-on, usually Enterprise tier plus a separate contract | Built for it: pen-sign links, in-office signing with ID capture, returning-client shortcut, 3-attempt rule, transmission gate, evidence packet | **Truepost wins** (remote signing needs a vendor on both sides) |
| Pen-signed 8879 by phone photo | Not a DocuSign flow; it's an e-signature product | Taxpayer downloads, signs, uploads a photo; staff confirm; sealed with hashes. $0 and valid under Pub 1345 p.17 | **Truepost wins** |
| In-person signing | Available (host signs in a signer on the device) | Available, plus the ID-inspection fields Pub 1345 requires captured in the same step | **Truepost wins** for tax |
| Remote e-sign with identity check | Available as a paid add-on | Built and tested but off until a KBA vendor contract | **DocuSign ahead** until the vendor is connected |
| Tamper evidence | Certificate of completion, envelope audit trail | SHA-256 before and after sealing, append-only evidence enforced by the database, one-click integrity re-check | **Match**; the one-click re-check is an edge |
| Workflow context | Separate app; integrations to reach client files | Lives inside the client file, next to the return, receipts and engagement | **Truepost wins** |
| Ordinary contracts (engagement letters) | Full product | Single-signer drawn or typed, certificate page, secure link | **Match** for one signer |
| Multiple signers, signing order | Yes | One signer per link; joint 8879s use one authorization per spouse | **DocuSign ahead** |
| Automatic reminders and expiry | Yes | Links expire (7 days); no automatic reminders | **DocuSign ahead** |
| Templates with placed fields | Yes, drag-and-drop | Generated engagement letter; no drag-and-drop field placement | **DocuSign ahead** |
| Bulk send | Business Pro tier and up | No | **DocuSign ahead** |
| SMS delivery | Paid add-on | Twilio is wired for inbound receipts only; not for signing links | **DocuSign ahead** (zero-cost to close once Twilio keys exist) |
| Payment collection at signing | Business Pro tier and up | Stripe Connect exists, not joined to signing | **DocuSign ahead** |
| Mobile | Native apps | Installable PWA; signing page and pad are touch-first | **Match** for signing |
| Integrations and API | Hundreds | None for signing (we are the practice system) | Not a target |

## Zero-cost gaps to close next, in value order

1. **Automatic reminders** for unsigned 8879s and letters. The Cloudflare Cron trigger already runs daily; reuse it. Highest-value item for tax season.
2. **SMS signing links** through the existing Twilio integration once Twilio keys are set. No per-send markup.
3. **Joint-return pairing**: prepare the taxpayer and spouse authorizations together from one upload.
4. **Signature placement on the form itself** (click where the signature goes) instead of the certificate page.
5. **Collect the invoice at signing**: Stripe Connect is already live, so show the invoice after the engagement letter is signed.
6. **Multi-signer letters with order** (partners, officers).

Bulk send and drag-and-drop templates matter less for a solo or small practice; revisit after the items above.

## Needs money, and only after the first sale

- **KBA vendor** (LexisNexis or Experian) for remote 8879 signing. The code is ready; the vendor supplies API specs with the contract. DocuSign buys from the same vendors and adds its markup.

## Positioning line (accurate today)

"Get Form 8879s signed with no per-envelope fees: pen signature from the client's phone, or e-sign in your office with ID capture, built to IRS Publication 1345, inside the client file."
