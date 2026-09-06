import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const tauriDir = path.join(scriptDir, "..", "..", "src-tauri");

const FORBIDDEN_PATTERNS = [
  /DATABASE_URL\s*=\s*['"]?postgres/i,
  /BETTER_AUTH_SECRET\s*[:=]/i,
  /CLOUDFLARE_API_TOKEN/i,
  /cfut_[A-Za-z0-9]/,
  /GEMINI_API_KEY\s*[:=]/i,
  /SMOKE_CLEANUP_TOKEN\s*[:=]\s*['"][^'"]+['"]/i,
  /neon\.tech\/[^"'\s]*password/i,
];

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "target" || entry.name === "gen") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else if (/\.(json|toml|rs)$/i.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

test("Tauri desktop configuration and source contain no secrets or credentials", async () => {
  const files = await collectFiles(tauriDir);
  assert.ok(files.length > 0, "expected to find Tauri config/source files");

  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.doesNotMatch(content, pattern, `${file} appears to contain a secret matching ${pattern}`);
    }
  }
});

test("Tauri window loads the real production origin, not a local or bundled frontend", async () => {
  const confPath = path.join(tauriDir, "tauri.conf.json");
  const conf = JSON.parse(await readFile(confPath, "utf8"));
  assert.match(conf.build.frontendDist, /^https:\/\/folio-api\.rsolistx\.workers\.dev/);

  const libRsPath = path.join(tauriDir, "src", "lib.rs");
  const libRs = await readFile(libRsPath, "utf8");
  assert.match(libRs, /PRODUCTION_URL:\s*&str\s*=\s*"https:\/\/folio-api\.rsolistx\.workers\.dev"/);
  assert.match(libRs, /ALLOWED_HOST:\s*&str\s*=\s*"folio-api\.rsolistx\.workers\.dev"/);
  assert.match(libRs, /on_navigation/, "expected the desktop window to restrict navigation to the production origin");
});
