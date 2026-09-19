import { getAsset, readArtifact, storeArtifact } from "../storage.js";
import { submitGeneration, SubmissionError } from "../jobs.js";
import { analyzeReference, transcribeWithAsr, type PacingModel } from "./analyze.js";
import { composeScript, type ProductInfo } from "./compose.js";
import { fetchProductPage } from "./fetcher.js";
import type { JobDto } from "@studio/shared";

/**
 * Agentic pipelines: reference-ad cloning and product-link one-click ads.
 * Composition (analyze + write) is separated from submission so /v1/plan can
 * run it read-only; heavy rendering stays in the job queue via the M4 engine.
 */

const clampDuration = (sec: number): number => Math.min(15, Math.max(5, Math.round(sec)));

export interface AdReferenceComposition {
  script: string;
  composer: string;
  transcriptSource: "pasted" | "asr" | "none";
  pacing: PacingModel;
  durationSec: number;
}

export async function composeAdReference(
  tenantId: string,
  request: { referenceAssetId: string; transcript?: string; tone?: string },
): Promise<AdReferenceComposition> {
  const asset = await getAsset(tenantId, request.referenceAssetId);
  if (!asset) throw new SubmissionError(404, "not_found", "Reference asset not found.");
  const videoBuffer = await readArtifact(asset);

  const pacing = await analyzeReference(videoBuffer);
  const asrTranscript = request.transcript?.trim() ? null : await transcribeWithAsr(videoBuffer);
  const transcript = request.transcript?.trim() || asrTranscript;

  const composed = await composeScript({
    pacing,
    product: { name: "your product" },
    transcript,
    tone: request.tone,
  });

  return {
    script: composed.script,
    composer: composed.composer,
    transcriptSource: request.transcript?.trim() ? "pasted" : asrTranscript ? "asr" : "none",
    pacing,
    durationSec: clampDuration(pacing.durationSec),
  };
}

export async function runAdReferencePipeline(
  tenantId: string,
  request: { referenceAssetId: string; productAssetId?: string; transcript?: string; tone?: string },
): Promise<JobDto> {
  const composed = await composeAdReference(tenantId, request);
  return submitGeneration(tenantId, {
    kind: "video",
    model: "studio-render-v1",
    prompt: composed.script,
    params: {
      aspectRatio: "9:16",
      resolution: "720p",
      durationSec: composed.durationSec,
      count: 1,
      ...(request.productAssetId ? { references: [{ assetId: request.productAssetId, role: "product" as const }] } : {}),
      agent: {
        source: "ad-reference",
        composer: composed.composer,
        transcriptSource: composed.transcriptSource,
        pacing: { beats: composed.pacing.segmentCount, durationSec: composed.pacing.durationSec, meanSegmentSec: composed.pacing.meanSegmentSec },
      },
    },
  });
}

export interface ProductLinkComposition {
  script: string;
  composer: string;
  product: ProductInfo;
  imageUrl?: string;
}

export async function composeProductLink(request: { url: string; tone?: string }): Promise<ProductLinkComposition> {
  const page = await fetchProductPage(request.url);
  if (!page.title) throw new SubmissionError(422, "scrape_failed", "Could not read a product title from that page.");

  const product: ProductInfo = { name: page.title, description: page.description, price: page.price, url: page.url };
  const composed = await composeScript({
    pacing: { durationSec: 10, segmentCount: 4, meanSegmentSec: 2.5, segments: [], hasAudio: false },
    product,
    tone: request.tone,
  });
  return { script: composed.script, composer: composed.composer, product, imageUrl: page.imageUrl };
}

export async function runProductLinkPipeline(
  tenantId: string,
  request: { url: string; tone?: string },
): Promise<JobDto> {
  const composed = await composeProductLink(request);

  // og:image becomes the product reference asset automatically.
  let productAssetId: string | undefined;
  if (composed.imageUrl) {
    try {
      const image = await fetch(composed.imageUrl, { signal: AbortSignal.timeout(15000) });
      if (image.ok) {
        const buffer = Buffer.from(await image.arrayBuffer());
        const asset = await storeArtifact(tenantId, buffer, image.headers.get("content-type") ?? "image/jpeg", "upload");
        productAssetId = asset.id;
      }
    } catch {
      // hero image is optional — continue with copy only
    }
  }

  return submitGeneration(tenantId, {
    kind: "video",
    model: "studio-render-v1",
    prompt: composed.script,
    params: {
      aspectRatio: "9:16",
      resolution: "720p",
      durationSec: 10,
      count: 1,
      ...(productAssetId ? { references: [{ assetId: productAssetId, role: "product" as const }] } : {}),
      agent: {
        source: "product-link",
        composer: composed.composer,
        url: composed.product.url ?? request.url,
        productTitle: composed.product.name,
        ...(composed.product.price ? { price: composed.product.price } : {}),
      },
    },
  });
}

export { SubmissionError };
