import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, initDb } from "../src/db/index.js";
import { migrate } from "../src/db/schema.js";
import { balance, holdCredits } from "../src/credits.js";
import { hashApiKey, timingSafeEqHex } from "../src/auth-crypto.js";
import { runJob, submitGeneration, cancelJob, claimNextJob } from "../src/jobs.js";
import { initRegistry } from "../src/providers/registry.js";
import type { JobRow } from "../src/dto.js";

/**
 * S1 hardening acceptance: API keys live only as sha256 hashes (legacy
 * plaintext rows are backfilled and destroyed), the credit hold is atomic so
 * racing submissions can never drive a balance negative, and failed jobs
 * release their full hold.
 */

let dir: string;
let alphaTenant: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "studio-hardening-"));
  await initDb(dir); // fresh sqlite + migrate + seed (demo tenants, 1000 credits each)
  initRegistry({ port: 0, webOrigin: "http://127.0.0.1:5273", dataDir: dir }); // mock providers
  alphaTenant = (await db().get<{ id: string }>("SELECT id FROM tenants WHERE name='Alpha Studio (demo)'"))!.id!;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("api key hashing", () => {
  it("derives deterministic sha256 digests", () => {
    const h = hashApiKey("sk_demo_alpha");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey("sk_demo_alpha")).toBe(h);
    expect(hashApiKey("sk_demo_beta")).not.toBe(h);
  });

  it("seeds demo keys as hashes that still authenticate", async () => {
    const row = await db().get<{ key: string; key_hash: string }>(
      "SELECT key,key_hash FROM api_keys WHERE key_hash=?",
      [hashApiKey("sk_demo_alpha")],
    );
    expect(row?.key).toBe(`hashed:${hashApiKey("sk_demo_alpha")}`); // plaintext destroyed
  });

  it("backfills legacy plaintext rows and destroys the plaintext", async () => {
    await db().run("INSERT INTO api_keys(key,tenant_id,label) VALUES(?,?,?)", [
      "sk_legacy_plain", alphaTenant, "legacy",
    ]);
    await migrate(db()); // re-run the backfill pass
    const plain = await db().get("SELECT key FROM api_keys WHERE key='sk_legacy_plain'");
    expect(plain).toBeUndefined();
    const hash = hashApiKey("sk_legacy_plain");
    const row = await db().get<{ key_hash: string; prefix: string }>(
      "SELECT key_hash,prefix FROM api_keys WHERE key=?",
      [`hashed:${hash}`],
    );
    expect(row?.key_hash).toBe(hash);
    expect(row?.prefix).toBe("sk_legacy_");
  });
});

describe("atomic credit hold", () => {
  let tenant: string;
  beforeAll(async () => {
    tenant = randomUUID();
    await db().run("INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)", [tenant, "hold-test", new Date().toISOString()]);
    await db().run("INSERT INTO credit_ledger(id,tenant_id,delta,reason,created_at) VALUES(?,?,?,?,?)", [
      randomUUID(), tenant, 100, "grant:test", new Date().toISOString(),
    ]);
  });

  it("holds within balance and rejects the overdraw", async () => {
    expect(await holdCredits(tenant, 60, "job-hold-1")).toBe(true);
    expect(await balance(tenant)).toBe(40);
    expect(await holdCredits(tenant, 60, "job-hold-2")).toBe(false); // would go negative
    expect(await balance(tenant)).toBe(40); // unchanged — no row was written
    expect(await holdCredits(tenant, 40, "job-hold-3")).toBe(true);
    expect(await balance(tenant)).toBe(0);
  });

  it("zero-cost holds (free resamples) always pass", async () => {
    expect(await holdCredits(tenant, 0, "job-free")).toBe(true);
  });

  it("claims queued jobs atomically — the same job is never claimed twice", async () => {
    const ts = new Date().toISOString();
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids) {
      await db().run(
        "INSERT INTO jobs(id,tenant_id,kind,model,prompt,params,status,progress,cost_credits,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,0,?,?)",
        [id, tenant, "image", "studio-image-v1", "claim test", "{}", "queued", 0, ts, ts],
      );
    }
    const first = await claimNextJob();
    const second = await claimNextJob();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.id).not.toBe(second!.id);
    expect(first!.status).toBe("running");
    expect(second!.status).toBe("running");
    const seen = new Set([first!.id, second!.id]);
    expect(seen.has(ids[0]!)).toBe(true);
    expect(seen.has(ids[1]!)).toBe(true);
  });

  it("cancels a queued job and refunds its hold exactly once", async () => {
    const before = await balance(alphaTenant);
    const job = await submitGeneration(alphaTenant, {
      kind: "video",
      model: "studio-render-v1",
      prompt: "job destined for cancellation",
      params: { aspectRatio: "9:16", count: 1, durationSec: 3 },
    });
    expect(await balance(alphaTenant)).toBe(before - 60); // held

    expect(await cancelJob(alphaTenant, job.id)).toBe(true);
    expect(await balance(alphaTenant)).toBe(before); // full refund

    // double cancel: already terminal → no-op, no second refund
    expect(await cancelJob(alphaTenant, job.id)).toBe(false);
    expect(await balance(alphaTenant)).toBe(before);

    const row = await db().get<{ status: string; error: string }>("SELECT status,error FROM jobs WHERE id=?", [job.id]);
    expect(row?.status).toBe("cancelled");
    const refunds = await db().all("SELECT reason FROM credit_ledger WHERE job_id=? AND reason LIKE 'refund%'", [job.id]);
    expect(refunds).toHaveLength(1);
  }, 30000);
});

describe("job billing lifecycle", () => {
  it("holds at submission, consumes on success", async () => {
    const before = await balance(alphaTenant);
    const job = await submitGeneration(alphaTenant, {
      kind: "image",
      model: "studio-image-v1",
      prompt: "hardening test shot",
      params: { aspectRatio: "1:1", count: 1 },
    });
    expect(await balance(alphaTenant)).toBe(before - 4); // held immediately at submit

    const row = (await db().get<JobRow>("SELECT * FROM jobs WHERE id=?", [job.id]))!;
    await runJob(row); // mock provider produces 1 artifact
    expect(await balance(alphaTenant)).toBe(before - 4); // hold 4, consumed 4, refund 0

    const updated = await db().get<{ cost_credits: number; status: string }>("SELECT cost_credits,status FROM jobs WHERE id=?", [job.id]);
    expect(updated?.status).toBe("succeeded");
    expect(updated?.cost_credits).toBe(4);
  }, 30000);

  it("refunds the full hold when a job fails", async () => {
    const before = await balance(alphaTenant);
    const job = await submitGeneration(alphaTenant, {
      kind: "video",
      model: "studio-render-v1",
      prompt: "doomed job",
      params: { aspectRatio: "9:16", count: 1, durationSec: 3 },
    });
    expect(await balance(alphaTenant)).toBe(before - 60);

    // Sabotage the model so the run throws inside the worker
    await db().run("UPDATE jobs SET model='no-such-model' WHERE id=?", [job.id]);
    const row = (await db().get<JobRow>("SELECT * FROM jobs WHERE id=?", [job.id]))!;
    await runJob(row);

    expect(await balance(alphaTenant)).toBe(before); // full refund
    const failed = await db().get<{ status: string }>("SELECT status FROM jobs WHERE id=?", [job.id]);
    expect(failed?.status).toBe("failed");
  }, 30000);

  it("never charges for free resamples", async () => {
    const before = await balance(alphaTenant);
    await submitGeneration(alphaTenant, {
      kind: "image",
      model: "studio-image-v1",
      prompt: "free resample",
      params: { aspectRatio: "1:1", count: 1 },
      freeResampleOf: "prior-job",
    });
    expect(await balance(alphaTenant)).toBe(before);
  }, 30000);
});

describe("webhook signature comparison", () => {
  it("compares hex digests in constant time", () => {
    const sig = "a".repeat(64);
    expect(timingSafeEqHex(sig, sig)).toBe(true);
    expect(timingSafeEqHex(sig, "b".repeat(64))).toBe(false);
    expect(timingSafeEqHex(sig, "a".repeat(63))).toBe(false); // length mismatch
    expect(timingSafeEqHex(sig, "not hex")).toBe(false);
  });
});
