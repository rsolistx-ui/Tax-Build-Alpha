import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// A Hono sub-app's use("*") applies to its whole mount prefix, so every
// sub-app mounted at /api/clients that adds its own session/beta middleware
// makes EVERY /api/clients request run that middleware again. index.ts gates
// the prefix once; route files mounted there must not add their own.
const srcDir = join(__dirname, "..");
const index = readFileSync(join(srcDir, "index.ts"), "utf8");
const mounted = [...new Set([...index.matchAll(/app\.route\("\/api\/clients", (\w+)\)/g)].map((m) => m[1]))];
const routeFiles = readdirSync(__dirname).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("/api/clients middleware is applied exactly once", () => {
  it("index.ts gates the /api/clients prefix with session and beta checks, before any client route is mounted", () => {
    const gate = index.indexOf('app.use("/api/clients/*", requireSession, requireActiveBeta);');
    expect(gate).toBeGreaterThan(-1);
    // Hono runs middleware in registration order; a gate added after the routes protects nothing.
    expect(gate).toBeLessThan(index.indexOf('app.route("/api/clients",'));
  });

  it("no route file mounted at /api/clients adds its own prefix-wide middleware", () => {
    expect(mounted.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const name of mounted) {
      const file = routeFiles.find((f) => readFileSync(join(__dirname, f), "utf8").includes(`export const ${name} `));
      if (!file) continue;
      if (readFileSync(join(__dirname, file), "utf8").includes(`${name}.use("*"`)) offenders.push(`${file} (${name})`);
    }
    expect(offenders).toEqual([]);
  });
});
