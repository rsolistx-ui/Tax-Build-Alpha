// Migration-content test: no live Postgres is available in this sandbox to
// prove the database actually rejects a cross-tenant insert at runtime, so
// this instead deterministically verifies migration 0012 defines every
// composite tenant-safe foreign key the schema is supposed to enforce -
// the same constraint definitions verify-neon-schema.mjs checks for after
// a real deployment. This is a weaker guarantee than a live rejection
// test and is reported as such; it catches the migration regressing
// (a constraint silently removed or never added) even without a database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(__dirname, "..", "..", "migrations", "neon", "0012_practice_os.sql");
const sql = readFileSync(migrationPath, "utf8");

const requiredCompositeForeignKeys = [
  ["fk_engagements_client_same_firm", "REFERENCES clients(id, firm_id)"],
  ["fk_work_items_client_same_firm", "REFERENCES clients(id, firm_id)"],
  ["fk_work_items_engagement_same_client", "REFERENCES engagements(id, client_id)"],
  ["fk_requests_client_same_firm", "REFERENCES clients(id, firm_id)"],
  ["fk_requests_work_item_same_client", "REFERENCES work_items(id, client_id)"],
  ["fk_requests_bank_txn_same_client", "REFERENCES bank_transactions(id, client_id)"],
  ["fk_messages_request_same_client", "REFERENCES client_requests(id, client_id)"],
  ["fk_documents_request_same_client", "REFERENCES client_requests(id, client_id)"],
  ["fk_portal_links_client_same_firm", "REFERENCES clients(id, firm_id)"],
  ["fk_messages_client_same_firm", "REFERENCES clients(id, firm_id)"],
];

for (const [name, referencesClause] of requiredCompositeForeignKeys) {
  test(`migration 0012 defines ${name} as a composite FK ${referencesClause}`, () => {
    const constraintIndex = sql.indexOf(`ADD CONSTRAINT ${name}`);
    assert.ok(constraintIndex !== -1, `${name} is not defined in migration 0012`);
    const nearby = sql.slice(constraintIndex, constraintIndex + 400);
    assert.ok(
      nearby.includes(referencesClause),
      `${name} does not reference ${referencesClause} within its definition:\n${nearby}`,
    );
  });
}

const requiredUniqueAnchors = [
  "uq_clients_id_firm",
  "uq_bank_transactions_id_client",
  "uq_engagements_id_firm",
  "uq_engagements_id_client",
  "uq_work_items_id_firm",
  "uq_work_items_id_client",
  "uq_requests_id_firm",
  "uq_requests_id_client",
];

for (const name of requiredUniqueAnchors) {
  test(`migration 0012 defines the tenant-safety unique anchor ${name}`, () => {
    assert.ok(sql.includes(`CONSTRAINT ${name} UNIQUE`), `${name} is not defined in migration 0012`);
  });
}

test("migration 0012 nullable tenant-scoped FKs use column-specific ON DELETE SET NULL, never nulling the tenant column", () => {
  const nullableFkColumnSpecific = [
    ["fk_work_items_engagement_same_client", "SET NULL (engagement_id)"],
    ["fk_requests_work_item_same_client", "SET NULL (work_item_id)"],
    ["fk_requests_bank_txn_same_client", "SET NULL (related_bank_transaction_id)"],
    ["fk_documents_request_same_client", "SET NULL (request_id)"],
  ];
  for (const [name, setNullClause] of nullableFkColumnSpecific) {
    const constraintIndex = sql.indexOf(`ADD CONSTRAINT ${name}`);
    assert.ok(constraintIndex !== -1, `${name} is not defined`);
    const nearby = sql.slice(constraintIndex, constraintIndex + 400);
    assert.ok(nearby.includes(setNullClause), `${name} does not use column-specific ${setNullClause}`);
  }
});

test("migration 0012 defines the race-safe partial unique index for exception-request idempotency", () => {
  assert.ok(sql.includes("CREATE UNIQUE INDEX IF NOT EXISTS uq_requests_active_bank_txn"));
  assert.ok(sql.includes("WHERE related_bank_transaction_id IS NOT NULL AND status != 'cancelled'"));
});

test("migration 0012 contains no malformed single-dollar anonymous DO blocks", () => {
  assert.doesNotMatch(sql, /DO $ BEGIN/, "found a malformed 'DO $ BEGIN' - anonymous blocks must use $$ dollar-quoting");
  assert.doesNotMatch(sql, /END $;/, "found a malformed 'END $;' - anonymous blocks must close with $$;");
});


test("migration 0012's DO $$ ... END $$ blocks are correctly paired, not just substring-matched", () => {
  const openCount = (sql.match(/DO \$\$ BEGIN/g) || []).length;
  const closeCount = (sql.match(/END \$\$;/g) || []).length;
  assert.ok(openCount > 0, "expected at least one DO $$ BEGIN block in migration 0012");
  assert.equal(openCount, closeCount, `found ${openCount} 'DO $$ BEGIN' openings but ${closeCount} 'END $$;' closings - an anonymous block is unbalanced`);

  const openIndices = [...sql.matchAll(/DO \$\$ BEGIN/g)].map((m) => m.index);
  const closeIndices = [...sql.matchAll(/END \$\$;/g)].map((m) => m.index);
  for (let i = 0; i < openIndices.length; i++) {
    assert.ok(closeIndices[i] > openIndices[i], `DO $$ BEGIN at offset ${openIndices[i]} has no matching END $$; after it`);
  }
});
