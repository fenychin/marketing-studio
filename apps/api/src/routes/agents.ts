import type { FastifyInstance } from "fastify";
import { runAdReferencePipeline, runProductLinkPipeline, SubmissionError } from "../agents/pipeline.js";


export function registerAgentRoutes(app: FastifyInstance): void {
  /** Paste a viral ad (upload) → rhythm clone selling the product. */
  app.post("/v1/agents/ad-reference", async (request, reply) => {
    const body = (request.body ?? {}) as {
      referenceAssetId?: string;
      productAssetId?: string;
      transcript?: string;
      tone?: string;
    };
    if (!body.referenceAssetId) {
      return reply.code(400).send({ error: { code: "missing_reference", message: "referenceAssetId is required." } });
    }
    try {
      const job = await runAdReferencePipeline(request.tenant!.id, {
        referenceAssetId: body.referenceAssetId,
        productAssetId: body.productAssetId,
        transcript: body.transcript,
        tone: body.tone,
      });
      return reply.code(201).send({ job });
    } catch (error) {
      if (error instanceof SubmissionError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });

  /** Drop a product URL → scrape → script → one-click ad. */
  app.post("/v1/agents/product-link", async (request, reply) => {
    const body = (request.body ?? {}) as { url?: string; tone?: string };
    if (!body.url || body.url.trim().length < 4) {
      return reply.code(400).send({ error: { code: "invalid_url", message: "A product URL is required." } });
    }
    try {
      const job = await runProductLinkPipeline(request.tenant!.id, { url: body.url.trim(), tone: body.tone });
      return reply.code(201).send({ job });
    } catch (error) {
      if (error instanceof SubmissionError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });
}
