import type { GenerationDto, JobDto, JobStatus, Kind } from "@studio/shared";
import { db } from "./db/index.js";
import { assetToDto, type AssetRow } from "./storage.js";

export interface JobRow {
  id: string;
  tenant_id: string;
  kind: Kind;
  model: string;
  prompt: string;
  params: string;
  status: JobStatus;
  progress: number;
  cost_credits: number;
  error: string | null;
  template_id: string | null;
  free_resample_of: string | null;
  created_at: string;
  updated_at: string;
}

export interface GenerationRow {
  id: string;
  tenant_id: string;
  job_id: string;
  asset_id: string;
  kind: Kind;
  model: string;
  idx: number;
  favorite: number;
  meta: string;
  qc_status: string | null;
  review_status: string | null;
  created_at: string;
}

interface JoinedGeneration extends GenerationRow {
  sha: string;
  ext: string;
  access_token: string;
  mime: string;
  bytes: number;
}

export function generationToDto(row: JoinedGeneration): GenerationDto {
  const asset: AssetRow = {
    id: row.asset_id,
    tenant_id: row.tenant_id,
    kind: row.kind,
    mime: row.mime,
    bytes: row.bytes,
    sha: row.sha,
    ext: row.ext,
    access_token: row.access_token,
    created_at: row.created_at,
  };
  return {
    id: row.id,
    jobId: row.job_id,
    url: assetToDto(asset).url,
    kind: row.kind,
    model: row.model,
    index: row.idx,
    favorite: row.favorite === 1,
    meta: JSON.parse(row.meta || "{}") as Record<string, string>,
    qcStatus: (row.qc_status as "passed" | "flagged" | null) ?? null,
    reviewStatus: (row.review_status as "approved" | "rejected" | null) ?? null,
    createdAt: row.created_at,
  };
}

export function jobToDto(job: JobRow, generations: GenerationDto[]): JobDto {
  return {
    id: job.id,
    kind: job.kind,
    model: job.model,
    prompt: job.prompt,
    params: JSON.parse(job.params) as JobDto["params"],
    status: job.status,
    progress: job.progress,
    costCredits: job.cost_credits,
    ...(job.error ? { error: job.error } : {}),
    ...(job.template_id ? { templateId: job.template_id } : {}),
    generations,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

export async function getJob(jobId: string, tenantId: string): Promise<JobRow | undefined> {
  return db().get<JobRow>("SELECT * FROM jobs WHERE id=? AND tenant_id=?", [jobId, tenantId]);
}

export async function listJobs(tenantId: string, filter: { kind?: Kind; status?: JobStatus; limit?: number }): Promise<JobRow[]> {
  const clauses = ["tenant_id=?"];
  const args: Array<string | number> = [tenantId];
  if (filter.kind) {
    clauses.push("kind=?");
    args.push(filter.kind);
  }
  if (filter.status) {
    clauses.push("status=?");
    args.push(filter.status);
  }
  args.push(filter.limit ?? 60);
  return db().all<JobRow>(
    `SELECT * FROM jobs WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
    args,
  );
}

export async function generationsForJobs(tenantId: string, jobIds: string[]): Promise<Map<string, GenerationDto[]>> {
  const map = new Map<string, GenerationDto[]>();
  if (jobIds.length === 0) return map;
  const placeholders = jobIds.map(() => "?").join(",");
  const rows = await db().all<JoinedGeneration>(
    `SELECT g.*, a.sha, a.ext, a.access_token, a.mime, a.bytes
     FROM generations g JOIN assets a ON a.id = g.asset_id
     WHERE g.tenant_id=? AND g.job_id IN (${placeholders})
     ORDER BY g.created_at ASC`,
    [tenantId, ...jobIds],
  );
  for (const row of rows) {
    const list = map.get(row.job_id) ?? [];
    list.push(generationToDto(row));
    map.set(row.job_id, list);
  }
  return map;
}

export async function getGeneration(tenantId: string, generationId: string): Promise<JoinedGeneration | undefined> {
  return db().get<JoinedGeneration>(
    `SELECT g.*, a.sha, a.ext, a.access_token, a.mime, a.bytes
     FROM generations g JOIN assets a ON a.id = g.asset_id
     WHERE g.tenant_id=? AND g.id=?`,
    [tenantId, generationId],
  );
}

export async function listFavoriteGenerations(tenantId: string, limit = 100): Promise<GenerationDto[]> {
  const rows = await db().all<JoinedGeneration>(
    `SELECT g.*, a.sha, a.ext, a.access_token, a.mime, a.bytes
     FROM generations g JOIN assets a ON a.id = g.asset_id
     WHERE g.tenant_id=? AND g.favorite=1
     ORDER BY g.created_at DESC LIMIT ?`,
    [tenantId, limit],
  );
  return rows.map(generationToDto);
}
