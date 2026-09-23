import { describe, expect, it } from "vitest";
import type { Db, DbStatement } from "../db";
import type { Env } from "../env";
import { runConsentOutreach } from "./consent-outreach";

function mockDb(due: unknown[]) {
  const statements: DbStatement[] = [];
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) { statements.push({ query: sql, params }); return (sql.includes("FROM clients c JOIN firms") ? due : []) as T[]; },
    async transaction<T>(batch: DbStatement[]) { statements.push(...batch); return batch.map(() => []) as T[][]; },
  };
  return { db, statements };
}
const due = [{ client_id: "cli_1", firm_id: "firm_1", client_name: "Pat Client", email: "pat@example.com", firm_name: "Example Tax" }];

describe("consent outreach", () => {
  it("does nothing when reading stays in the US", async () => {
    const env = { US_ONLY_READING: "true", AZURE_DI_ENDPOINT: "https://x", AZURE_DI_KEY: "k", AZURE_DI_REGION: "eastus" } as unknown as Env;
    expect(await runConsentOutreach(mockDb(due).db, env)).toEqual({ status: "not_required", sent: 0, waiting: 0 });
  });

  it("reports waiting clients instead of pretending to send when email is not set up", async () => {
    expect(await runConsentOutreach(mockDb(due).db, { AI: {} } as unknown as Env)).toEqual({ status: "email_not_configured", sent: 0, waiting: 1 });
  });

  it("emails a signing link and records the attempt", async () => {
    const sent: Array<{ to: string[]; subject: string; text: string }> = [];
    const fake = (async (_url: string, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const { db, statements } = mockDb(due);
    const result = await runConsentOutreach(db, { AI: {}, RESEND_API_KEY: "re_x", APP_ORIGIN: "https://app.example" } as unknown as Env, { fetch: fake });
    expect(result).toEqual({ status: "sent", sent: 1, waiting: 0 });
    expect(sent[0].to).toEqual(["pat@example.com"]);
    expect(sent[0].text).toContain("https://app.example/consent#token=");
    expect(sent[0].text).toContain("You are not required to sign");
    expect(statements.some((s) => s.query.includes("consent_link_emailed"))).toBe(true);
  });
});
