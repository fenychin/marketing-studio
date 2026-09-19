import type { GenerateContext, ModelProvider, ProducedArtifact } from "./types.js";
import { synthesizeAlignment } from "../video/aligner.js";
import { buildRenderPlan } from "../video/timeline.js";
import { renderVideo } from "../video/render.js";

/**
 * M4 rendering engine as a model: narration (the prompt) is word-aligned,
 * projected onto a semantic timeline, composed frame-by-frame and encoded to
 * a real MP4 — fully local, no external channel.
 */
export class LocalRenderProvider implements ModelProvider {
  readonly id = "local-render";

  async run(ctx: GenerateContext): Promise<ProducedArtifact[]> {
    const durationSec = Math.min(15, Math.max(5, ctx.params.durationSec ?? 8));
    const alignment = synthesizeAlignment(ctx.prompt, durationSec);
    const plan = buildRenderPlan(alignment, {
      aspectRatio: ctx.params.aspectRatio,
      resolution: resolutionBase(ctx.params.resolution ?? "720p"),
      seed: ctx.seedBase,
    });
    ctx.reportProgress(6, `plan: ${plan.words.length} words, ${plan.scenes.length} scenes, ${plan.totalFrames} frames`);

    const out: ProducedArtifact[] = [];
    for (let i = 0; i < ctx.params.count; i++) {
      const mp4 = await renderVideo(
        plan,
        (percent, note) => ctx.reportProgress(percent, note),
      );
      await ctx.storeArtifact(mp4, "video/mp4");
      out.push({
        mime: "video/mp4",
        meta: { renderer: "word-anchored-v1", words: String(plan.words.length), frames: String(plan.totalFrames) },
      });
    }
    return out;
  }
}

function resolutionBase(resolution: string): number {
  const map: Record<string, number> = { "540p": 540, "720p": 720, "1080p": 1080 };
  return map[resolution] ?? 720;
}
