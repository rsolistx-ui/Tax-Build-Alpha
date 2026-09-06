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
} else {
  console.error("Unknown command. Use: seed-invite | revoke-by-email | find-firm-id-by-email | inventory-smoke-clients");
  process.exit(1);
}
