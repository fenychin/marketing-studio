import { db } from "./db/index.js";
import { nowIso, uuid } from "./config.js";
import { resolveSecret } from "./credentials-store.js";
import { listModels, resolveModel } from "./providers/registry.js";
import { OpenAiImagesProvider } from "./providers/openai-images.js";
import { AsyncVideoProvider } from "./providers/async-video.js";
import type { ModelProvider } from "./providers/types.js";
import type { Kind, ModelInfo } from "@studio/shared";

/**
 * Tenant-owned (BYOK) model endpoints. Model resolution becomes tenant-scoped:
 * a tenant's own channels shadow nothing (name collisions with global model
 * ids are rejected at creation) and carry their own pricing — BYOK defaults
 * to zero platform credits.
 */

export interface TenantEndpointRow {
  id: string;
  tenant_id: string;
  name: string;
  kind: Kind;
  provider: string;
  model: string;
  config: string;
  credits_per_unit: number;
  disabled_at: string | null;
  created_at: string;
}

export interface ResolvedModel {
  info: ModelInfo;
  provider: ModelProvider;
}

const IMAGE_RATIOS: ModelInfo["aspectRatios"] = ["1:1", "3:4", "4:3", "9:16", "16:9"];
const VIDEO_RATIOS: ModelInfo["aspectRatios"] = ["9:16", "1:1", "16:9"];

function tenantModelInfo(row: TenantEndpointRow): ModelInfo {
  const isVideo = row.kind === "video";
  return {
    id: row.name,
    name: `${row.name} · BYOK`,
    kind: row.kind as Kind,
    provider: row.provider,
    creditsPerUnit: row.credits_per_unit,
    aspectRatios: isVideo ? VIDEO_RATIOS : IMAGE_RATIOS,
    ...(isVideo ? { resolutions: ["540p", "720p", "1080p"], durations: [5, 10, 15] } : {}),
    maxCount: isVideo ? 2 : 4,
  };
}

export async function listTenantModels(tenantId: string, kind?: Kind): Promise<ModelInfo[]> {
  const rows = await db().all<TenantEndpointRow>(
    "SELECT * FROM endpoints WHERE tenant_id=? AND disabled_at IS NULL ORDER BY created_at",
    [tenantId],
  );
  return rows
    .filter((r) => kind === undefined || r.kind === kind)
    .map(tenantModelInfo);
}

/** Resolve a model id for a tenant: own BYOK endpoints first, then the global registry. */
export async function resolveModelAny(tenantId: string, id: string, kind: Kind): Promise<ResolvedModel | null> {
  const row = await db().get<TenantEndpointRow>(
    "SELECT * FROM endpoints WHERE tenant_id=? AND name=? AND kind=? AND disabled_at IS NULL",
    [tenantId, id, kind],
  );
  if (row) {
    const config = JSON.parse(row.config || "{}") as { baseUrl?: string; credentialRef?: string };
    const apiKey = config.credentialRef ? await resolveSecret(tenantId, config.credentialRef) : null;
    if (!config.baseUrl || !apiKey) return null; // misconfigured → treated as unavailable
    let provider: ModelProvider | null = null;
    if (row.provider === "openai-images") {
      provider = new OpenAiImagesProvider(`byok:${row.name}`, config.baseUrl, apiKey, row.model);
    } else if (row.provider === "async-video") {
      provider = new AsyncVideoProvider(`byok-async:${row.name}`, config.baseUrl, apiKey, row.model);
    }
    if (!provider) return null;
    return { info: tenantModelInfo(row), provider };
  }

  const global = resolveModel(id, kind);
  if (!global) return null;
  const { provider, ...info } = global;
  return { info: { ...info, provider: provider.id }, provider };
}

export interface CreateEndpointInput {
  name: string;
  kind: Kind;
  provider: string;
  model: string;
  baseUrl: string;
  credentialRef: string;
  creditsPerUnit?: number;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;

export async function createTenantEndpoint(
  tenantId: string,
  input: CreateEndpointInput,
): Promise<{ ok: true; id: string } | { ok: false; code: string; message: string }> {
  if (!NAME_RE.test(input.name)) {
    return { ok: false, code: "invalid_name", message: "name must be 3-40 chars: a-z 0-9 dash, starting alphanumeric." };
  }
  if (listModels().some((m) => m.id === input.name)) {
    return { ok: false, code: "name_reserved", message: "This name collides with a built-in model." };
  }
  if (input.kind !== "image" && input.kind !== "video") {
    return { ok: false, code: "invalid_kind", message: "kind must be image or video." };
  }
  const allowedProviders: Record<Kind, string[]> = { image: ["openai-images"], video: ["async-video"] };
  if (!allowedProviders[input.kind].includes(input.provider)) {
    return { ok: false, code: "invalid_provider", message: `kind ${input.kind} supports providers: ${allowedProviders[input.kind].join(", ")}.` };
  }
  if (!/^https?:\/\//.test(input.baseUrl)) {
    return { ok: false, code: "invalid_base_url", message: "baseUrl must be an http(s) URL." };
  }
  if (!(await resolveSecret(tenantId, input.credentialRef))) {
    return { ok: false, code: "unknown_credential", message: `credentialRef "${input.credentialRef}" is not stored for this tenant.` };
  }
  const credits = Math.max(0, Math.round(input.creditsPerUnit ?? 0));

  const id = uuid();
  await db().run(
    "INSERT INTO endpoints(id,tenant_id,name,kind,provider,model,config,credits_per_unit,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    [id, tenantId, input.name, input.kind, input.provider, input.model, JSON.stringify({ baseUrl: input.baseUrl.replace(/\/$/, ""), credentialRef: input.credentialRef }), credits, nowIso()],
  );
  return { ok: true, id };
}

export async function disableTenantEndpoint(tenantId: string, id: string): Promise<boolean> {
  const row = await db().get<TenantEndpointRow>("SELECT id FROM endpoints WHERE tenant_id=? AND id=? AND disabled_at IS NULL", [tenantId, id]);
  if (!row) return false;
  await db().run("UPDATE endpoints SET disabled_at=? WHERE id=?", [nowIso(), id]);
  return true;
}

export async function listTenantEndpoints(tenantId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await db().all<TenantEndpointRow>(
    "SELECT * FROM endpoints WHERE tenant_id=? AND disabled_at IS NULL ORDER BY created_at",
    [tenantId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    provider: r.provider,
    model: r.model,
    config: JSON.parse(r.config || "{}"),
    creditsPerUnit: r.credits_per_unit,
    createdAt: r.created_at,
  }));
}
