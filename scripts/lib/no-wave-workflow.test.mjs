import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/**
 * Product-direction cleanup gate: Truepost must not depend on Wave as an
 * operating workflow or expose it as product branding. The small, explicit
 * migration adapter is allowed to name its source format so a practitioner
 * can leave Wave without manually rebuilding their books.
 */
const SCAN_DIRS = [
  path.join(repoRoot, "apps", "api", "src"),
  path.join(repoRoot, "apps", "web", "src"),
];

const EXCLUDE_DIR_NAMES = new Set(["node_modules", "dist", ".git"]);

// Files that legitimately reference "wave" (import/migration tools, not workflows)
const ALLOWED_WAVE_FILES = new Set([
  "apps/api/src/routes/wave-import.ts",
  "apps/api/src/services/wave-import.ts",
  "apps/api/src/services/wave-safe-import.ts",
  "apps/api/src/services/wave-safe-import.test.ts",
  "apps/api/src/services/wave-safe-import.integration.test.ts",
  "apps/api/src/index.ts", // routes registration
  "apps/web/src/components/accounting-import-modal.tsx",
].map(p => p.replace(/\//g, path.sep)));

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIR_NAMES.has(entry)) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
}

test("Wave references are limited to the explicit one-way migration adapter", () => {
  const files = [];
  for (const dir of SCAN_DIRS) walk(dir, files);
  assert.ok(files.length > 0, "expected to find source files to scan");

  const offenders = [];
  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    if (ALLOWED_WAVE_FILES.has(rel)) continue;
    const content = readFileSync(file, "utf-8");
    if (/\bwave\b/i.test(content)) {
      offenders.push(rel);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Found active Wave-specific references in: ${offenders.join(", ")}`,
  );
});
