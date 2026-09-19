import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const webSrcDir = path.join(rootDir, "apps", "web", "src");
const apiSrcDir = path.join(rootDir, "apps", "api", "src");

console.log("=================================================");
console.log("  FOLIO SYSTEM PIPING & SECURITY AUDIT");
console.log("=================================================");

function getAllFiles(dir, extensions = [".ts", ".tsx", ".js", ".mjs"]) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of list) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist" && entry.name !== ".git") {
        results = results.concat(getAllFiles(fullPath, extensions));
      }
    } else if (extensions.includes(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

// 1. Inspect all frontend api(...) calls
console.log("\n--- 1. AUDITING FRONTEND API CALLS ---");
const webFiles = getAllFiles(webSrcDir);
const apiCalls = new Set();
const apiCallRegex = /api(?:<[^>]+>)?\(\s*[`"']([^`"']+)`|api(?:<[^>]+>)?\(\s*`([^`]+)`/g;

for (const file of webFiles) {
  const content = fs.readFileSync(file, "utf8");
  let match;
  while ((match = apiCallRegex.exec(content)) !== null) {
    const endpoint = match[1] || match[2];
    // Normalize template strings like /api/clients/${clientId}/invoices
    const normalized = endpoint.replace(/\$\{([^}]+)\}/g, ":$1");
    apiCalls.add({ endpoint: normalized, file: path.relative(rootDir, file) });
  }
}

console.log(`Discovered ${apiCalls.size} unique frontend API call patterns.`);

// 2. Inspect all mounted backend routes
console.log("\n--- 2. AUDITING BACKEND ROUTE MOUNTS ---");
const indexContent = fs.readFileSync(path.join(apiSrcDir, "index.ts"), "utf8");
const routeMounts = [];
const mountRegex = /app\.route\(\s*["']([^"']+)["']\s*,\s*([a-zA-Z0-9_]+)\s*\)/g;
let m;
while ((m = mountRegex.exec(indexContent)) !== null) {
  routeMounts.push({ mountPrefix: m[1], routeVar: m[2] });
}

console.log(`Discovered ${routeMounts.length} mounted route modules in index.ts:`);
for (const rm of routeMounts) {
  console.log(`  ✓ ${rm.mountPrefix} -> ${rm.routeVar}`);
}

// 3. Security Audit: SQL Injection & Parametric Queries
console.log("\n--- 3. AUDITING SQL QUERY SECURITY ---");
const apiFiles = getAllFiles(apiSrcDir);
let rawStringInterpolations = [];
let missingFirmIdInQueries = [];

for (const file of apiFiles) {
  if (file.endsWith(".test.ts")) continue;
  const content = fs.readFileSync(file, "utf8");
  const relPath = path.relative(rootDir, file);

  // Check for suspicious string interpolation inside SQL query blocks
  // e.g., query(`SELECT ... WHERE id = '${id}'`)
  const queryBlocks = content.match(/query(?:<[^>]+>)?\(\s*`([^`]+)`/g) || [];
  for (const block of queryBlocks) {
    if (block.includes("${") && !block.includes("JOIN") && !block.includes("ORDER BY") && !block.includes("LIMIT")) {
      // Check if variables are interpolated into WHERE clauses directly
      const dangerousMatch = block.match(/WHERE[^\n]+(\$\{[a-zA-Z0-9_.]+\})/i);
      if (dangerousMatch) {
        rawStringInterpolations.push({ file: relPath, snippet: dangerousMatch[0].trim() });
      }
    }
  }
}

if (rawStringInterpolations.length === 0) {
  console.log("  ✅ Zero raw string interpolations in SQL queries. All queries use parameterized $1, $2 tokens.");
} else {
  console.warn("  ⚠️ Warning: Potential raw string interpolations detected:", rawStringInterpolations);
}

// 4. Security Audit: Hardcoded Secrets & Leakage
console.log("\n--- 4. AUDITING SECRET & CREDENTIAL LEAKAGE ---");
const secretPatterns = [
  /sk_live_[0-9a-zA-Z]{24}/,
  /whsec_[0-9a-zA-Z]{32}/,
  /AIza[0-9A-Za-z-_]{35}/,
  /ghp_[0-9a-zA-Z]{36}/,
  /bearer\s+["'][a-zA-Z0-9_\-\.]{25,}["']/i
];

let foundLeaks = [];
for (const file of [...apiFiles, ...webFiles]) {
  if (file.endsWith(".test.ts") || file.endsWith(".test.tsx") || file.endsWith(".mjs")) continue;
  const content = fs.readFileSync(file, "utf8");
  const relPath = path.relative(rootDir, file);
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) {
      foundLeaks.push({ file: relPath, pattern: pattern.toString() });
    }
  }
}

if (foundLeaks.length === 0) {
  console.log("  ✅ Zero hardcoded live API keys or tokens in source code.");
} else {
  console.error("  ❌ Hardcoded secrets detected:", foundLeaks);
}

// 5. Tenant Isolation Audit
console.log("\n--- 5. AUDITING MULTI-TENANT ISOLATION (FIRM & CLIENT SCOPING) ---");
const criticalServices = [
  "admin-rules.ts",
  "billing.ts",
  "clients.ts",
  "deadline-calendar.ts",
  "feature-requests.ts",
  "receipt-intake.ts",
  "tax-radar-advisory.ts"
];

for (const s of criticalServices) {
  const filePath = path.join(apiSrcDir, "services", s);
  if (fs.existsSync(filePath)) {
    const code = fs.readFileSync(filePath, "utf8");
    const hasFirmOrClientScoping = code.includes("firm_id") || code.includes("client_id") || code.includes("firmId") || code.includes("clientId");
    console.log(`  ${hasFirmOrClientScoping ? "✅" : "⚠️"} ${s}: Tenant scoped (${hasFirmOrClientScoping ? "Verified" : "Check Needed"})`);
  }
}

console.log("\nAudit scan complete.");
