import { createDb, type Db, type DbStatement } from "../db";
import { newId } from "../lib/id";

export type LedgerEntrySource =
  | { type: "bank_transaction"; bankTransactionId: string }
  | { type: "receipt"; receiptId: string }
  | { type: "both"; bankTransactionId: string; receiptId: string };

export type LedgerEntryInput = {
  clientId: string;
  periodKey: string;
  entryDate: string;
  description: string;
  amount: number;
  currency: string;
  accountingClass: "expense" | "income" | "transfer" | "owner_contribution" | "owner_draw" | "needs_review";
  treatment: "business" | "personal";
  categoryId: string | null;
  source: LedgerEntrySource;
  createdByUserId: string;
};

/**
 * Pure statement builder for a new ledger entry. Callers that need this write
 * to be atomic with other mutations (e.g. classifying a bank transaction)
 * should batch the returned statement into their own db.transaction() call
 * instead of executing it here.
 */
export function buildCreateLedgerEntryStatement(input: LedgerEntryInput): { id: string; statement: DbStatement } {
  const entryId = newId("le");
  const sourceBankTransactionId = input.source.type === "bank_transaction" || input.source.type === "both"
    ? input.source.bankTransactionId
    : null;
  const sourceReceiptId = input.source.type === "receipt" || input.source.type === "both"
    ? input.source.receiptId
    : null;

  return {
    id: entryId,
    statement: {
      query: `INSERT INTO ledger_entries
        (id, client_id, period_key, entry_date, description, amount, currency,
         accounting_class, treatment, category_id,
         source_bank_transaction_id, source_receipt_id,
         created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      params: [
        entryId,
        input.clientId,
        input.periodKey,
        input.entryDate,
        input.description,
        input.amount,
        input.currency,
        input.accountingClass,
        input.treatment,
        input.categoryId,
        sourceBankTransactionId,
        sourceReceiptId,
        input.createdByUserId,
      ],
    },
  };
}

export async function createLedgerEntry(db: Db, input: LedgerEntryInput): Promise<string> {
  const { id, statement } = buildCreateLedgerEntryStatement(input);
  await db.query(statement.query, statement.params);
  return id;
}

/** Pure statement builder ensuring an accounting_periods row exists for periodKey. */
export function buildEnsurePeriodStatement(clientId: string, periodKey: string): DbStatement {
  return {
    query: `INSERT INTO accounting_periods (client_id, period_key)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    params: [clientId, periodKey],
  };
}

export async function getOrCreatePeriodKey(db: Db, clientId: string, date: string): Promise<string> {
  const periodKey = date.slice(0, 7); // YYYY-MM
  await db.query(
    `INSERT INTO accounting_periods (client_id, period_key)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [clientId, periodKey],
  );
  return periodKey;
}

export async function rebuildLedgerForClient(db: Db, clientId: string, userId: string): Promise<{
  created: number;
  updated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let created = 0;
  let updated = 0;

  try {
    // 1. Matched bank transactions with receipts -> one ledger entry
    const matched = await db.query<{
      id: string;
      txn_date: string | null;
      description: string;
      amount: number;
      currency: string;
      matched_receipt_id: string;
      category_id: string | null;
    }>(
      `SELECT bt.id, bt.txn_date, bt.description, bt.amount, bt.currency,
              bt.matched_receipt_id, bt.category_id
       FROM bank_transactions bt
       WHERE bt.client_id = $1
         AND bt.triage = 'matched'
         AND bt.matched_receipt_id IS NOT NULL`,
      [clientId],
    );

    for (const bt of matched) {
      if (!bt.txn_date) continue;
      const periodKey = await getOrCreatePeriodKey(db, clientId, bt.txn_date);
      const receipt = await db.query<{
        id: string;
        extracted_merchant: string | null;
        extracted_total: number | null;
        extracted_date: string | null;
        category_id: string | null;
      }>(
        `SELECT id, extracted_merchant, extracted_total, extracted_date, category_id
         FROM receipts WHERE id = $1 AND client_id = $2`,
        [bt.matched_receipt_id, clientId],
      );
      if (!receipt[0]) continue;

      const r = receipt[0];
      // Check if ledger entry already exists (either sourced from this bank
      // transaction, or a receipt-only entry that must be merged to avoid double counting)
      const existing = await db.query<{ id: string; source_bank_transaction_id: string | null }>(
        `SELECT id, source_bank_transaction_id FROM ledger_entries
         WHERE client_id = $1
           AND (
             (source_bank_transaction_id = $2 AND source_receipt_id = $3)
             OR (source_bank_transaction_id IS NULL AND source_receipt_id = $3)
           )`,
        [clientId, bt.id, bt.matched_receipt_id],
      );

      if (existing[0]) {
        // Update existing, attaching the bank source to receipt-only entries
        await db.query(
          `UPDATE ledger_entries SET
             entry_date = $1,
             description = $2,
             amount = $3,
             currency = $4,
             category_id = $5,
             source_bank_transaction_id = COALESCE(source_bank_transaction_id, $6),
             reviewed_at = NOW(),
             reviewed_by_user_id = $7
           WHERE id = $8`,
          [bt.txn_date, r.extracted_merchant || bt.description, Math.abs(bt.amount), bt.currency,
           r.category_id || bt.category_id, bt.id, userId, existing[0].id],
        );
        updated++;
      } else {
        await createLedgerEntry(db, {
          clientId,
          periodKey,
          entryDate: bt.txn_date,
          description: r.extracted_merchant || bt.description,
          amount: Math.abs(bt.amount),
          currency: bt.currency,
          accountingClass: bt.amount < 0 ? "expense" : "income",
          treatment: "business",
          categoryId: r.category_id || bt.category_id,
          source: { type: "both", bankTransactionId: bt.id, receiptId: bt.matched_receipt_id },
          createdByUserId: userId,
        });
        created++;
      }
    }

    // 2. Bank transactions resolved without receipt (no_receipt_required)
    const noReceipt = await db.query<{
      id: string;
      txn_date: string | null;
      description: string;
      amount: number;
      currency: string;
      category_id: string | null;
      resolution_reason: string | null;
    }>(
      `SELECT id, txn_date, description, amount, currency, category_id, resolution_reason
       FROM bank_transactions
       WHERE client_id = $1
         AND triage = 'no_receipt_required'`,
      [clientId],
    );

    for (const bt of noReceipt) {
      if (!bt.txn_date) continue;
      const periodKey = await getOrCreatePeriodKey(db, clientId, bt.txn_date);

      const existing = await db.query<{ id: string }>(
        `SELECT id FROM ledger_entries
         WHERE client_id = $1
           AND source_bank_transaction_id = $2
           AND source_receipt_id IS NULL`,
        [clientId, bt.id],
      );

      if (existing[0]) {
        await db.query(
          `UPDATE ledger_entries SET
             entry_date = $1,
             description = $2,
             amount = $3,
             currency = $4,
             category_id = $5,
             reviewed_at = NOW(),
             reviewed_by_user_id = $6
           WHERE id = $7`,
          [bt.txn_date, bt.description, Math.abs(bt.amount), bt.currency,
           bt.category_id, userId, existing[0].id],
        );
        updated++;
      } else {
        await createLedgerEntry(db, {
          clientId,
          periodKey,
          entryDate: bt.txn_date,
          description: bt.description,
          amount: Math.abs(bt.amount),
          currency: bt.currency,
          accountingClass: bt.amount < 0 ? "expense" : "income",
          treatment: "business",
          categoryId: bt.category_id,
          source: { type: "bank_transaction", bankTransactionId: bt.id },
          createdByUserId: userId,
        });
        created++;
      }
    }

    // 3. Filed receipts without bank transaction (receipt-only)
    const receiptOnly = await db.query<{
      id: string;
      extracted_date: string | null;
      extracted_merchant: string | null;
      extracted_total: number | null;
      extracted_currency: string;
      category_id: string | null;
    }>(
      `SELECT id, extracted_date, extracted_merchant, extracted_total, extracted_currency, category_id
       FROM receipts
       WHERE client_id = $1
         AND status = 'filed'
         AND id NOT IN (SELECT DISTINCT matched_receipt_id FROM bank_transactions WHERE matched_receipt_id IS NOT NULL)
         AND id NOT IN (SELECT DISTINCT pending_receipt_id FROM bank_transactions WHERE pending_receipt_id IS NOT NULL)
         AND id NOT IN (SELECT DISTINCT suggested_receipt_id FROM bank_transactions WHERE suggested_receipt_id IS NOT NULL)`,
      [clientId],
    );

    for (const r of receiptOnly) {
      if (!r.extracted_date || r.extracted_total === null) continue;
      const periodKey = await getOrCreatePeriodKey(db, clientId, r.extracted_date);

      const existing = await db.query<{ id: string }>(
        `SELECT id FROM ledger_entries
         WHERE client_id = $1
           AND source_bank_transaction_id IS NULL
           AND source_receipt_id = $2`,
        [clientId, r.id],
      );

      if (existing[0]) {
        await db.query(
          `UPDATE ledger_entries SET
             entry_date = $1,
             description = $2,
             amount = $3,
             currency = $4,
             category_id = $5,
             reviewed_at = NOW(),
             reviewed_by_user_id = $6
           WHERE id = $7`,
          [r.extracted_date, r.extracted_merchant || "Receipt", r.extracted_total, r.extracted_currency,
           r.category_id, userId, existing[0].id],
        );
        updated++;
      } else {
        await createLedgerEntry(db, {
          clientId,
          periodKey,
          entryDate: r.extracted_date,
          description: r.extracted_merchant || "Receipt",
          amount: r.extracted_total,
          currency: r.extracted_currency,
          accountingClass: "expense", // default for receipts
          treatment: "business",
          categoryId: r.category_id,
          source: { type: "receipt", receiptId: r.id },
          createdByUserId: userId,
        });
        created++;
      }
    }

  } catch (e) {
    errors.push(e instanceof Error ? e.message : "Unknown error during ledger rebuild");
  }

  return { created, updated, errors };
}

/**
 * Reads current state and returns the statements needed to classify a bank
 * transaction and keep its ledger entry in sync. Returns statements rather
 * than executing them so the caller can batch them into one db.transaction()
 * alongside the bank_transactions update and audit event, making the whole
 * classify operation atomic.
 */
export async function planClassifyBankTransaction(
  db: Db,
  clientId: string,
  transactionId: string,
  userId: string,
  accountingClass: "expense" | "income" | "transfer" | "owner_contribution" | "owner_draw" | "needs_review",
  treatment: "business" | "personal",
  categoryId: string | null,
): Promise<DbStatement[]> {
  const [bt] = await db.query<{
    id: string;
    txn_date: string | null;
    description: string;
    amount: number;
    currency: string;
    matched_receipt_id: string | null;
    category_id: string | null;
  }>(
    `SELECT * FROM bank_transactions WHERE id = $1 AND client_id = $2`,
    [transactionId, clientId],
  );
  if (!bt || !bt.txn_date) throw new Error("Bank transaction not found or missing date");

  const actualPeriodKey = bt.txn_date.slice(0, 7);
  const statements: DbStatement[] = [buildEnsurePeriodStatement(clientId, actualPeriodKey)];

  const existing = await db.query<{ id: string }>(
    `SELECT id FROM ledger_entries
     WHERE client_id = $1
       AND source_bank_transaction_id = $2`,
    [clientId, transactionId],
  );

  if (existing[0]) {
    statements.push({
      query: `UPDATE ledger_entries SET
         accounting_class = $1,
         treatment = $2,
         category_id = $3,
         reviewed_at = NOW(),
         reviewed_by_user_id = $4
       WHERE id = $5`,
      params: [accountingClass, treatment, categoryId, userId, existing[0].id],
    });
  } else if (bt.matched_receipt_id) {
    const [byReceipt] = await db.query<{ id: string }>(
      `SELECT id FROM ledger_entries
       WHERE client_id = $1
         AND source_receipt_id = $2
         AND source_bank_transaction_id IS NULL`,
      [clientId, bt.matched_receipt_id],
    );

    if (byReceipt) {
      statements.push({
        query: `UPDATE ledger_entries SET
           source_bank_transaction_id = $1,
           entry_date = $2,
           period_key = $3,
           accounting_class = $4,
           treatment = $5,
           category_id = $6,
           reviewed_at = NOW(),
           reviewed_by_user_id = $7
         WHERE id = $8`,
        params: [bt.id, bt.txn_date, actualPeriodKey, accountingClass, treatment, categoryId, userId, byReceipt.id],
      });
    } else {
      statements.push(
        buildCreateLedgerEntryStatement({
          clientId,
          periodKey: actualPeriodKey,
          entryDate: bt.txn_date,
          description: bt.description,
          amount: Math.abs(bt.amount),
          currency: bt.currency,
          accountingClass,
          treatment,
          categoryId: categoryId || bt.category_id,
          source: { type: "both", bankTransactionId: bt.id, receiptId: bt.matched_receipt_id },
          createdByUserId: userId,
        }).statement,
      );
    }
  } else {
    statements.push(
      buildCreateLedgerEntryStatement({
        clientId,
        periodKey: actualPeriodKey,
        entryDate: bt.txn_date,
        description: bt.description,
        amount: Math.abs(bt.amount),
        currency: bt.currency,
        accountingClass,
        treatment,
        categoryId: categoryId || bt.category_id,
        source: { type: "bank_transaction", bankTransactionId: bt.id },
        createdByUserId: userId,
      }).statement,
    );
  }

  return statements;
}

/**
 * When a bank transaction is confirmed against a receipt that already produced a
 * receipt-only ledger entry, attach the bank transaction as the second source so
 * the activity is never counted twice. If the bank transaction was previously
 * classified on its own (an unresolved-state classification created a bank-only
 * ledger row before it was later matched to this receipt), that row and the
 * receipt-only row both exist and must be merged into one surviving row rather
 * than both trying to claim the same bank_transaction_id, which the unique
 * ledger index would otherwise reject. Returns the statements to run (empty if
 * there is nothing to attach) so callers can batch them into their own
 * transaction.
 */
export async function planAttachBankSourceToReceiptLedgerEntry(
  db: Db,
  clientId: string,
  receiptId: string,
  bankTransactionId: string,
): Promise<DbStatement[]> {
  const [bank] = await db.query<{ txn_date: string | null }>(
    `SELECT txn_date FROM bank_transactions WHERE id = $1 AND client_id = $2`,
    [bankTransactionId, clientId],
  );
  if (!bank?.txn_date) return [];

  const [receiptOnlyEntry] = await db.query<{ id: string }>(
    `SELECT id FROM ledger_entries
     WHERE client_id = $1 AND source_receipt_id = $2 AND source_bank_transaction_id IS NULL`,
    [clientId, receiptId],
  );
  const [bankOnlyEntry] = await db.query<{ id: string }>(
    `SELECT id FROM ledger_entries
     WHERE client_id = $1 AND source_bank_transaction_id = $2 AND source_receipt_id IS NULL`,
    [clientId, bankTransactionId],
  );

  if (receiptOnlyEntry && bankOnlyEntry) {
    // The receipt-only row must be removed BEFORE the bank-owned row claims
    // its receipt_id: uq_ledger_source_receipt is checked immediately per
    // statement, and both rows would briefly hold the same receipt_id if
    // the update ran first.
    return [
      {
        query: `DELETE FROM ledger_entries WHERE id = $1`,
        params: [receiptOnlyEntry.id],
      },
      {
        query: `UPDATE ledger_entries SET source_receipt_id = $1 WHERE id = $2`,
        params: [receiptId, bankOnlyEntry.id],
      },
    ];
  }

  if (bankOnlyEntry) {
    return [
      {
        query: `UPDATE ledger_entries SET source_receipt_id = $1 WHERE id = $2`,
        params: [receiptId, bankOnlyEntry.id],
      },
    ];
  }

  if (receiptOnlyEntry) {
    return [
      {
        query: `UPDATE ledger_entries SET
           source_bank_transaction_id = $1,
           entry_date = $2,
           period_key = $3
         WHERE id = $4`,
        params: [bankTransactionId, bank.txn_date, bank.txn_date.slice(0, 7), receiptOnlyEntry.id],
      },
    ];
  }

  return [];
}

/**
 * When a bank decision moves a transaction away from "matched" (reject or
 * no_receipt_required), any canonical ledger row still pointing at the old
 * receipt evidence for this bank transaction must be unlinked from it so the
 * ledger no longer claims evidence the bank state no longer agrees with. The
 * bank-sourced ledger row itself (if any) is kept, since the cash movement is
 * still real. If the previously attached receipt is filed, it is still valid
 * evidence on its own, so its own canonical ledger row is recreated rather
 * than letting the receipt silently disappear from the ledger and P&L.
 */
export async function planDetachReceiptFromBankLedgerEntry(
  db: Db,
  clientId: string,
  bankTransactionId: string,
  userId: string,
): Promise<DbStatement[]> {
  const [entry] = await db.query<{ id: string; source_receipt_id: string | null }>(
    `SELECT id, source_receipt_id FROM ledger_entries
     WHERE client_id = $1
       AND source_bank_transaction_id = $2
       AND source_receipt_id IS NOT NULL`,
    [clientId, bankTransactionId],
  );
  if (!entry || !entry.source_receipt_id) return [];
  const receiptId = entry.source_receipt_id;

  const statements: DbStatement[] = [
    {
      query: `UPDATE ledger_entries SET source_receipt_id = NULL WHERE id = $1`,
      params: [entry.id],
    },
  ];

  const [existingReceiptOnly] = await db.query<{ id: string }>(
    `SELECT id FROM ledger_entries WHERE client_id = $1 AND source_receipt_id = $2`,
    [clientId, receiptId],
  );
  if (existingReceiptOnly) return statements;

  const [receipt] = await db.query<{
    extracted_date: string | null;
    extracted_merchant: string | null;
    extracted_total: number | null;
    extracted_currency: string | null;
    category_id: string | null;
    accounting_class: string | null;
    treatment: string | null;
    status: string;
  }>(
    `SELECT extracted_date, extracted_merchant, extracted_total, extracted_currency,
            category_id, accounting_class, treatment, status
     FROM receipts WHERE id = $1 AND client_id = $2`,
    [receiptId, clientId],
  );
  if (!receipt || receipt.status !== "filed" || !receipt.extracted_date || receipt.extracted_total === null) {
    return statements;
  }

  const periodKey = receipt.extracted_date.slice(0, 7);
  statements.push(buildEnsurePeriodStatement(clientId, periodKey));
  statements.push(
    buildCreateLedgerEntryStatement({
      clientId,
      periodKey,
      entryDate: receipt.extracted_date,
      description: receipt.extracted_merchant || "Receipt",
      amount: Number(receipt.extracted_total),
      currency: receipt.extracted_currency || "USD",
      accountingClass:
        (receipt.accounting_class as
          | "expense" | "income" | "transfer" | "owner_contribution" | "owner_draw" | "needs_review"
          | null) || "expense",
      treatment: (receipt.treatment as "business" | "personal" | null) || "business",
      categoryId: receipt.category_id,
      source: { type: "receipt", receiptId },
      createdByUserId: userId,
    }).statement,
  );

  return statements;
}

/**
 * A bank transaction resolved as "no receipt required" is still real cash
 * movement that belongs in the books. If nothing has created a ledger row
 * for it yet, create one defaulting to needs_review/business so it cannot
 * silently vanish from the ledger and the period cannot close around it; the
 * professional then classifies it explicitly from the Transactions view. If
 * a row already exists (e.g. it was previously classified), it is left
 * untouched rather than downgraded back to needs_review.
 */
export async function planEnsureLedgerEntryForBankTransaction(
  db: Db,
  clientId: string,
  bankTransactionId: string,
  userId: string,
): Promise<DbStatement[]> {
  const [existing] = await db.query<{ id: string }>(
    `SELECT id FROM ledger_entries WHERE client_id = $1 AND source_bank_transaction_id = $2`,
    [clientId, bankTransactionId],
  );
  if (existing) return [];

  const [bt] = await db.query<{
    id: string;
    txn_date: string | null;
    description: string;
    amount: number;
    currency: string;
    category_id: string | null;
  }>(
    `SELECT id, txn_date, description, amount, currency, category_id
     FROM bank_transactions WHERE id = $1 AND client_id = $2`,
    [bankTransactionId, clientId],
  );
  if (!bt || !bt.txn_date) return [];

  const periodKey = bt.txn_date.slice(0, 7);
  return [
    buildEnsurePeriodStatement(clientId, periodKey),
    buildCreateLedgerEntryStatement({
      clientId,
      periodKey,
      entryDate: bt.txn_date,
      description: bt.description,
      amount: Math.abs(bt.amount),
      currency: bt.currency,
      accountingClass: "needs_review",
      treatment: "business",
      categoryId: bt.category_id,
      source: { type: "bank_transaction", bankTransactionId: bt.id },
      createdByUserId: userId,
    }).statement,
  ];
}
