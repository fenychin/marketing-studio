import { placeholderSvg, svgBuffer, aspectSize } from "../placeholder.js";
import type { GenerateContext, ModelProvider, ProducedArtifact } from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function shortLabel(prompt: string): string {
  const cleaned = prompt.replace(/[^\p{L}\p{N} ]/gu, " ").trim();
  return cleaned.split(/\s+/).slice(0, 2).join(" ") || "Product";
}

/**
 * Deterministic offline provider: renders programmatic SVG art with simulated
 * progress so the whole product loop works with zero external accounts.
 */
export class MockProvider implements ModelProvider {
  readonly id = "mock";

  constructor(private readonly kind: "image" | "video") {}

  async run(ctx: GenerateContext): Promise<ProducedArtifact[]> {
    const { width, height } = aspectSize(ctx.params.aspectRatio, this.kind === "video" ? 900 : 1024);
    const out: ProducedArtifact[] = [];
    const total = ctx.params.count;

    for (let i = 0; i < total; i++) {
      await sleep(900);
      ctx.reportProgress(Math.round(((i + 0.5) / total) * 88) + 8, `rendering ${i + 1}/${total}`);
      const svg = placeholderSvg({
        seed: ctx.seedBase + i * 7919,
        width,
        height,
        label: shortLabel(ctx.prompt),
        kind: this.kind,
        animate: this.kind === "video",
      });
      await ctx.storeArtifact(svgBuffer(svg), "image/svg+xml");
      out.push({ mime: "image/svg+xml", meta: { label: shortLabel(ctx.prompt) } });
    }
    return out;
  }
}
