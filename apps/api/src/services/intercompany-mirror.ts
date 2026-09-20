import type { Db } from "../db";
import { newId } from "../lib/id";

export interface IntercompanyMatchCandidate {
  matchId: string;
  confidenceScore: number;
  matchRating: "high_confidence" | "probable_match" | "suggested_match";
  matchReason: string;
  dateDifferenceDays: number;
  amount: number;
  source: {
    clientId: string;
    clientName: string;
    transactionId: string;
    txnDate: string;
    description: string;
    amount: number;
    triage: string;
  };
  mirror: {
    clientId: string;
    clientName: string;
    transactionId: string;
    txnDate: string;
    description: string;
    amount: number;
    triage: string;
  };
  suggestedClassification: {
    sourceCategory: string;
    mirrorCategory: string;
  };
}

export interface AffiliateRelationship {
  id: string;
  firmId: string;
  clientIdA: string;
  clientNameA: string;
  clientIdB: string;
  clientNameB: string;
  relationshipLabel: string;
  createdAt: string;
}

export class IntercompanyMirrorService {
  constructor(private db: Db) {}

  /**
   * Ensures the necessary intercompany tables exist in Neon Postgres.
   */
  async ensureTables(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS intercompany_affiliates (
        id TEXT PRIMARY KEY,
        firm_id TEXT NOT NULL,
        client_id_a TEXT NOT NULL,
        client_id_b TEXT NOT NULL,
        relationship_label TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (firm_id, client_id_a, client_id_b)
      );

      CREATE TABLE IF NOT EXISTS intercompany_reconciliations (
        id TEXT PRIMARY KEY,
        firm_id TEXT NOT NULL,
        client_id_a TEXT NOT NULL,
        txn_id_a TEXT NOT NULL,
        client_id_b TEXT NOT NULL,
        txn_id_b TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        matched_reason TEXT NOT NULL,
        reconciled_by TEXT NOT NULL,
        reconciled_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  }

  /**
   * Scans bank feeds across clients in the firm to detect matching intercompany mirror transactions.
   */
  async detectMirrorTransactions(
    firmId: string,
    primaryClientId?: string
  ): Promise<IntercompanyMatchCandidate[]> {
    await this.ensureTables();

    // Fetch all active transactions for the firm's clients
    const query = primaryClientId
      ? `SELECT bt.id, bt.client_id, c.name AS client_name, bt.txn_date, bt.description, bt.amount, bt.triage
         FROM bank_transactions bt
         JOIN clients c ON c.id = bt.client_id
         WHERE c.firm_id = $1 AND bt.triage <> 'matched'
         ORDER BY bt.txn_date DESC`
      : `SELECT bt.id, bt.client_id, c.name AS client_name, bt.txn_date, bt.description, bt.amount, bt.triage
         FROM bank_transactions bt
         JOIN clients c ON c.id = bt.client_id
         WHERE c.firm_id = $1 AND bt.triage <> 'matched'
         ORDER BY bt.txn_date DESC`;

    const allTxns = await this.db.query<{
      id: string;
      client_id: string;
      client_name: string;
      txn_date: string;
      description: string;
      amount: string | number;
      triage: string;
    }>(query, [firmId]);

    // Separate disbursements (negative) and deposits (positive)
    const disbursements = allTxns.filter((t) => Number(t.amount) < 0);
    const deposits = allTxns.filter((t) => Number(t.amount) > 0);

    const matches: IntercompanyMatchCandidate[] = [];
    const usedDepositIds = new Set<string>();

    for (const disb of disbursements) {
      // If primaryClientId is specified, only examine disbursements originating from or destined to this client
      if (primaryClientId && disb.client_id !== primaryClientId) {
        // Will be matched when looking at deposits
      }

      const disbAmountAbs = Math.abs(Number(disb.amount));
      if (disbAmountAbs < 10) continue; // Skip micro-transactions under $10

      const disbDate = new Date(disb.txn_date).getTime();

      for (const dep of deposits) {
        // Must belong to different client entities
        if (disb.client_id === dep.client_id) continue;
        if (usedDepositIds.has(dep.id)) continue;

        // If primaryClientId is specified, at least one side must be this client
        if (primaryClientId && disb.client_id !== primaryClientId && dep.client_id !== primaryClientId) {
          continue;
        }

        const depAmount = Number(dep.amount);
        // Exact amount match
        if (Math.abs(disbAmountAbs - depAmount) > 0.01) continue;

        // Date clearing window: within 4 calendar days
        const depDate = new Date(dep.txn_date).getTime();
        const diffDays = Math.abs(Math.round((depDate - disbDate) / (1000 * 60 * 60 * 24)));
        if (diffDays > 4) continue;

        // Calculate confidence score and textual match signals
        const disbDesc = (disb.description || "").toLowerCase();
        const depDesc = (dep.description || "").toLowerCase();
        const disbClient = (disb.client_name || "").toLowerCase();
        const depClient = (dep.client_name || "").toLowerCase();

        let confidenceScore = 75;
        let reasons: string[] = [`Exact mirror amount $${depAmount.toFixed(2)}`];

        if (diffDays === 0) {
          confidenceScore += 15;
          reasons.push("Cleared on identical calendar date");
        } else if (diffDays <= 2) {
          confidenceScore += 10;
          reasons.push(`Cleared within ${diffDays} business day${diffDays === 1 ? "" : "s"}`);
        } else {
          reasons.push(`Cleared within ${diffDays} days`);
        }

        // Check for cross-referencing names or transfer keywords
        const hasTransferKeyword =
          disbDesc.includes("transfer") ||
          disbDesc.includes("wire") ||
          disbDesc.includes("zelle") ||
          disbDesc.includes("ach") ||
          depDesc.includes("transfer") ||
          depDesc.includes("wire") ||
          depDesc.includes("zelle") ||
          depDesc.includes("ach");

        if (hasTransferKeyword) {
          confidenceScore += 5;
          reasons.push("Direct electronic transfer marker detected");
        }

        const mentionsOtherEntity =
          disbDesc.includes(depClient.split(" ")[0] || "xyz") ||
          depDesc.includes(disbClient.split(" ")[0] || "xyz");

        if (mentionsOtherEntity) {
          confidenceScore += 10;
          reasons.push("Payee description cross-references affiliate entity name");
        }

        confidenceScore = Math.min(99, confidenceScore);

        const matchRating: IntercompanyMatchCandidate["matchRating"] =
          confidenceScore >= 90
            ? "high_confidence"
            : confidenceScore >= 80
            ? "probable_match"
            : "suggested_match";

        // Determine suggested intercompany classifications based on amount/memo
        let sourceCategory = "Intercompany Transfer Out (Due From Affiliate)";
        let mirrorCategory = "Intercompany Transfer In (Due To Affiliate)";

        if (disbDesc.includes("rent") || depDesc.includes("rent")) {
          sourceCategory = "Intercompany Rent Expense";
          mirrorCategory = "Intercompany Rental Income";
        } else if (disbDesc.includes("fee") || disbDesc.includes("mgmt") || depDesc.includes("mgmt")) {
          sourceCategory = "Intercompany Management Fee Expense";
          mirrorCategory = "Intercompany Management Fee Income";
        }

        usedDepositIds.add(dep.id);

        matches.push({
          matchId: `match_${disb.id}_${dep.id}`,
          confidenceScore,
          matchRating,
          matchReason: reasons.join(" · "),
          dateDifferenceDays: diffDays,
          amount: depAmount,
          source: {
            clientId: disb.client_id,
            clientName: disb.client_name,
            transactionId: disb.id,
            txnDate: disb.txn_date,
            description: disb.description,
            amount: Number(disb.amount),
            triage: disb.triage,
          },
          mirror: {
            clientId: dep.client_id,
            clientName: dep.client_name,
            transactionId: dep.id,
            txnDate: dep.txn_date,
            description: dep.description,
            amount: Number(dep.amount),
            triage: dep.triage,
          },
          suggestedClassification: {
            sourceCategory,
            mirrorCategory,
          },
        });
      }
    }

    // Sort by highest confidence first
    return matches.sort((a, b) => b.confidenceScore - a.confidenceScore);
  }

  /**
   * 1-Click Dual-Book Reconciliation:
   * Atomically reconciles both sides of an intercompany mirror transaction across the two entities.
   */
  async reconcileMirrorMatch(
    firmId: string,
    userId: string,
    userName: string,
    params: {
      sourceTxnId: string;
      sourceClientId: string;
      sourceClientName: string;
      mirrorTxnId: string;
      mirrorClientId: string;
      mirrorClientName: string;
      amount: number;
      reason?: string;
    }
  ): Promise<{ success: boolean; auditId: string }> {
    await this.ensureTables();

    const reconciliationId = newId("ic_rec");
    const auditId = newId("audit");

    const reason = params.reason || `Intercompany Mirror Reconciled: $${params.amount.toFixed(2)}`;

    const statements = [
      // 1. Reconcile Source Disbursement (Entity A)
      {
        query: `UPDATE bank_transactions SET
                  triage = 'no_receipt_required',
                  resolution_reason = $1,
                  resolved_at = NOW(),
                  resolved_by_user_id = $2,
                  reviewed_at = NOW(),
                  reviewed_by_user_id = $2
                WHERE id = $3 AND client_id = $4`,
        params: [
          `Intercompany transfer to ${params.mirrorClientName} (Mirror matched with txn #${params.mirrorTxnId.slice(0, 8)})`,
          userId,
          params.sourceTxnId,
          params.sourceClientId,
        ],
      },
      // 2. Reconcile Mirror Deposit (Entity B)
      {
        query: `UPDATE bank_transactions SET
                  triage = 'no_receipt_required',
                  resolution_reason = $1,
                  resolved_at = NOW(),
                  resolved_by_user_id = $2,
                  reviewed_at = NOW(),
                  reviewed_by_user_id = $2
                WHERE id = $3 AND client_id = $4`,
        params: [
          `Intercompany deposit from ${params.sourceClientName} (Mirror matched with txn #${params.sourceTxnId.slice(0, 8)})`,
          userId,
          params.mirrorTxnId,
          params.mirrorClientId,
        ],
      },
      // 3. Record in intercompany_reconciliations
      {
        query: `INSERT INTO intercompany_reconciliations (
                  id, firm_id, client_id_a, txn_id_a, client_id_b, txn_id_b, amount, matched_reason, reconciled_by, reconciled_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        params: [
          reconciliationId,
          firmId,
          params.sourceClientId,
          params.sourceTxnId,
          params.mirrorClientId,
          params.mirrorTxnId,
          params.amount,
          reason,
          userName,
        ],
      },
      // 4. Log immutable audit event
      {
        query: `INSERT INTO audit_events (
                  id, firm_id, client_id, actor_id, actor_name, event_type, details, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        params: [
          auditId,
          firmId,
          params.sourceClientId,
          userId,
          userName,
          "intercompany_mirror_reconciled",
          JSON.stringify({
            reconciliationId,
            sourceClientId: params.sourceClientId,
            sourceTxnId: params.sourceTxnId,
            mirrorClientId: params.mirrorClientId,
            mirrorTxnId: params.mirrorTxnId,
            amount: params.amount,
            dualReconciliation: true,
          }),
        ],
      },
    ];

    await this.db.transaction(statements);

    return { success: true, auditId };
  }

  /**
   * List all affiliate relationships defined for a firm or client.
   */
  async listAffiliates(firmId: string, clientId?: string): Promise<AffiliateRelationship[]> {
    await this.ensureTables();

    const query = clientId
      ? `SELECT ia.id, ia.firm_id, ia.client_id_a, ca.name AS client_name_a,
                ia.client_id_b, cb.name AS client_name_b, ia.relationship_label, ia.created_at
         FROM intercompany_affiliates ia
         JOIN clients ca ON ca.id = ia.client_id_a
         JOIN clients cb ON cb.id = ia.client_id_b
         WHERE ia.firm_id = $1 AND (ia.client_id_a = $2 OR ia.client_id_b = $2)
         ORDER BY ia.created_at DESC`
      : `SELECT ia.id, ia.firm_id, ia.client_id_a, ca.name AS client_name_a,
                ia.client_id_b, cb.name AS client_name_b, ia.relationship_label, ia.created_at
         FROM intercompany_affiliates ia
         JOIN clients ca ON ca.id = ia.client_id_a
         JOIN clients cb ON cb.id = ia.client_id_b
         WHERE ia.firm_id = $1
         ORDER BY ia.created_at DESC`;

    const params = clientId ? [firmId, clientId] : [firmId];
    const rows = await this.db.query<{
      id: string;
      firm_id: string;
      client_id_a: string;
      client_name_a: string;
      client_id_b: string;
      client_name_b: string;
      relationship_label: string;
      created_at: string;
    }>(query, params);

    return rows.map((r) => ({
      id: r.id,
      firmId: r.firm_id,
      clientIdA: r.client_id_a,
      clientNameA: r.client_name_a,
      clientIdB: r.client_id_b,
      clientNameB: r.client_name_b,
      relationshipLabel: r.relationship_label,
      createdAt: r.created_at,
    }));
  }

  /**
   * Create an affiliate link between two client entities.
   */
  async addAffiliate(
    firmId: string,
    clientIdA: string,
    clientIdB: string,
    relationshipLabel: string
  ): Promise<string> {
    await this.ensureTables();

    const id = newId("aff");
    await this.db.query(
      `INSERT INTO intercompany_affiliates (id, firm_id, client_id_a, client_id_b, relationship_label, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (firm_id, client_id_a, client_id_b) DO UPDATE SET
         relationship_label = EXCLUDED.relationship_label`,
      [id, firmId, clientIdA, clientIdB, relationshipLabel]
    );

    return id;
  }
}
