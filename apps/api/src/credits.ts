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
