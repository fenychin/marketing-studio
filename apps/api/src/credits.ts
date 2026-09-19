import { db } from "./db/index.js";
import { nowIso, uuid } from "./config.js";
import type { CreditLedgerEntry } from "@studio/shared";

export async function balance(tenantId: string): Promise<number> {
  const row = await db().get<{ total: number }>(
    "SELECT CAST(COALESCE(SUM(delta),0) AS INTEGER) AS total FROM credit_ledger WHERE tenant_id=?",
    [tenantId],
  );
  return row?.total ?? 0;
}

export async function charge(tenantId: string, delta: number, reason: string, jobId?: string): Promise<void> {
  await db().run("INSERT INTO credit_ledger(id,tenant_id,delta,reason,job_id,created_at) VALUES(?,?,?,?,?,?)", [
    uuid(), tenantId, delta, reason, jobId ?? null, nowIso(),
  ]);
}

/**
 * Atomic pre-charge: deducts `amount` only when the balance covers it, in a
 * single guarded statement (statement-level atomicity, portable SQL). The
 * concurrency hole where two submissions both pass a pre-check and drive the
 * balance negative is closed here — callers treat `false` as 402.
 */
export async function holdCredits(tenantId: string, amount: number, jobId: string): Promise<boolean> {
  if (amount <= 0) return true;
  const result = await db().run(
    `INSERT INTO credit_ledger(id,tenant_id,delta,reason,job_id,created_at)
     SELECT ?,?,?,?,?,?
     WHERE (SELECT CAST(COALESCE(SUM(delta),0) AS INTEGER) FROM credit_ledger WHERE tenant_id=?) >= ?`,
    [uuid(), tenantId, -amount, "hold", jobId, nowIso(), tenantId, amount],
  );
  return result.changes > 0;
}

/**
 * Once-only refund: writes the refund row unless this job already has one
 * (any `refund:*` reason). Guard and insert are one statement, so cancel
 * races and worker/cancel double-refunds are impossible.
 */
export async function refundOnce(tenantId: string, amount: number, jobId: string, reason: string): Promise<void> {
  if (amount <= 0) return;
  await db().run(
    `INSERT INTO credit_ledger(id,tenant_id,delta,reason,job_id,created_at)
     SELECT ?,?,?,?,?,?
     WHERE (SELECT COUNT(*) FROM credit_ledger WHERE job_id=? AND reason LIKE 'refund%') = 0`,
    [uuid(), tenantId, amount, reason, jobId, nowIso(), jobId],
  );
}

export async function ledger(tenantId: string): Promise<CreditLedgerEntry[]> {
  const rows = await db().all<{ id: string; delta: number; reason: string; job_id: string | null; created_at: string }>(
    "SELECT id,delta,reason,job_id,created_at FROM credit_ledger WHERE tenant_id=? ORDER BY created_at DESC LIMIT 50",
    [tenantId],
  );
  return rows.map((r) => ({ id: r.id, delta: r.delta, reason: r.reason, jobId: r.job_id ?? undefined, createdAt: r.created_at }));
}

export async function canAfford(tenantId: string, cost: number): Promise<boolean> {
  return (await balance(tenantId)) >= cost;
}
