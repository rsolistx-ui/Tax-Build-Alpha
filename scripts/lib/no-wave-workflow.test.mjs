import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/**
 * Product-direction cleanup gate: Folio must not have any active
 * Wave-named/Wave-specific navigation, route, worksheet, or user-facing
 * copy. Historical decisions (README changelog-style prose, this file
 * itself) are allowed to mention the name Wave when explaining why it was
 * removed; active source is not.
 */
const SCAN_DIRS = [
  path.join(repoRoot, "apps", "api", "src"),
  path.join(repoRoot, "apps", "web", "src"),
];

const EXCLUDE_DIR_NAMES = new Set(["node_modules", "dist", ".git"]);

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIR_NAMES.has(entry)) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
}

test("no active Wave-specific operating workflow remains in API or web source", () => {
  const files = [];
  for (const dir of SCAN_DIRS) walk(dir, files);
  assert.ok(files.length > 0, "expected to find source files to scan");

  const offenders = [];
  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    if (/\bwave\b/i.test(content)) {
      offenders.push(path.relative(repoRoot, file));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Found active Wave-specific references in: ${offenders.join(", ")}`,
  );
});
