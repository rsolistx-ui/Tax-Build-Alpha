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
} else {
  console.error("Unknown command. Use: seed-invite | revoke-by-email | find-firm-id-by-email | inventory-smoke-clients | verify-clean");
  process.exit(1);
}
