import type { Db } from "../db";
import { newId } from "../lib/id";
import { sha256Hex } from "./documents";

/**
 * Truepost service agreement between Solis Equity Holdings LLC and a subscribing firm.
 * It is the written service-provider contract required by the FTC Safeguards Rule,
 * 16 CFR 314.4(f)(2), and records the IRC § 7216 limits on Truepost's use of tax return
 * information. Every safeguard stated here is implemented in this codebase; do not add
 * a promise the product does not keep. Changing the text requires a new version.
 */
export const AGREEMENT_VERSION = "2026-09-23";

export const AGREEMENT_TEXT = `TRUEPOST SERVICE AGREEMENT
Version ${AGREEMENT_VERSION}

1. Parties. This agreement is between Solis Equity Holdings LLC, which operates Truepost ("Provider"), and the accounting, bookkeeping or tax practice that uses Truepost ("Firm"). The person accepting confirms they have authority to bind the Firm.

2. The service. Truepost is software for organizing client evidence, keeping books, preparing workpapers, requesting documents and collecting signatures. Truepost does not prepare or file tax returns, give tax or legal advice, or make determinations about any tax position. Every figure, category and suggestion it produces is a draft for the Firm's review. The Firm remains solely responsible for its professional work, including its obligations under Treasury Circular 230, IRC § 6694 and applicable state law.

3. Customer information. "Customer information" means the nonpublic personal information about the Firm's clients that the Firm places in Truepost. The Firm owns its data. Provider uses customer information only to provide Truepost to the Firm. Provider does not sell customer information, use it for advertising, or use it to train or improve any artificial intelligence model.

4. Tax return information (IRC § 7216). Provider receives tax return information as a provider of auxiliary services in connection with the Firm's tax return preparation (Treas. Reg. § 301.7216-1(b)(2)(i)(B)) and discloses it only to the subprocessors listed in section 7 and only to perform the service. When Truepost is configured to use a processing service that may operate outside the United States, or that suggests categories, Truepost requires the client's signed consent under Treas. Reg. § 301.7216-3 before sending that client's documents, and provides the consent form. The Firm is responsible for obtaining any other consent the law requires of it.

5. Safeguards (16 CFR 314.4(f)). Provider implements and maintains these safeguards:
  (a) Encryption of customer information in transit (HTTPS with HSTS) and at rest (provider-managed encryption of the database and file storage).
  (b) Multi-factor sign-in for Firm users, with an authenticator app and single-use backup codes.
  (c) Separation of each Firm's data by access checks on every request.
  (d) An append-only audit trail for signatures, consents, receipts, bank decisions, rule changes and returns.
  (e) Tamper-evident signature and consent records with SHA-256 fingerprints and integrity checks.
  (f) An option to limit automated document reading to services that process data only in the United States.
  (g) Access to production systems limited to Provider personnel who need it to operate the service.

6. Security incidents. Provider will notify the Firm by email without unreasonable delay, and no later than 72 hours after confirming unauthorized access to the Firm's customer information, describing what is known and the steps being taken. Provider will cooperate so the Firm can meet its own notice duties, including notice to the Federal Trade Commission under 16 CFR 314.4(j) and state breach laws.

7. Subprocessors. Provider uses: Cloudflare, Inc. (hosting and file storage); Neon, Inc. (database); and, when enabled, Microsoft Corporation (Azure document reading and category suggestions, United States regions), Amazon Web Services, Inc. (Amazon Textract, United States regions), Cloudflare Workers AI, Groq, Inc. and Google LLC (document reading), Resend, Inc. (email delivery), Stripe, Inc. (payments), Plaid Inc. (bank connections) and Twilio Inc. (text messages). Provider will give notice before adding a subprocessor that receives customer information.

8. Firm responsibilities. The Firm will keep sign-in credentials confidential, turn on multi-factor sign-in for every user, maintain its own written information security program, review Truepost's output before relying on it, and obtain client consents and signatures where the law requires.

9. Export, retention and deletion. The Firm may download a complete export of each client's data at any time. After the Firm closes its account, Provider will delete customer information within 30 days of the Firm's written request, except records Provider must keep by law or that the Firm designated for retention, such as signed Form 8879 evidence, which is kept for its retention period.

10. Fees. Fees are as stated in the Firm's order, invoice or subscription page.

11. Disclaimers. Apart from the commitments in sections 3 to 7 and 9, Truepost is provided "as is." Provider does not warrant that Truepost is error-free or that any tax result will be achieved.

12. Limitation of liability. Except for breach of sections 3, 4 or 6, or a party's gross negligence or willful misconduct, each party's total liability under this agreement is limited to the fees the Firm paid Provider in the twelve months before the claim. Neither party is liable for indirect or consequential damages.

13. Term and changes. This agreement lasts while the Firm uses Truepost. Provider will give at least 30 days' notice of material changes, and continued use after a new version requires acceptance of that version.

14. Governing law. This agreement is governed by the laws of the state in which Solis Equity Holdings LLC is organized, without regard to conflict-of-law rules.`;

export async function agreementStatus(db: Db, userId: string) {
  const [row] = await db.query<{ accepted_at: string; accepted_name: string }>(
    `SELECT accepted_at, accepted_name FROM firm_agreements WHERE user_id=$1 AND agreement_version=$2`, [userId, AGREEMENT_VERSION]);
  return { version: AGREEMENT_VERSION, accepted: Boolean(row), acceptedAt: row?.accepted_at ?? null };
}

export async function acceptAgreement(db: Db, input: { firmId: string; userId: string; typedName: string; ip: string | null; userAgent: string | null }) {
  const name = input.typedName.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new Error("Type your full name to accept.");
  const hash = await sha256Hex(new TextEncoder().encode(AGREEMENT_TEXT).buffer as ArrayBuffer);
  await db.query(
    `INSERT INTO firm_agreements (id, firm_id, user_id, agreement_version, text_sha256, accepted_name, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id, agreement_version) DO NOTHING`,
    [newId("agr"), input.firmId, input.userId, AGREEMENT_VERSION, hash, name, input.ip, input.userAgent],
  );
  return { version: AGREEMENT_VERSION, textSha256: hash };
}
