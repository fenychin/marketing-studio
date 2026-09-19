import { getAsset, readArtifact, storeArtifact } from "../storage.js";
import { submitGeneration, SubmissionError } from "../jobs.js";
import type { PacingModel } from "./analyze.js";
import type { AdDNA, AspectRatio, RecreateReport } from "@studio/shared";
import { composeScript, type ProductInfo } from "./compose.js";
import { buildAdDNA } from "./dna.js";
import { rewriteScript } from "./rewrite.js";
import { buildRecreateReport } from "./report.js";
import { PLATFORM_PRESETS, buildPlatformDNA, listPlatformIds } from "./platforms.js";
import { fetchProductPage, guardedFetch } from "./fetcher.js";
import type { JobDto } from "@studio/shared";

/**
 * Agentic pipelines: reference-ad cloning and product-link one-click ads.
 * Composition (analyze + write) is separated from submission so /v1/plan can
 * run it read-only; heavy rendering stays in the job queue via the M4 engine.
 * Both pipelines produce an AdDNA + per-beat script + recreate-report — the
 * replica contract travels with the job.
 */

const clampDuration = (sec: number): number => Math.min(30, Math.max(3, Math.round(sec)));

export interface AdReferenceComposition {
  script: string;
  composer: "llm" | "rule";
  transcriptSource: "pasted" | "asr" | "none";
  durationSec: number;
  /** Legacy pacing summary (plan preview keeps consuming it). */
  pacing: PacingModel;
  /** Full replica contract — persisted in the job's agent metadata. */
  dna: AdDNA;
  /** Per-beat rewritten texts, index-aligned with dna.beats (render input). */
  beatTexts: Array<{ index: number; text: string }>;
  /** Share of beats whose script landed inside its word window. */
  energyMatch: number;
  language: "zh" | "en";
  report: RecreateReport;
}

export async function composeAdReference(
  tenantId: string,
  request: { referenceAssetId: string; transcript?: string; tone?: string; mode?: "strict" | "loose" },
): Promise<AdReferenceComposition> {
  const asset = await getAsset(tenantId, request.referenceAssetId);
  if (!asset) throw new SubmissionError(404, "not_found", "参考素材不存在。");
  const videoBuffer = await readArtifact(asset);

  // AdDNA: beat fusion + transcript tiers (pasted > ASR > rate assumption)
  // happen inside the parser; the rewriter then fills every beat within its
  // word window — LLM constrained JSON with deterministic rule fallback.
  const dna = await buildAdDNA(videoBuffer, {
    transcript: request.transcript,
    aspectRatio: "9:16",
    resolution: 720,
  });
  const rewritten = await rewriteScript({ dna, product: { name: "your product" }, tone: request.tone });
  const beatTexts = rewritten.beats.map((b) => ({ index: b.index, text: b.text }));

  const report = buildRecreateReport({
    dna,
    beatTexts,
    language: rewritten.language,
    renderedDurationSec: dna.durationSec,
    aspectRatio: "9:16",
    mode: request.mode ?? "loose",
  });
  if (report.mode === "strict" && report.score < 1) {
    const failed = report.gates.filter((g) => !g.pass).map((g) => `${g.key}: ${g.detail}`).join("; ");
    throw new SubmissionError(422, "replica_gates_failed", `Strict replication gates failed — ${failed}`);
  }

  const pacing: PacingModel = {
    durationSec: dna.durationSec,
    segmentCount: dna.beats.length,
    meanSegmentSec:
      dna.beats.length > 0
        ? dna.beats.reduce((sum, b) => sum + (b.endSec - b.startSec), 0) / dna.beats.length
        : 0,
    segments: dna.beats.map((b) => ({ startSec: b.startSec, endSec: b.endSec })),
    hasAudio: dna.provenance.beatSource.includes("audio"),
  };

  return {
    script: rewritten.script,
    composer: rewritten.composer,
    transcriptSource: dna.provenance.transcriptSource,
    durationSec: clampDuration(dna.durationSec),
    pacing,
    dna,
    beatTexts,
    energyMatch: rewritten.energyMatch,
    language: rewritten.language,
    report,
  };
}

export async function runAdReferencePipeline(
  tenantId: string,
  request: { referenceAssetId: string; productAssetId?: string; transcript?: string; tone?: string; mode?: "strict" | "loose" },
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
        language: composed.language,
        energyMatch: composed.energyMatch,
        pacing: { beats: composed.pacing.segmentCount, durationSec: composed.pacing.durationSec, meanSegmentSec: composed.pacing.meanSegmentSec },
        dna: composed.dna,
        beatTexts: composed.beatTexts,
        report: composed.report,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Product link v2: one URL → per-platform AdDNA → per-platform jobs
// ---------------------------------------------------------------------------

export interface PlatformComposition {
  platform: string;
  script: string;
  beatTexts: Array<{ index: number; text: string }>;
  composer: "llm" | "rule";
  language: "zh" | "en";
  dna: AdDNA;
  energyMatch: number;
  report: RecreateReport;
}

export interface ProductLinkComposition {
  product: ProductInfo;
  /** Stored reference images (first is the product shot every job shares). */
  images: Array<{ assetId: string; url: string }>;
  productAssetId?: string;
  platforms: PlatformComposition[];
  composer: "llm" | "rule";
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function downloadImage(rawUrl: string): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const response = await guardedFetch(rawUrl);
    if (!response.ok) return null;
    const mime = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim();
    if (!mime.startsWith("image/")) return null;
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done || received > MAX_IMAGE_BYTES) break;
      chunks.push(value!);
      received += value!.byteLength;
    }
    if (received === 0 || received > MAX_IMAGE_BYTES) return null;
    return { buffer: Buffer.concat(chunks), mime };
  } catch {
    return null; // a broken image never blocks the pipeline
  }
}

export async function composeProductLink(
  tenantId: string,
  request: { url: string; tone?: string; platforms?: string[]; variantsPerPlatform?: number },
): Promise<ProductLinkComposition> {
  const page = await fetchProductPage(request.url);
  if (!page.title) throw new SubmissionError(422, "scrape_failed", "无法从该页面读取商品标题。");

  const product: ProductInfo = { name: page.title, description: page.description, price: page.price, url: page.url };

  // Store up to 3 reference images; the first is the shared product shot.
  const images: Array<{ assetId: string; url: string }> = [];
  for (const imageUrl of page.images.slice(0, 3)) {
    const image = await downloadImage(imageUrl);
    if (!image) continue;
    try {
      const asset = await storeArtifact(tenantId, image.buffer, image.mime, "upload");
      images.push({ assetId: asset.id, url: imageUrl });
    } catch {
      // storage failure on an image is non-fatal
    }
  }
  const productAssetId = images[0]?.assetId;

  const requested = request.platforms?.filter((p) => p in PLATFORM_PRESETS) ?? [];
  const platformIds = requested.length > 0 ? requested : listPlatformIds();

  const platforms = await Promise.all(
    platformIds.map(async (platformId) => {
      const preset = PLATFORM_PRESETS[platformId]!;
      const dna = buildPlatformDNA(preset, product);
      const rewritten = await rewriteScript({ dna, product, tone: request.tone });
      const beatTexts = rewritten.beats.map((b) => ({ index: b.index, text: b.text }));
      const report = buildRecreateReport({
        dna,
        beatTexts,
        language: rewritten.language,
        renderedDurationSec: dna.durationSec,
        aspectRatio: dna.canvas.aspectRatio,
        mode: "loose",
      });
      return {
        platform: platformId,
        script: rewritten.script,
        beatTexts,
        composer: rewritten.composer,
        language: rewritten.language,
        dna,
        energyMatch: rewritten.energyMatch,
        report,
      };
    }),
  );

  return {
    product,
    images,
    productAssetId,
    platforms,
    composer: platforms[0]?.composer ?? "rule",
  };
}

export async function runProductLinkPipeline(
  tenantId: string,
  request: { url: string; tone?: string; platforms?: string[]; variantsPerPlatform?: number },
): Promise<JobDto[]> {
  const composed = await composeProductLink(tenantId, request);
  const variants = Math.min(3, Math.max(1, request.variantsPerPlatform ?? 1));

  const jobs: JobDto[] = [];
  for (const platform of composed.platforms) {
    for (let v = 0; v < variants; v++) {
      jobs.push(
        await submitGeneration(tenantId, {
          kind: "video",
          model: "studio-render-v1",
          prompt: platform.script,
          params: {
            aspectRatio: platform.dna.canvas.aspectRatio as AspectRatio,
            resolution: "720p",
            durationSec: platform.dna.durationSec,
            count: 1,
            ...(composed.productAssetId ? { references: [{ assetId: composed.productAssetId, role: "product" as const }] } : {}),
            agent: {
              source: "product-link",
              platform: platform.platform,
              composer: platform.composer,
              language: platform.language,
              energyMatch: platform.energyMatch,
              url: composed.product.url ?? request.url,
              productTitle: composed.product.name,
              ...(composed.product.price ? { price: composed.product.price } : {}),
              dna: platform.dna,
              beatTexts: platform.beatTexts,
              report: platform.report,
            },
          },
        }),
      );
    }
  }
  if (jobs.length === 0) throw new SubmissionError(422, "no_platforms", "没有有效的平台预设。");
  return jobs;
}

export { SubmissionError };
