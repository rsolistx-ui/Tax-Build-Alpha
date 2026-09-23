# Native E-Sign Status

Last verified: 2026-09-22, against IRS Publication 1345 (Rev. 12-2025), pages 15-17 and 29-30.

## Ordinary documents (engagement letters, disclosures)

Truepost creates and retains an in-house signed PDF. The signer records consent, chooses a drawn or typed mark, and the completed PDF is stored in R2 with an append-only evidence row: SHA-256 before and after, signer name, email, timestamp, IP address and user agent. Code: `apps/api/src/services/native-esign.ts`.

## IRS Forms 8879 and 8878

Code: `apps/api/src/services/efile-signature.ts`, routes in `apps/api/src/routes/efile-signature.ts`, schema in `migrations/neon/0061_efile_signature_authorizations.sql`. UI: the "IRS e-file signatures" panel in the client E-sign tab, and `/sign` for the taxpayer's link.

| Method | Status | Identity check (Pub 1345) | Cost |
|---|---|---|---|
| Pen signature returned by upload, fax, email or mail | **Live** | None required: p.17 says a handwritten form returned this way is not a remote electronic signature | $0 |
| Electronic signature in the office, ERO present | **Live** | Government photo ID inspected; name, SSN/ITIN last 4, address and DOB recorded. Returning client with a prior-year verified signing skips the ID step (p.16) | $0 |
| Electronic signature from home | **Built, switched off** | Credit-bureau KBA, NIST SP 800-63 level 2, 3 attempts then handwritten (p.16-17) | Vendor fee per check |

### Controls implemented

- Prepared form stored and hashed before signing; the sealed record is the form plus a signing certificate page, hashed again after sealing.
- Evidence rows (`efile_signature_evidence`, `efile_kba_attempts`) are append-only by database trigger. A signed authorization can only move to voided, and only while its return is draft or rejected.
- Retention date recorded per record: three years from the later of April 15 of the following year or the signing date.
- `verify` recomputes the sealed file's SHA-256 against the evidence row. `evidence-packet` exports every data point p.16 says the ERO must give the IRS on request.
- Pen-signed copies from the client link wait in "signed copy to review" until staff confirm they are signed and dated. Staff uploads require the same attestation.
- Transmission gate: `submitReturn` refuses to transmit until every live Form 8879 on the return is signed (p.30, rule 9).
- The ordinary-document signing path still rejects 8879/8878, so neither form can be signed without the controls above.

### Remote e-signing: what turns it on

`apps/api/src/services/kba-providers.ts` defines the vendor interface with LexisNexis and Experian adapters marked `implemented: false`. Remote signing turns on only when all three hold:

1. `EFILE_KBA_PROVIDER` names a vendor (Worker variable).
2. That adapter's `startQuiz`/`scoreQuiz` are written against the vendor's API spec (issued with the contract) and `implemented` is set to `true`.
3. `EFILE_KBA_API_KEY` is set (Worker secret).

The 3-attempt lockout, 15-minute pass window, and remote evidence fields (IP, login) are already enforced and tested. Still to build with the vendor: the taxpayer-facing quiz screens, and the third-party-data and soft-inquiry disclosures Pub 1345 p.17 asks software to show first.

### Known gaps

- SSN is recorded as last 4 only. The full SSN lives on the return in the firm's tax software. Pub 1345 says "record the... social security number"; storing the full number needs field-level encryption first.
- Truepost does not generate Form 8879 content. Staff upload the 8879 PDF their tax software produced. Generation arrives with the return engine (M8).
- The in-office signature is placed on an added certificate page bound to the form by hash, not stamped at the form's signature line coordinates.
- None of this has been reviewed by a tax attorney or the IRS. Claim "built to Publication 1345", not "IRS certified".

## Product language

Do not describe any of this as "IRS certified" or "IRS approved"; the IRS does not certify e-signature software. Accurate: "Form 8879 signing built to IRS Publication 1345 for pen signatures and in-office e-signatures."
