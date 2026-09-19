import { db } from "./db/index.js";
import { nowIso, uuid } from "./config.js";
import { publishJobEvent } from "./bus.js";
import { holdCredits, refundOnce, canAfford, balance } from "./credits.js";
import { getAsset, readArtifact, storeArtifact, type AssetRow } from "./storage.js";
import { resolveModelAny } from "./tenant-models.js";
import { qcVideoArtifact } from "./qc.js";
import type { GenerateContext, ProducedArtifact, ReferencePayload } from "./providers/types.js";
import { generationToDto, generationsForJobs, getJob, jobToDto, type JobRow } from "./dto.js";
import type { CreateGenerationRequest, GenerationDto, GenerationParams, JobDto, Kind, ReferenceRole } from "@studio/shared";

const GLOBAL_CONCURRENCY = 2;
const TENANT_ACTIVE_LIMIT = 5;

export class SubmissionError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function seedFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface GenerationIssue {
  statusCode: number;
  code: string;
  message: string;
}

export interface GenerationEvaluation {
  issues: GenerationIssue[];
  modelId: string | null;
  cost: { creditsPerUnit: number; count: number; total: number } | null;
  balanceBefore: number;
}

/** Plan-mode evaluation: collects every issue (no throwing), prices the run. */
export async function evaluateGeneration(tenantId: string, request: CreateGenerationRequest): Promise<GenerationEvaluation> {
  const issues: GenerationIssue[] = [];
  const resolved = await resolveModelAny(tenantId, request.model, request.kind);
  const model = resolved ? { ...resolved.info, provider: resolved.provider } : null;
  if (!model) {
    issues.push({ statusCode: 400, code: "unknown_model", message: `Model ${request.model} is not available for kind ${request.kind}.` });
    return { issues, modelId: null, cost: null, balanceBefore: await balance(tenantId) };
  }
  const params = request.params;
  if (!model.aspectRatios.includes(params.aspectRatio)) {
    issues.push({ statusCode: 400, code: "invalid_aspect_ratio", message: `Model ${model.id} supports ${model.aspectRatios.join(", ")}.` });
  }
  if (model.resolutions && params.resolution && !model.resolutions.includes(params.resolution)) {
    issues.push({ statusCode: 400, code: "invalid_resolution", message: `Model ${model.id} supports ${model.resolutions.join(", ")}.` });
  }
  if (model.durations && params.durationSec && !model.durations.includes(params.durationSec)) {
    issues.push({ statusCode: 400, code: "invalid_duration", message: `Model ${model.id} supports ${model.durations.join(", ")}s.` });
  }
  if (model.durationRange && params.durationSec && (params.durationSec < model.durationRange.min || params.durationSec > model.durationRange.max)) {
    issues.push({ statusCode: 400, code: "invalid_duration", message: `Model ${model.id} renders ${model.durationRange.min}–${model.durationRange.max}s.` });
  }

  const count = params.count;
  if (!Number.isInteger(count) || count < 1 || count > model.maxCount) {
    issues.push({ statusCode: 400, code: "invalid_count", message: `count must be 1..${model.maxCount}.` });
  }
  if (typeof request.prompt !== "string" || request.prompt.trim().length === 0) {
    issues.push({ statusCode: 400, code: "empty_prompt", message: "请填写创作描述。" });
  }

  const active = await db().get<{ n: number }>(
    "SELECT CAST(COUNT(*) AS INTEGER) AS n FROM jobs WHERE tenant_id=? AND status IN ('queued','running')",
    [tenantId],
  );
  if ((active?.n ?? 0) >= TENANT_ACTIVE_LIMIT) {
    issues.push({ statusCode: 429, code: "tenant_busy", message: `该租户已有 ${TENANT_ACTIVE_LIMIT} 个进行中的作业。` });
  }

  const cost = { creditsPerUnit: model.creditsPerUnit, count, total: model.creditsPerUnit * count };
  if (!request.freeResampleOf && !(await canAfford(tenantId, cost.total))) {
    issues.push({ statusCode: 402, code: "insufficient_credits", message: `本次需要 ${cost.total} 积分。` });
  }

  return { issues, modelId: model.id, cost, balanceBefore: await balance(tenantId) };
}

/** Plan gate: validate the request against the model, credits and tenant quota, then persist a queued job. */
export async function submitGeneration(tenantId: string, request: CreateGenerationRequest): Promise<JobDto> {
  const evaluation = await evaluateGeneration(tenantId, request);
  if (evaluation.issues.length > 0) {
    const first = evaluation.issues[0]!;
    throw new SubmissionError(first.statusCode, first.code, first.message);
  }

  const id = uuid();
  const ts = nowIso();

  // Authoritative budget gate: atomically hold the full run cost before the
  // job exists. The evaluate() pre-check above is only for friendly errors —
  // two racing submissions can no longer both spend the same credits.
  const cost = evaluation.cost;
  if (!cost) throw new SubmissionError(400, "invalid_model", "Model not available.");
  const hold = request.freeResampleOf ? 0 : cost.total;
  if (!(await holdCredits(tenantId, hold, id))) {
    throw new SubmissionError(402, "insufficient_credits", `本次需要 ${cost.total} 积分。`);
  }

  await db().run(
    "INSERT INTO jobs(id,tenant_id,kind,model,prompt,params,status,progress,cost_credits,template_id,free_resample_of,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      id, tenantId, request.kind, request.model, request.prompt.trim(), JSON.stringify(request.params),
      "queued", 0, hold, request.templateId ?? null, request.freeResampleOf ?? null, ts, ts,
    ],
  );
  await db().run("INSERT INTO audit(id,tenant_id,action,subject,meta,created_at) VALUES(?,?,?,?,?,?)", [
    uuid(), tenantId, "job.create", id, JSON.stringify({ kind: request.kind, model: request.model, count: request.params.count }), ts,
  ]);

  const job = await getJob(id, tenantId);
  return jobToDto(job as JobRow, []);
}

/** Worker loop: serialized picking, bounded global concurrency. */
let ticking = false;

export function startWorker(): void {
  // Crash recovery: jobs stuck in 'running' from a previous process re-enter the queue.
  void db()
    .run("UPDATE jobs SET status='queued', progress=0 WHERE status='running'")
    .then(() => console.log("[worker] recovered interrupted jobs"));
  setInterval(() => {
    void tick();
  }, 350);
}

/**
 * Claim the oldest queued job atomically (single UPDATE … RETURNING): safe
 * for multiple worker instances sharing one database — two instances can
 * never pick the same job. The cancelled-while-queued race is closed here,
 * because cancellation and claiming are the same atomic status transition.
 */
export async function claimNextJob(): Promise<JobRow | null> {
  const claimed = await db().all<JobRow>(
    `UPDATE jobs SET status='running', progress=2, updated_at=?
     WHERE id=(SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1)
       AND status='queued'
     RETURNING *`,
    [nowIso()],
  );
  return claimed[0] ?? null;
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const running = await db().get<{ n: number }>("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM jobs WHERE status='running'");
    if ((running?.n ?? 0) >= GLOBAL_CONCURRENCY) return;
    const next = await claimNextJob();
    if (next) await runJob(next);
  } catch (error) {
    console.error("worker tick failed", error);
  } finally {
    ticking = false;
  }
}

async function setProgress(jobId: string, percent: number): Promise<void> {
  const clamped = Math.max(0, Math.min(99, Math.round(percent)));
  await db().run("UPDATE jobs SET progress=?, updated_at=? WHERE id=?", [clamped, nowIso(), jobId]);
  publishJobEvent(jobId, { type: "status", jobId, status: "running", progress: clamped });
}

class JobCancelledError extends Error {
  constructor(readonly jobId: string) {
    super("job cancelled");
  }
}

/** Cancel a queued/running job: claims it, then releases its hold once-only. */
export async function cancelJob(tenantId: string, jobId: string): Promise<boolean> {
  const job = await getJob(jobId, tenantId);
  if (!job) throw new SubmissionError(404, "not_found", "作业不存在。");
  if (job.status !== "queued" && job.status !== "running") return false;
  const claimed = await db().run(
    "UPDATE jobs SET status='cancelled', error='已由用户取消', updated_at=? WHERE id=? AND status IN ('queued','running')",
    [nowIso(), jobId],
  );
  if (claimed.changes === 0) return false;
  await refundOnce(tenantId, job.cost_credits, jobId, "refund:cancelled");
  publishJobEvent(jobId, { type: "status", jobId, status: "cancelled", progress: 0 });
  return true;
}

export async function runJob(job: JobRow): Promise<void> {
  // Mark running idempotently: the row arrives claimed from claimNextJob, but
  // direct callers (tests, tools) may pass a queued row. A job cancelled
  // between claim and here stays cancelled — the no-op protects that.
  const claimed = await db().run(
    "UPDATE jobs SET status='running', progress=2, updated_at=? WHERE id=? AND status IN ('queued','running')",
    [nowIso(), job.id],
  );
  if (claimed.changes === 0) return;
  publishJobEvent(job.id, { type: "status", jobId: job.id, status: "running", progress: 2 });

  const model = await resolveModelAny(job.tenant_id, job.model, job.kind).then(
    (resolved) => (resolved ? { ...resolved.info, provider: resolved.provider } : null),
  );
  const params = JSON.parse(job.params) as GenerationParams;

  try {
    if (!model) throw new Error(`模型 ${job.model} 未在本节点注册`);

    const references: ReferencePayload[] = [];
    for (const ref of params.references ?? []) {
      const asset = await getAsset(job.tenant_id, ref.assetId);
      if (asset) references.push({ role: ref.role as ReferenceRole, buffer: await readArtifact(asset), mime: asset.mime });
    }

    const maxAttempts = job.kind === "video" ? 2 : 1; // QC 失败自动重渲一次
    let produced: ProducedArtifact[] = [];
    let attemptsUsed = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attemptsUsed = attempt;
      let index = 0;
      const ctx: GenerateContext = {
        prompt: job.prompt,
        params,
        references,
        seedBase: seedFromId(job.id) + (attempt - 1) * 7919,
        reportProgress: (percent) => {
          void setProgress(job.id, percent);
        },
        throwIfCancelled: async () => {
          const row = await db().get<{ status: string }>("SELECT status FROM jobs WHERE id=?", [job.id]);
          if (!row || row.status !== "running") throw new JobCancelledError(job.id);
        },
        storeArtifact: async (buffer, mime, meta) => {
          const asset = await storeArtifact(job.tenant_id, buffer, mime, job.kind);
          const genId = uuid();
          const ts = nowIso();
          await db().run(
            "INSERT INTO generations(id,tenant_id,job_id,asset_id,kind,model,idx,favorite,meta,created_at) VALUES(?,?,?,?,?,?,?,0,?,?)",
            [genId, job.tenant_id, job.id, asset.id, job.kind, job.model, index, JSON.stringify(meta ?? {}), ts],
          );
          index += 1;
          const row = await db().get<Parameters<typeof generationToDto>[0]>(
            `SELECT g.*, a.sha, a.ext, a.access_token, a.mime, a.bytes
             FROM generations g JOIN assets a ON a.id=g.asset_id WHERE g.id=?`,
            [genId],
          );
          const dto = generationToDto(row!);
          publishJobEvent(job.id, { type: "generation", jobId: job.id, generation: dto });
        },
      };

      produced = await model.provider.run(ctx);

      const qc = await qcJobGenerations(job, params);
      if (qc.allPassed || !qc.hardFail || attempt === maxAttempts) break;
      // 硬失败（不可读/时长不符）→ 丢弃本轮产物，免费重渲一次
      await db().run("DELETE FROM generations WHERE job_id=?", [job.id]);
      await db().run("UPDATE jobs SET progress=2, updated_at=? WHERE id=?", [nowIso(), job.id]);
      publishJobEvent(job.id, { type: "status", jobId: job.id, status: "running", progress: 2 });
    }
    void attemptsUsed;

    // Hold was taken at submission; consume per produced artifact, refund the rest.
    const hold = job.free_resample_of ? 0 : job.cost_credits;
    const consumed = job.free_resample_of ? 0 : produced.length * model.creditsPerUnit;
    await refundOnce(job.tenant_id, Math.max(0, hold - consumed), job.id, "refund:unused");
    // Conditional claim: a job cancelled while rendering never reports success.
    const done = await db().run(
      "UPDATE jobs SET status='succeeded', progress=100, cost_credits=?, updated_at=? WHERE id=? AND status='running'",
      [consumed, nowIso(), job.id],
    );
    if (done.changes === 0) {
      publishJobEvent(job.id, { type: "done", jobId: job.id, status: "cancelled" });
      return;
    }
    publishJobEvent(job.id, { type: "done", jobId: job.id, status: "succeeded" });
  } catch (error) {
    if (error instanceof JobCancelledError) {
      // cancelJob already refunded and set the terminal status.
      publishJobEvent(job.id, { type: "done", jobId: job.id, status: "cancelled" });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    // Failed jobs release their full hold — "failure = full refund".
    if (job.free_resample_of === null) {
      await refundOnce(job.tenant_id, job.cost_credits, job.id, "refund:failed");
    }
    await db().run("UPDATE jobs SET status='failed', error=?, updated_at=? WHERE id=?", [message, nowIso(), job.id]);
    publishJobEvent(job.id, { type: "done", jobId: job.id, status: "failed", error: message });
  }
}

/** Run the automatic QC suite over a finished job's video artifacts. */
async function qcJobGenerations(
  job: JobRow,
  params: GenerationParams,
): Promise<{ allPassed: boolean; hardFail: boolean }> {
  const rows = await db().all<Parameters<typeof generationToDto>[0]>(
    `SELECT g.*, a.sha, a.ext, a.access_token, a.mime, a.bytes
     FROM generations g JOIN assets a ON a.id=g.asset_id WHERE g.job_id=?`,
    [job.id],
  );
  let allPassed = true;
  let hardFail = false;
  for (const row of rows) {
    if (row.ext !== "mp4") continue; // svg/mock artifacts: no binary QC applicable
    const buffer = await readArtifact(row as unknown as AssetRow);
    const result = await qcVideoArtifact(buffer, { durationSec: params.durationSec });
    await db().run("UPDATE generations SET qc_status=?, qc_report=? WHERE id=?", [
      result.status, JSON.stringify(result.checks), row.id,
    ]);
    if (result.status !== "passed") {
      allPassed = false;
      if (result.hardFail) hardFail = true;
    }
  }
  return { allPassed, hardFail };
}

export async function jobWithGenerations(tenantId: string, job: JobRow): Promise<JobDto> {
  const map = await generationsForJobs(tenantId, [job.id]);
  return jobToDto(job, map.get(job.id) ?? []);
}

export function kindOf(value: string): Kind | undefined {
  return value === "image" || value === "video" ? value : undefined;
}

export type { GenerationDto };
