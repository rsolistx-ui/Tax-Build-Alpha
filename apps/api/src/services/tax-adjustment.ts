import type { Db, DbStatement } from "../db";
import { newId } from "../lib/id";

export type TaxAdjustmentType =
  | "book_to_tax"
  | "permanent_diff"
  | "temporary_diff"
  | "reclassification"
  | "carryforward"
  | "rate_change"
  | "state_mod"
  | "other";

export type TaxAdjustmentSourceType =
  | "manual"
  | "import"
  | "auto_depreciation"
  | "auto_accrual"
  | "auto_reserve"
  | "carryforward_calc";

export type TaxAdjustmentJournal = {
  id: string;
  firm_id: string;
  client_id: string;
  engagement_id: string | null;
  tax_year: number;
  period_end: string;
  adjustment_type: TaxAdjustmentType;
  source_type: TaxAdjustmentSourceType;
  source_id: string | null;
  memo: string | null;
  status: "draft" | "posted" | "reversed";
  posted_at: string | null;
  posted_by_user_id: string | null;
  reversed_journal_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TaxAdjustmentJournalLine = {
  id: string;
  journal_id: string;
  account_id: string;
  tax_line_id: string | null;
  description: string | null;
  debit: number;
  credit: number;
  currency: string;
  exchange_rate: number;
  is_tax_only: boolean;
  created_at: string;
};

export type TaxFormMapping = {
  id: string;
  firm_id: string;
  tax_form: string;
  tax_year: number;
  form_line_code: string;
  form_line_label: string;
  account_id: string | null;
  mapping_type: "direct" | "aggregation" | "calculation" | "manual_entry";
  calculation_formula: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TaxOnlyAccount = {
  id: string;
  firm_id: string;
  code: string;
  name: string;
  tax_form: string;
  tax_line_code: string;
  account_type: "m1_adjustment" | "m3_adjustment" | "permanent_diff" | "temporary_diff" | "state_mod" | "carryforward" | "credit" | "amt" | "other";
  normal_balance: "debit" | "credit";
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type M1Reconciliation = {
  id: string;
  firm_id: string;
  client_id: string;
  tax_year: number;
  book_net_income: number;
  taxable_income: number;
  status: "draft" | "finalized";
  finalized_at: string | null;
  finalized_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type M1ReconciliationLine = {
  id: string;
  reconciliation_id: string;
  line_code: string;
  line_label: string;
  line_category: string;
  amount: number;
  source_journal_id: string | null;
  sort_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type StateTaxModification = {
  id: string;
  firm_id: string;
  client_id: string;
  state: string;
  tax_year: number;
  modification_type: "addition" | "subtraction" | "apportionment" | "credit" | "other";
  description: string;
  amount: number;
  federal_line_code: string | null;
  state_line_code: string | null;
  apportionment_factor: number | null;
  source_journal_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TaxCarryforward = {
  id: string;
  firm_id: string;
  client_id: string;
  carryforward_type: "nol_federal" | "nol_state" | "capital_loss" | "charitable" | "general_business_credit" | "foreign_tax_credit" | "amt_credit" | "section_179" | "section_163j" | "state_nol" | "state_credit" | "amt" | "other";
  state: string | null;
  tax_year_generated: number;
  tax_year_expires: number | null;
  original_amount: number;
  remaining_amount: number;
  used_amount: number;
  status: "active" | "expired" | "fully_used" | "abandoned";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type TaxCarryforwardUtilization = {
  id: string;
  carryforward_id: string;
  tax_year_used: number;
  amount_used: number;
  return_type: string;
  source_journal_id: string | null;
  created_at: string;
};

/**
 * Create a tax adjustment journal
 */
export async function createTaxAdjustmentJournal(
  db: Db,
  input: {
    firmId: string;
    clientId: string;
    engagementId?: string;
    taxYear: number;
    periodEnd: string;
    adjustmentType: TaxAdjustmentType;
    sourceType?: TaxAdjustmentSourceType;
    sourceId?: string;
    memo?: string;
  }
): Promise<TaxAdjustmentJournal> {
  const id = newId("taj");
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO tax_adjustment_journals
      (id, firm_id, client_id, engagement_id, tax_year, period_end, adjustment_type, source_type, source_id, memo, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', $11, $12)`,
    [
      id, input.firmId, input.clientId, input.engagementId ?? null,
      input.taxYear, input.periodEnd, input.adjustmentType,
      input.sourceType ?? "manual", input.sourceId ?? null, input.memo ?? null,
      now, now
    ],
  );

  const [row] = await db.query<any>(
    `SELECT * FROM tax_adjustment_journals WHERE id = $1`,
    [id],
  );
  return mapTaxAdjustmentJournal(row);
}

/**
 * Add lines to a tax adjustment journal
 */
export async function addTaxAdjustmentJournalLines(
  db: Db,
  journalId: string,
  lines: Omit<TaxAdjustmentJournalLine, "id" | "journal_id" | "created_at">[]
): Promise<TaxAdjustmentJournalLine[]> {
  const results: TaxAdjustmentJournalLine[] = [];

  for (const line of lines) {
    const id = newId("tajl");
    await db.query(
      `INSERT INTO tax_adjustment_journal_lines
        (id, journal_id, account_id, tax_line_id, description, debit, credit, currency, exchange_rate, is_tax_only)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id, journalId, line.account_id, line.tax_line_id ?? null,
        line.description ?? null, line.debit, line.credit,
        line.currency ?? "USD", line.exchange_rate ?? 1, line.is_tax_only ?? false
      ],
    );
    results.push({ ...line, id, journal_id: journalId, created_at: new Date().toISOString() });
  }
  return results;
}

/**
 * Post a tax adjustment journal (validate double-entry, update balances)
 */
export async function postTaxAdjustmentJournal(
  db: Db,
  journalId: string,
  actorUserId: string
): Promise<TaxAdjustmentJournal> {
  const [journal] = await db.query<any>(
    `SELECT * FROM tax_adjustment_journals WHERE id = $1`,
    [journalId],
  );
  if (!journal) throw new Error("Journal not found");
  if (journal.status !== "draft") throw new Error("Only draft journals can be posted");

  // Get lines
  const lines = await db.query<any>(
    `SELECT * FROM tax_adjustment_journal_lines WHERE journal_id = $1`,
    [journalId],
  );

  // Validate double-entry
  const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit), 0);
  const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new Error(`Journal out of balance: debits ${totalDebit} != credits ${totalCredit}`);
  }

  const now = new Date().toISOString();
  const postedAt = now;

  const statements: DbStatement[] = [
    {
      query: `UPDATE tax_adjustment_journals SET status = 'posted', posted_at = $1, posted_by_user_id = $2, updated_at = NOW() WHERE id = $3`,
      params: [postedAt, actorUserId, journalId],
    },
    // Update account balances for tax-only accounts
    ...lines
      .filter(l => l.is_tax_only)
      .map(line => ({
        query: `INSERT INTO account_balances (id, firm_id, client_id, account_id, period_end, debit_balance, credit_balance)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (firm_id, client_id, account_id, period_end) DO UPDATE SET
                  debit_balance = account_balances.debit_balance + EXCLUDED.debit_balance,
                  credit_balance = account_balances.credit_balance + EXCLUDED.credit_balance,
                  updated_at = NOW()`,
        params: [
          newId("abal"),
          journal.firm_id,
          journal.client_id,
          line.account_id,
          journal.period_end,
          line.debit,
          line.credit,
        ],
      })),
  ];

  await db.transaction(statements);

  const [updated] = await db.query<any>(
    `SELECT * FROM tax_adjustment_journals WHERE id = $1`,
    [journalId],
  );
  return mapTaxAdjustmentJournal(updated);
}

export async function reverseTaxAdjustmentJournal(
  db: Db,
  journalId: string,
  actorUserId: string
): Promise<TaxAdjustmentJournal> {
  const [journal] = await db.query<any>(`SELECT * FROM tax_adjustment_journals WHERE id = $1`, [journalId]);
  if (!journal) throw new Error("Journal not found");
  if (journal.status !== "posted") throw new Error("Only posted journals can be reversed");
  if (journal.reversed_journal_id) throw new Error("Journal already reversed");

  const lines = await db.query<any>(`SELECT * FROM tax_adjustment_journal_lines WHERE journal_id = $1`, [journalId]);
  const totalDebit = lines.reduce((sum: number, l: any) => sum + Number(l.debit), 0);
  const totalCredit = lines.reduce((sum: number, l: any) => sum + Number(l.credit), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.005) throw new Error("Source journal out of balance");

  const newId2 = newId("taj");
  const now = new Date().toISOString();
  const statements: any[] = [
    { query: `INSERT INTO tax_adjustment_journals (id, firm_id, client_id, engagement_id, tax_year, period_end, adjustment_type, source_type, source_id, memo, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',NULL,$8,'draft',$9,$10)`, params: [newId2, journal.firm_id, journal.client_id, journal.engagement_id, journal.tax_year, journal.period_end, journal.adjustment_type, `Reversal of ${journal.id}`, now, now] },
    ...lines.map((l: any) => ({ query: `INSERT INTO tax_adjustment_journal_lines (id, journal_id, account_id, tax_line_id, description, debit, credit, currency, exchange_rate, is_tax_only) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, params: [newId("tajl"), newId2, l.account_id, l.tax_line_id, l.description ? `Reversal: ${l.description}` : "Reversal", l.credit, l.debit, l.currency, l.exchange_rate, l.is_tax_only] })),
  ];
  await db.transaction(statements);

  const reversal = await postTaxAdjustmentJournal(db, newId2, actorUserId);
  await db.query(`UPDATE tax_adjustment_journals SET reversed_journal_id = $1, status='reversed', updated_at = NOW() WHERE id = $2`, [reversal.id, journalId]);
  return reversal;
}

/**
 * Create M-1 reconciliation
 */
export async function createM1Reconciliation(
  db: Db,
  input: { firmId: string; clientId: string; taxYear: number }
): Promise<M1Reconciliation> {
  const id = newId("m1r");
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO m1_reconciliations (id, firm_id, client_id, tax_year, book_net_income, taxable_income, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 0, 0, 'draft', $5, $6)`,
    [id, input.firmId, input.clientId, input.taxYear, now, now],
  );

  const [row] = await db.query<any>(`SELECT * FROM m1_reconciliations WHERE id = $1`, [id]);
  return mapM1Reconciliation(row);
}

/**
 * Add M-1 reconciliation line
 */
export async function addM1ReconciliationLine(
  db: Db,
  reconciliationId: string,
  line: Omit<M1ReconciliationLine, "id" | "reconciliation_id" | "created_at" | "updated_at">
): Promise<M1ReconciliationLine> {
  const id = newId("m1l");
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO m1_reconciliation_lines
      (id, reconciliation_id, line_code, line_label, line_category, amount, source_journal_id, sort_order, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, reconciliationId, line.line_code, line.line_label, line.line_category, line.amount,
     line.source_journal_id ?? null, line.sort_order, line.notes ?? null],
  );

  const [row] = await db.query<any>(`SELECT * FROM m1_reconciliation_lines WHERE id = $1`, [id]);
  return mapM1Line(row);
}

/**
 * Finalize M-1 reconciliation
 */
export async function finalizeM1Reconciliation(
  db: Db,
  reconciliationId: string,
  actorUserId: string
): Promise<M1Reconciliation> {
  const now = new Date().toISOString();

  // Calculate taxable income from lines
  const lines = await db.query<any>(
    `SELECT line_category, amount FROM m1_reconciliation_lines WHERE reconciliation_id = $1`,
    [reconciliationId],
  );

  let taxableIncome = 0;
  for (const line of lines) {
    switch (line.line_category) {
      case "book_income": taxableIncome += Number(line.amount); break;
      case "federal_tax": taxableIncome += Number(line.amount); break; // add back
      case "excess_capital_loss": taxableIncome += Number(line.amount); break;
      case "taxable_income_not_book": taxableIncome += Number(line.amount); break;
      case "book_expense_not_deduct": taxableIncome += Number(line.amount); break;
      case "income_not_taxable": taxableIncome -= Number(line.amount); break;
      case "deductible_not_book": taxableIncome -= Number(line.amount); break;
    }
  }

  await db.query(
    `UPDATE m1_reconciliations SET taxable_income = $1, status = 'finalized', finalized_at = NOW(), finalized_by_user_id = $2, updated_at = NOW() WHERE id = $3`,
    [taxableIncome, actorUserId, reconciliationId],
  );

  const [row] = await db.query<any>(`SELECT * FROM m1_reconciliations WHERE id = $1`, [reconciliationId]);
  return mapM1Reconciliation(row);
}

// --- Mappers ---

function mapTaxAdjustmentJournal(row: any): TaxAdjustmentJournal {
  return {
    id: row.id,
    firm_id: row.firm_id,
    client_id: row.client_id,
    engagement_id: row.engagement_id,
    tax_year: row.tax_year,
    period_end: row.period_end,
    adjustment_type: row.adjustment_type,
    source_type: row.source_type,
    source_id: row.source_id,
    memo: row.memo,
    status: row.status,
    posted_at: row.posted_at,
    posted_by_user_id: row.posted_by_user_id,
    reversed_journal_id: row.reversed_journal_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapM1Reconciliation(row: any): M1Reconciliation {
  return {
    id: row.id,
    firm_id: row.firm_id,
    client_id: row.client_id,
    tax_year: row.tax_year,
    book_net_income: Number(row.book_net_income),
    taxable_income: Number(row.taxable_income),
    status: row.status,
    finalized_at: row.finalized_at,
    finalized_by_user_id: row.finalized_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapM1Line(row: any): M1ReconciliationLine {
  return {
    id: row.id,
    reconciliation_id: row.reconciliation_id,
    line_code: row.line_code,
    line_label: row.line_label,
    line_category: row.line_category,
    amount: Number(row.amount),
    source_journal_id: row.source_journal_id,
    sort_order: row.sort_order,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}