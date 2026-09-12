with open('C:\\Tax Build Alpha\\apps\\api\\src\\routes\\tax-adjustment.ts', 'rb') as f:
    content = f.read()

# Find the exact problematic section and rewrite it completely
start_idx = content.find(b'const lines = await addTaxAdjustmentJournalLines')
if start_idx >= 0:
    end_idx = content.find(b'// Post tax adjustment journal', start_idx)
    if end_idx >= 0:
        print(f'Found section from {start_idx} to {end_idx}')
        replacement = b'''const lines = await addTaxAdjustmentJournalLines(db, journalId, body.lines.map(l => ({
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
});

// Post tax adjustment journal'''
        new_content = content[:start_idx] + replacement + content[end_idx:]
        with open('C:\\Tax Build Alpha\\apps\\api\\src\\routes\\tax-adjustment.ts', 'wb') as f:
            f.write(new_content)
        print('Replaced section successfully')
    else:
        print('Could not find end')
else:
    print('Could not find start')