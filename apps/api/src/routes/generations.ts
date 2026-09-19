import type { FastifyInstance } from "fastify";
import { subscribeJob } from "../bus.js";
import { balance } from "../credits.js";
import { db } from "../db/index.js";
import { generationsForJobs, getGeneration, getJob, jobToDto, listFavoriteGenerations, listJobs } from "../dto.js";
import { jobWithGenerations, kindOf, SubmissionError, submitGeneration, cancelJob } from "../jobs.js";
import { buildRecreateReport } from "../agents/report.js";
import type { AdDNA, AspectRatio, CreateGenerationRequest, GenerationParams, JobStatus } from "@studio/shared";

function parseCreate(body: unknown): CreateGenerationRequest {
  const raw = (body ?? {}) as Record<string, unknown>;
  const kind = kindOf(String(raw.kind ?? ""));
  if (!kind) throw new SubmissionError(400, "invalid_kind", "kind must be image or video.");
  const paramsRaw = (raw.params ?? {}) as Record<string, unknown>;
  const references = Array.isArray(paramsRaw.references)
    ? (paramsRaw.references as Array<Record<string, unknown>>)
        .map((r) => ({
          assetId: String(r.assetId ?? ""),
          role: (String(r.role ?? "reference") as "product" | "avatar" | "reference"),
        }))
        .filter((r) => r.assetId.length > 0)
    : [];
  return {
    kind,
    model: String(raw.model ?? ""),
    prompt: String(raw.prompt ?? ""),
    templateId: raw.templateId === undefined ? undefined : String(raw.templateId),
    params: {
      aspectRatio: String(paramsRaw.aspectRatio ?? "1:1") as CreateGenerationRequest["params"]["aspectRatio"],
      resolution: paramsRaw.resolution === undefined ? undefined : String(paramsRaw.resolution),
      durationSec: paramsRaw.durationSec === undefined ? undefined : Number(paramsRaw.durationSec),
      count: Number(paramsRaw.count ?? 1),
      references,
    },
  };
}

export function registerGenerationRoutes(app: FastifyInstance): void {
  app.get("/v1/generations", async (request) => {
    const query = request.query as { kind?: string; status?: string; favorites?: string };
    const tenantId = request.tenant!.id;
    if (query.favorites === "1") {
      return { generations: await listFavoriteGenerations(tenantId) };
    }
    const jobs = await listJobs(tenantId, {
      kind: query.kind ? kindOf(query.kind) : undefined,
      status: (query.status as JobStatus | undefined) ?? undefined,
    });
    const map = await generationsForJobs(tenantId, jobs.map((j) => j.id));
    return { jobs: jobs.map((job) => jobToDto(job, map.get(job.id) ?? [])) };
  });

  app.get("/v1/generations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await getJob(id, request.tenant!.id);
    if (!job) return reply.code(404).send({ error: { code: "not_found", message: "作业不存在。" } });
    return { job: await jobWithGenerations(request.tenant!.id, job) };
  });

  /** Cancel a queued/running job; the credit hold is released once-only. */
  app.delete("/v1/generations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const cancelled = await cancelJob(request.tenant!.id, id);
      return reply.code(cancelled ? 200 : 409).send({ cancelled });
    } catch (error) {
      if (error instanceof SubmissionError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });

  /** Replica verification: reference AdDNA vs the final per-beat script. */
  app.get("/v1/generations/:id/recreate-report", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await getJob(id, request.tenant!.id);
    if (!job) return reply.code(404).send({ error: { code: "not_found", message: "作业不存在。" } });
    const params = JSON.parse(job.params) as { agent?: { report?: unknown } };
    const report = params.agent?.report;
    if (!report) {
      return reply.code(404).send({ error: { code: "no_report", message: "该作业没有复刻验收数据。" } });
    }
    return { report };
  });

  /** The editable script: AdDNA + per-beat texts for a beat-anchored job. */
  app.get("/v1/generations/:id/script", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await getJob(id, request.tenant!.id);
    if (!job) return reply.code(404).send({ error: { code: "not_found", message: "作业不存在。" } });
    const params = JSON.parse(job.params) as GenerationParams;
    const agent = params.agent as
      | { dna?: AdDNA; beatTexts?: Array<{ index: number; text: string }>; language?: "zh" | "en"; source?: string }
      | undefined;
    if (!agent?.dna || !agent.beatTexts) {
      return reply.code(404).send({ error: { code: "no_script", message: "该作业没有可编辑的拍脚本。" } });
    }
    return { jobId: id, source: agent.source ?? "edit", language: agent.language ?? "en", dna: agent.dna, beatTexts: agent.beatTexts };
  });

  /**
   * Edit-and-rerender: a human script adjustment (the semantic-take-adjust
   * idea) — beats are the time authority, so edited texts re-fill the same
   * AdDNA windows and the render timing reflows automatically. Creates a new
   * job billed as a fresh render.
   */
  app.post("/v1/generations/:id/rerender", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { beatTexts?: Array<{ index?: number; text?: string }> };
    try {
      const job = await getJob(id, request.tenant!.id);
      if (!job) return reply.code(404).send({ error: { code: "not_found", message: "作业不存在。" } });
      const params = JSON.parse(job.params) as GenerationParams;
      const agent = params.agent as
        | { dna?: AdDNA; beatTexts?: Array<{ index: number; text: string }>; language?: "zh" | "en"; source?: string }
        | undefined;
      if (!agent?.dna || !agent.beatTexts) {
        return reply.code(409).send({ error: { code: "no_script", message: "仅拍锚定作业支持脚本编辑。" } });
      }
      const texts = Array.isArray(body.beatTexts) ? body.beatTexts : [];
      if (texts.length !== agent.dna.beats.length || texts.some((t) => typeof t.text !== "string" || t.text.trim().length === 0)) {
        return reply.code(400).send({ error: { code: "invalid_beats", message: `beatTexts 需要恰好 ${agent.dna.beats.length} 条非空台词。` } });
      }
      const beatTexts = texts.map((t, index) => ({ index, text: t.text!.trim() }));
      const report = buildRecreateReport({
        dna: agent.dna,
        beatTexts,
        language: agent.language ?? "en",
        renderedDurationSec: agent.dna.durationSec,
        aspectRatio: agent.dna.canvas.aspectRatio,
        mode: "loose",
      });
      const newJob = await submitGeneration(request.tenant!.id, {
        kind: "video",
        model: job.model,
        prompt: beatTexts.map((b) => b.text).join(agent.language === "zh" ? "" : " "),
        params: {
          aspectRatio: agent.dna.canvas.aspectRatio as AspectRatio,
          resolution: `${agent.dna.canvas.resolution}p`,
          durationSec: agent.dna.durationSec,
          count: 1,
          ...(params.references && params.references.length > 0 ? { references: params.references } : {}),
          agent: {
            source: "edit",
            basedOn: id,
            language: agent.language ?? "en",
            dna: agent.dna,
            beatTexts,
            report,
          },
        },
      });
      return reply.code(201).send({ job: newJob, report });
    } catch (error) {
      if (error instanceof SubmissionError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });

  app.post("/v1/generations", async (request, reply) => {
    const tenantId = request.tenant!.id;
    try {
      const job = await submitGeneration(tenantId, parseCreate(request.body));
      return reply.code(201).send({ job, balance: await balance(tenantId) });
    } catch (error) {
      if (error instanceof SubmissionError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });

  app.post("/v1/generations/item/:id/favorite", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { favorite?: boolean };
    const row = await getGeneration(request.tenant!.id, id);
    if (!row) return reply.code(404).send({ error: { code: "not_found", message: "生成结果不存在。" } });
    const next = body.favorite === undefined ? (row.favorite === 1 ? 0 : 1) : body.favorite ? 1 : 0;
    await db().run("UPDATE generations SET favorite=? WHERE id=? AND tenant_id=?", [next, id, request.tenant!.id]);
    return { id, favorite: next === 1 };
  });

  /** Acceptance flow: human verdict on a generation ("done means watched"). */
  app.post("/v1/generations/item/:id/review", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { verdict?: string; note?: string };
    const verdict = body.verdict === "approved" || body.verdict === "rejected" ? body.verdict : null;
    if (!verdict) return reply.code(400).send({ error: { code: "invalid_verdict", message: "verdict must be approved or rejected." } });
    const row = await getGeneration(request.tenant!.id, id);
    if (!row) return reply.code(404).send({ error: { code: "not_found", message: "生成结果不存在。" } });
    await db().run("UPDATE generations SET review_status=?, review_note=? WHERE id=? AND tenant_id=?", [
      verdict, body.note?.trim() || null, id, request.tenant!.id,
    ]);
    return { id, reviewStatus: verdict };
  });

  /** QC-failed rejection → one free re-render of this single generation. */
  app.post("/v1/generations/item/:id/regenerate", async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.tenant!.id;
    const row = await getGeneration(tenantId, id);
    if (!row) return reply.code(404).send({ error: { code: "not_found", message: "生成结果不存在。" } });
    const existing = await db().get<{ n: number }>(
      "SELECT CAST(COUNT(*) AS INTEGER) AS n FROM jobs WHERE free_resample_of=?",
      [id],
    );
    if ((existing?.n ?? 0) > 0) {
      return reply.code(409).send({ error: { code: "already_regenerated", message: "This generation already used its free re-render." } });
    }
    const job = await getJob(row.job_id, tenantId);
    if (!job) return reply.code(404).send({ error: { code: "not_found", message: "源作业不存在。" } });
    try {
      const newJob = await submitGeneration(tenantId, {
        kind: job.kind,
        model: job.model,
        prompt: job.prompt,
        templateId: job.template_id ?? undefined,
        freeResampleOf: id,
        params: { ...JSON.parse(job.params), count: 1, references: JSON.parse(job.params).references },
      });
      return reply.code(201).send({ job: newJob });
    } catch (error) {
      if (error instanceof SubmissionError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });

  app.get("/v1/generations/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await getJob(id, request.tenant!.id);
    if (!job) return reply.code(404).send({ error: { code: "not_found", message: "作业不存在。" } });

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (payload: unknown) => reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    send({ type: "status", jobId: job.id, status: job.status, progress: job.progress });

    if (job.status === "succeeded" || job.status === "failed") {
      send({ type: "done", jobId: job.id, status: job.status, ...(job.error ? { error: job.error } : {}) });
      reply.raw.end();
      return;
    }
    const unsubscribe = subscribeJob(job.id, (event) => {
      send(event);
      if (event.type === "done") reply.raw.end();
    });
    request.raw.on("close", () => unsubscribe());
  });
}
