import type { FastifyInstance } from "fastify";
import { evaluateGeneration } from "../jobs.js";
import { balance } from "../credits.js";
import { db } from "../db/index.js";
import { defaultModel, resolveModel } from "../providers/registry.js";
import { composeAdReference, composeProductLink } from "../agents/pipeline.js";
import type { CreateGenerationRequest, Kind } from "@studio/shared";

/**
 * Plan-mode: price and pre-flight a run without spending credits or creating
 * work — the "plan before build" half of the budget gate. Agent pipelines
 * compose for real (analysis + script) so the plan reflects the true workload.
 */
export function registerPlanRoutes(app: FastifyInstance): void {
  app.post("/v1/plan", async (request) => {
    const tenantId = request.tenant!.id;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const balanceBefore = await balance(tenantId);
    const agent = body.agent as { type?: string; referenceAssetId?: string; transcript?: string; tone?: string; url?: string } | undefined;
    const templateId = body.templateId as string | undefined;

    try {
      // --- agent pipelines: real composition, no submission ---
      // Both pipelines submit to studio-render-v1; plan must quote the same model.
      if (agent?.type === "ad-reference") {
        if (!agent.referenceAssetId) {
          return planResponse(false, ["missing_reference: referenceAssetId is required."], null, null, balanceBefore, {
            agent: "ad-reference",
          });
        }
        const composed = await composeAdReference(tenantId, {
          referenceAssetId: agent.referenceAssetId,
          transcript: agent.transcript,
          tone: agent.tone,
        });
        const model = resolveModel("studio-render-v1", "video") ?? defaultModel("video");
        const cost = { creditsPerUnit: model.creditsPerUnit, count: 1, total: model.creditsPerUnit };
        return planResponse(balanceBefore >= cost.total, balanceBefore < cost.total ? [`insufficient_credits: needs ${cost.total} credits`] : [], cost, model.id, balanceBefore, {
          agent: "ad-reference",
          script: composed.script,
          durationSec: composed.durationSec,
          beats: composed.pacing.segmentCount,
          composer: composed.composer,
          transcriptSource: composed.transcriptSource,
          pacing: { beats: composed.pacing.segmentCount, durationSec: composed.pacing.durationSec },
        });
      }

      if (agent?.type === "product-link") {
        if (!agent.url) {
          return planResponse(false, ["invalid_url: url is required."], null, null, balanceBefore, { agent: "product-link" });
        }
        const composed = await composeProductLink({ url: agent.url, tone: agent.tone });
        const model = resolveModel("studio-render-v1", "video") ?? defaultModel("video");
        const cost = { creditsPerUnit: model.creditsPerUnit, count: 1, total: model.creditsPerUnit };
        return planResponse(balanceBefore >= cost.total, balanceBefore < cost.total ? [`insufficient_credits: needs ${cost.total} credits`] : [], cost, model.id, balanceBefore, {
          agent: "product-link",
          script: composed.script,
          durationSec: 10,
          composer: composed.composer,
          product: { name: composed.product.name, price: composed.product.price },
        });
      }

      // --- template recreate ---
      if (templateId) {
        const template = await db().get<{ kind: Kind; prompt_template: string; aspect_ratio: string }>(
          "SELECT kind,prompt_template,aspect_ratio FROM templates WHERE id=?",
          [templateId],
        );
        if (!template) {
          return planResponse(false, ["not_found: template not found."], null, null, balanceBefore, null);
        }
        const count = Math.min(Math.max(Number(body.count ?? 4), 1), 4);
        const request: CreateGenerationRequest = {
          kind: template.kind,
          model: defaultModel(template.kind).id,
          prompt: template.prompt_template,
          params: { aspectRatio: template.aspect_ratio as never, count },
        };
        const evaluation = await evaluateGeneration(tenantId, request);
        return planResponse(evaluation.issues.length === 0, evaluation.issues.map((i) => `${i.code}: ${i.message}`), evaluation.cost, evaluation.modelId, balanceBefore, {
          template: true,
          kind: template.kind,
          prompt: template.prompt_template,
        });
      }

      // --- direct generation ---
      const payload = (request.body ?? {}) as CreateGenerationRequest;
      const evaluation = await evaluateGeneration(tenantId, payload);
      return planResponse(evaluation.issues.length === 0, evaluation.issues.map((i) => `${i.code}: ${i.message}`), evaluation.cost, evaluation.modelId, balanceBefore, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return planResponse(false, [message], null, null, balanceBefore, null);
    }
  });
}

function planResponse(
  valid: boolean,
  issues: string[],
  cost: { creditsPerUnit: number; count: number; total: number } | null,
  modelId: string | null,
  balanceBefore: number,
  preview: Record<string, unknown> | null,
) {
  return {
    valid,
    issues,
    cost,
    model: modelId,
    balance: { before: balanceBefore, after: cost ? balanceBefore - (valid ? cost.total : 0) : balanceBefore },
    preview,
  };
}
