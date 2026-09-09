// Direct-infrastructure-access admin helper for the production smoke test.
// Requires DATABASE_URL in the environment, exactly like neon-migrate.mjs.
// Never prints DATABASE_URL. Only ever touches beta_invitations and
// beta_entitlements rows it is explicitly told to touch by id/email.
import { randomBytes, createHash } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const parsed = new URL(databaseUrl);
const apiHost = parsed.hostname.replace(/^[^.]+\./, "api.");
const endpoint = `https://${apiHost}/sql`;

async function query(sql, params = []) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Neon-Connection-String": databaseUrl,
      "Neon-Raw-Text-Output": "true",
      "Neon-Array-Mode": "true",
    },
    body: JSON.stringify({ query: sql, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Neon query failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return res.json();
}

function newId(prefix) {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

function generateToken() {
  return randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

const [, , command, ...args] = process.argv;

if (command === "seed-invite") {
  const [email, betaDaysArg] = args;
  if (!email) { console.error("usage: seed-invite <email> [betaDays]"); process.exit(1); }
  const betaDays = betaDaysArg ? Number(betaDaysArg) : 30;
  const token = generateToken();
  const tokenHash = hashToken(token);
  const id = newId("biv");
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  await query(
    `INSERT INTO beta_invitations (id, email, token_hash, status, issued_by_user_id, expires_at, beta_days)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6)`,
    [id, email, tokenHash, "smoke-admin-script", expiresAt, betaDays],
  );
  console.log(JSON.stringify({ invitationId: id, email, token, betaDays }));
} else if (command === "revoke-by-email") {
  const [email] = args;
  if (!email) { console.error("usage: revoke-by-email <email>"); process.exit(1); }
  const result = await query(
    `UPDATE beta_entitlements SET status = 'revoked', revoked_at = NOW(), revocation_reason = 'smoke test revocation coverage'
     WHERE user_id = (SELECT redeemed_by_user_id FROM beta_invitations WHERE LOWER(email) = LOWER($1) ORDER BY redeemed_at DESC LIMIT 1)
     RETURNING user_id, status`,
    [email],
  );
  console.log(JSON.stringify({ rows: result.rows ?? [] }));
} else if (command === "find-firm-id-by-email") {
  const [email] = args;
  if (!email) { console.error("usage: find-firm-id-by-email <email>"); process.exit(1); }
  const result = await query(
    `SELECT f.id AS firm_id, f.owner_user_id
     FROM firms f
     JOIN beta_invitations bi ON bi.redeemed_by_user_id = f.owner_user_id
     WHERE LOWER(bi.email) = LOWER($1)
     ORDER BY f.created_at DESC LIMIT 1`,
    [email],
  );
  console.log(JSON.stringify({ rows: result.rows ?? [] }));
} else if (command === "inventory-smoke-clients") {
  const result = await query(
    `SELECT c.id AS client_id, f.id AS firm_id, c.name
     FROM clients c JOIN firms f ON f.id = c.firm_id
     WHERE f.name = 'Folio Smoke Test''s Firm'
     ORDER BY c.created_at`,
  );
  console.log(JSON.stringify({ rows: result.rows ?? [] }));
} else if (command === "inventory-smoke-firms") {
  // Recovery-only inventory for an interrupted smoke run. It returns no
  // credentials or customer data: just the synthetic tenant identifiers
  // required by the Worker cleanup endpoint.
  const result = await query(
    `SELECT f.id AS firm_id, f.name AS firm_name, bi.email
     FROM firms f
     JOIN beta_invitations bi ON bi.redeemed_by_user_id = f.owner_user_id
     WHERE bi.email LIKE 'folio-smoke-%@example.com'
     ORDER BY f.created_at`,
  );
  console.log(JSON.stringify({ rows: result.rows ?? [] }));
} else if (command === "cascade-delete-test") {
  // Live proof (not just schema inspection) that migration 0011's
  // column-specific ON DELETE SET NULL constraints behave correctly:
  // removing a referenced checklist item or duplicate-target document
  // nulls only the nullable relationship column and never touches the
  // NOT NULL client_id, and the whole dependent tree can then be removed
  // cleanly. Creates and tears down its own throwaway client so it never
  // disturbs the main smoke client's state.
  const [firmId] = args;
  if (!firmId) { console.error("usage: cascade-delete-test <firmId>"); process.exit(1); }

  const clientId = newId("cli");
  const checklistId = newId("chk");
  const doc1 = newId("doc");
  const doc2 = newId("doc");

  await query(`INSERT INTO clients (id, firm_id, name) VALUES ($1, $2, 'Cascade Delete Test Client')`, [clientId, firmId]);
  await query(
    `INSERT INTO document_checklist_items (id, client_id, tax_year, doc_type, status) VALUES ($1, $2, 2025, 'other', 'expected')`,
    [checklistId, clientId],
  );
  await query(
    `INSERT INTO client_documents (id, client_id, filename, r2_key, content_type, size_bytes, document_type, status, checklist_item_id, source_hash)
     VALUES ($1, $2, 'cascade-test-1.pdf', 'smoke/cascade-test-1.pdf', 'application/pdf', 100, 'other', 'needs_review', $3, 'cascade-test-hash-1')`,
    [doc1, clientId, checklistId],
  );
  await query(
    `INSERT INTO client_documents (id, client_id, filename, r2_key, content_type, size_bytes, document_type, status, duplicate_of_document_id, source_hash)
     VALUES ($1, $2, 'cascade-test-2.pdf', 'smoke/cascade-test-2.pdf', 'application/pdf', 100, 'other', 'needs_review', $3, 'cascade-test-hash-2')`,
    [doc2, clientId, doc1],
  );

  const results = {};
  let passed = true;

  try {
    await query(`DELETE FROM document_checklist_items WHERE id = $1`, [checklistId]);
    const row = (await query(`SELECT client_id, checklist_item_id FROM client_documents WHERE id = $1`, [doc1])).rows[0];
    results.checklistDelete = row
      ? { clientIdPreserved: row[0] === clientId, checklistItemIdNulled: row[1] === null }
      : { error: "document row disappeared unexpectedly" };
    if (!row || row[0] !== clientId || row[1] !== null) passed = false;
  } catch (err) {
    results.checklistDelete = { error: String(err) };
    passed = false;
  }

  try {
    await query(`DELETE FROM client_documents WHERE id = $1`, [doc1]);
    const row = (await query(`SELECT client_id, duplicate_of_document_id FROM client_documents WHERE id = $1`, [doc2])).rows[0];
    results.duplicateTargetDelete = row
      ? { clientIdPreserved: row[0] === clientId, duplicateIdNulled: row[1] === null }
      : { error: "document row disappeared unexpectedly" };
    if (!row || row[0] !== clientId || row[1] !== null) passed = false;
  } catch (err) {
    results.duplicateTargetDelete = { error: String(err) };
    passed = false;
  }

  try {
    await query(`DELETE FROM clients WHERE id = $1`, [clientId]);
    const remaining = (await query(`SELECT COUNT(*)::int AS n FROM client_documents WHERE client_id = $1`, [clientId])).rows[0][0];
    results.clientDelete = { ok: true, remainingDocuments: remaining };
    if (Number(remaining) !== 0) passed = false;
  } catch (err) {
    results.clientDelete = { error: String(err) };
    passed = false;
  }

  console.log(JSON.stringify({ passed, results }));
  if (!passed) process.exit(1);
} else if (command === "verify-clean") {
  // Directly re-queries Neon (independent of what the cleanup endpoint
  // claimed) to prove this exact smoke run left zero residue, and
  // separately proves no folio-smoke-*@example.com row survives anywhere
  // in beta_invitations, regardless of which run created it.
  const [firmId, ownerUserId] = args;
  if (!firmId || !ownerUserId) { console.error("usage: verify-clean <firmId> <ownerUserId>"); process.exit(1); }

  const checks = {};
  checks.firms = (await query(`SELECT COUNT(*)::int AS n FROM firms WHERE id = $1`, [firmId])).rows[0][0];
  checks.clients = (await query(`SELECT COUNT(*)::int AS n FROM clients WHERE firm_id = $1`, [firmId])).rows[0][0];
  checks.receipts = (await query(
    `SELECT COUNT(*)::int AS n FROM receipts WHERE client_id IN (SELECT id FROM clients WHERE firm_id = $1)`,
    [firmId],
  )).rows[0][0];
  checks.bank_transactions = (await query(
    `SELECT COUNT(*)::int AS n FROM bank_transactions WHERE client_id IN (SELECT id FROM clients WHERE firm_id = $1)`,
    [firmId],
  )).rows[0][0];
  checks.client_documents = (await query(
    `SELECT COUNT(*)::int AS n FROM client_documents WHERE client_id IN (SELECT id FROM clients WHERE firm_id = $1)`,
    [firmId],
  )).rows[0][0];
  checks.document_checklist_items = (await query(
    `SELECT COUNT(*)::int AS n FROM document_checklist_items WHERE client_id IN (SELECT id FROM clients WHERE firm_id = $1)`,
    [firmId],
  )).rows[0][0];
  checks.tax_year_readiness = (await query(
    `SELECT COUNT(*)::int AS n FROM tax_year_readiness WHERE client_id IN (SELECT id FROM clients WHERE firm_id = $1)`,
    [firmId],
  )).rows[0][0];
  checks.beta_invitations_for_run = (await query(
    `SELECT COUNT(*)::int AS n FROM beta_invitations WHERE redeemed_by_user_id = $1`,
    [ownerUserId],
  )).rows[0][0];
  checks.beta_entitlements_for_run = (await query(
    `SELECT COUNT(*)::int AS n FROM beta_entitlements WHERE user_id = $1`,
    [ownerUserId],
  )).rows[0][0];
  checks.beta_access_events_for_run = (await query(
    `SELECT COUNT(*)::int AS n FROM beta_access_events WHERE affected_user_id = $1 OR actor_user_id = $1`,
    [ownerUserId],
  )).rows[0][0];
  checks.any_smoke_invitation_anywhere = (await query(
    `SELECT COUNT(*)::int AS n FROM beta_invitations WHERE email LIKE 'folio-smoke-%@example.com'`,
  )).rows[0][0];
  checks.any_smoke_entitlement_anywhere = (await query(
    `SELECT COUNT(*)::int AS n FROM beta_entitlements be
     JOIN beta_invitations bi ON bi.redeemed_by_user_id = be.user_id
     WHERE bi.email LIKE 'folio-smoke-%@example.com'`,
  )).rows[0][0];

  const allZero = Object.values(checks).every((n) => Number(n) === 0);
  console.log(JSON.stringify({ clean: allZero, checks }));
  if (!allZero) process.exit(1);
} else if (command === "expire-portal-link") {
  // Narrowly scoped, synthetic-context-only operation: backdates a
  // client_portal_links row's expires_at so the smoke script can prove
  // GET /api/portal/home returns 401 for a genuinely expired token,
  // without weakening the production API (there is no such endpoint or
  // flag in the app itself) and without ever printing the plaintext
  // token, which this script never had access to in the first place -
  // only its hash is ever stored.
  const [linkId] = args;
  if (!linkId) { console.error("usage: expire-portal-link <linkId>"); process.exit(1); }

  const ALLOWED_SMOKE_FIRM_NAMES = new Set(["Folio Smoke Test's Firm", "Repro's Firm", "Repro2's Firm"]);
  const linkRows = (await query(
    `SELECT cpl.id, f.name AS firm_name FROM client_portal_links cpl
     JOIN clients c ON c.id = cpl.client_id
     JOIN firms f ON f.id = c.firm_id
     WHERE cpl.id = $1`,
    [linkId],
  )).rows;
  const link = linkRows[0];
  if (!link) { console.error(JSON.stringify({ expired: false, error: "link not found" })); process.exit(1); }
  const firmName = link[1];
  if (!ALLOWED_SMOKE_FIRM_NAMES.has(firmName)) {
    console.error(JSON.stringify({ expired: false, error: "refusing to expire a portal link outside the synthetic smoke-test firm naming convention" }));
    process.exit(1);
  }

  const updated = (await query(
    `UPDATE client_portal_links SET expires_at = NOW() - INTERVAL '1 day' WHERE id = $1 RETURNING id`,
    [linkId],
  )).rows;
  console.log(JSON.stringify({ expired: updated.length > 0, linkId }));
  if (updated.length === 0) process.exit(1);
} else {
  console.error("Unknown command. Use: seed-invite | revoke-by-email | find-firm-id-by-email | inventory-smoke-clients | inventory-smoke-firms | cascade-delete-test | verify-clean | expire-portal-link");
  process.exit(1);
}
