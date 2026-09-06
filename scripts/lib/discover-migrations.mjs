import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Discovers Neon migration files deterministically: only *.sql files,
 * sorted by plain filename comparison (not locale-aware) so the order is
 * identical on Windows and Linux and never depends on OS collation. A
 * zero-padded numeric prefix (0001_, 0002_, ...) therefore always sorts in
 * numeric order regardless of what comes after it.
 */
export async function discoverMigrationFiles(dir) {
  const entries = await readdir(dir);
  return entries
    .filter((name) => name.toLowerCase().endsWith(".sql"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => path.join(dir, name));
}
