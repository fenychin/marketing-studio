import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { aspectSize } from "../placeholder.js";
import { defaultModel } from "../providers/registry.js";
import { SubmissionError, submitGeneration } from "../jobs.js";
import type { TemplateCategory, TemplateDto } from "@studio/shared";

interface TemplateRow {
  id: string;
  slug: string;
  title: string;
  category: TemplateCategory;
  kind: "image" | "video";
  credits: number;
  aspect_ratio: string;
  prompt_template: string;
  seed: number;
}

function toDto(row: TemplateRow): TemplateDto {
  const { width, height } = aspectSize(row.aspect_ratio, 720);
  const label = row.kind === "video" ? `${row.title} · motion` : row.title;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    kind: row.kind,
    credits: row.credits,
    aspectRatio: row.aspect_ratio as TemplateDto["aspectRatio"],
    thumbUrl: `/v1/assets/placeholder?seed=${row.seed}&w=${width}&h=${height}&kind=${row.kind}&label=${encodeURIComponent(label)}`,
    promptTemplate: row.prompt_template,
  };
}

export function registerTemplateRoutes(app: FastifyInstance): void {
  app.get("/v1/templates", async (request) => {
    const query = request.query as { category?: string; kind?: string };
    const rows = await db().all<TemplateRow>("SELECT * FROM templates ORDER BY seed");
    const filtered = rows.filter(
      (r) =>
        (query.category === undefined || query.category === "all" || r.category === query.category) &&
        (query.kind === undefined || query.kind === "all" || r.kind === query.kind),
    );
    return { templates: filtered.map(toDto) };
  });

  app.post("/v1/templates/:id/recreate", async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.tenant!.id;
    const body = (request.body ?? {}) as {
      productAssetId?: string;
      avatarAssetId?: string;
      edit?: string;
      count?: number;
    };
    const template = await db().get<TemplateRow>("SELECT * FROM templates WHERE id=?", [id]);
    if (!template) return reply.code(404).send({ error: { code: "not_found", message: "模板不存在。" } });

    const prompt = template.prompt_template
      .replaceAll("{PRODUCT}", "the uploaded product")
      .replaceAll("{AVATAR}", body.avatarAssetId ? "the uploaded avatar" : "the original talent")
      .replaceAll("{EDIT}", body.edit ? body.edit.trim() : "")
      .replace(/\s+/g, " ")
      .trim();

    const references = [] as Array<{ assetId: string; role: "product" | "avatar" | "reference" }>;
    if (body.productAssetId) references.push({ assetId: body.productAssetId, role: "product" });
    if (body.avatarAssetId) references.push({ assetId: body.avatarAssetId, role: "avatar" });

    try {
      const job = await submitGeneration(tenantId, {
        kind: template.kind,
        model: defaultModel(template.kind).id,
        prompt,
        templateId: template.id,
        params: {
          aspectRatio: template.aspect_ratio as never,
          count: Math.min(Math.max(body.count ?? 4, 1), 4),
          ...(references.length > 0 ? { references } : {}),
        },
      });
      return reply.code(201).send({ job });
    } catch (error) {
      if (error instanceof SubmissionError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });
}
