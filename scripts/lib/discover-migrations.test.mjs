import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverMigrationFiles } from "./discover-migrations.mjs";

test("discovers only .sql files, sorted deterministically, including a newly added 0005 migration", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "folio-migrate-test-"));
  try {
    await writeFile(path.join(dir, "0003_bank_exceptions.sql"), "-- noop");
    await writeFile(path.join(dir, "0001_married_spine.sql"), "-- noop");
    await writeFile(path.join(dir, "0005_release_gate.sql"), "-- noop");
    await writeFile(path.join(dir, "0002_bank_reconciliation.sql"), "-- noop");
    await writeFile(path.join(dir, "0004_bookkeeping_core.sql"), "-- noop");
    await writeFile(path.join(dir, "README.md"), "not a migration");
    await writeFile(path.join(dir, "notes.txt"), "not a migration");

    const found = await discoverMigrationFiles(dir);
    const names = found.map((p) => path.basename(p));

    assert.deepEqual(names, [
      "0001_married_spine.sql",
      "0002_bank_reconciliation.sql",
      "0003_bank_exceptions.sql",
      "0004_bookkeeping_core.sql",
      "0005_release_gate.sql",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sorts a future 0006 migration after 0005 without any code changes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "folio-migrate-test-"));
  try {
    await writeFile(path.join(dir, "0006_next_thing.sql"), "-- noop");
    await writeFile(path.join(dir, "0005_release_gate.sql"), "-- noop");

    const found = await discoverMigrationFiles(dir);
    const names = found.map((p) => path.basename(p));

    assert.deepEqual(names, ["0005_release_gate.sql", "0006_next_thing.sql"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
