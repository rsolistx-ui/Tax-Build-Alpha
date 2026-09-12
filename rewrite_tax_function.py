with open('C:\\Tax Build Alpha\\apps\\api\\src\\routes\\tax-adjustment.ts', 'r') as f:
    content = f.read()

# Find the exact function and rewrite it
idx = content.find('taxAdjustmentRoutes.post("/:clientId/tax-adjustments/:journalId/lines"')
if idx >= 0:
    end_idx = content.find('// Post tax adjustment journal', idx)
    if end_idx >= 0:
        print(f'Found section from {idx} to {end_idx}')
        replacement = '''// Add lines to tax adjustment journal
taxAdjustmentRoutes.post("/:clientId/tax-adjustments/:journalId/lines", async (c) => {
  const db = createDb(c.env);
  const firm = await ensureFirm(db, c.get("userId"), c.get("userName"));
  const client = await getClient(db, c.req.param("clientId"), firm.id);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const body = z.object({
    lines: z.array(z.object({
      accountId: z.string(),
      taxLineId: z.string().optional(),
      description: z.string().optional(),
      debit: z.number().nonnegative().default(0),
      credit: z.number().nonnegative().default(0),
      currency: z.string().length(3).default("USD"),
      exchangeRate: z.number().positive().default(1),
      isTaxOnly: z.boolean().default(false),
    })).min(1),
  }).parse(await c.req.json());

  const journalId = c.req.param("journalId");
  const [journal] = await db.query<any>(
    `SELECT * FROM tax_adjustment_journals WHERE id = $1 AND client_id = $2 AND firm_id = $3 AND status = 'draft'`,
    [c.req.param("journalId"), client.id, firm.id],
  );
  if (!journal) return c.json({ error: "Journal not found or not in draft status" }, 404);

  const lines = await addTaxAdjustmentJournalLines(db, journalId, body.lines.map(l => ({
    account_id: l.accountId,
    tax_line_id: l.taxLineId ?? null,
    description: l.description ?? null,
    debit: l.debit,
    credit: l.credit,
    currency: l.currency ?? "USD",
    exchange_rate: l.exchangeRate ?? 1,
    is_tax_only: l.isTaxOnly ?? false,
  }));
  return c.json({ lines });
});'''

        new_content = content[:idx] + replacement + content[end_idx:]
        with open('C:\\Tax Build Alpha\\apps\\api\\src\\routes\\tax-adjustment.ts', 'w') as f:
            f.write(new_content)
        print('Rewrote function successfully')
    else:
        print('Could not find end')
else:
    print('Could not find function start')