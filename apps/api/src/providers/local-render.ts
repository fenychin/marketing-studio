import type { GenerateContext, ModelProvider, ProducedArtifact } from "./types.js";
import { synthesizeAlignment } from "../video/aligner.js";
import { buildBeatRenderPlan, buildRenderPlan } from "../video/timeline.js";
import type { RenderPlan } from "../video/timeline.js";
import { alignScriptToBeats } from "../video/timeline.js";
import { renderVideo } from "../video/render.js";
import { composeBeatFrame } from "../video/template-pack.js";
import { isImageMime, prepareImage, type EmbeddableImage } from "../video/image-ops.js";
import type { AdDNA } from "@studio/shared";

/**
 * M4/M5 rendering engine as a model. Two paths behind one provider:
 *  - beat-anchored (agent pipelines): the AdDNA + per-beat script from the
 *    job's agent metadata drive a template-pack composition — beat edges are
 *    the time authority, reference images enter the frames;
 *  - direct generations: the prompt is word-aligned whole and rendered in
 *    the legacy single-look composer.
 * Both are fully local: resvg frames + ffmpeg encode, no external channel.
 */

interface AgentRenderMeta {
  dna?: AdDNA;
  beatTexts?: Array<{ index: number; text: string }>;
}

export class LocalRenderProvider implements ModelProvider {
  readonly id = "local-render";

  async run(ctx: GenerateContext): Promise<ProducedArtifact[]> {
    const durationSec = Math.min(30, Math.max(3, ctx.params.durationSec ?? 8));
    const aspectRatio = ctx.params.aspectRatio;
    const resolution = resolutionBase(ctx.params.resolution ?? "720p");

    const images: EmbeddableImage[] = [];
    for (const ref of ctx.references.slice(0, 3)) {
      if (!isImageMime(ref.mime)) continue;
      try {
        images.push(await prepareImage(ref.buffer, ref.mime));
      } catch {
        // a broken reference image never blocks the render
      }
    }

    const agent = (ctx.params.agent ?? {}) as AgentRenderMeta;
    const beatPath =
      agent.dna && agent.dna.beats.length > 0 && agent.beatTexts?.length === agent.dna.beats.length;

    let plan: RenderPlan;
    let rendererMeta: string;
    if (beatPath) {
      const beatAlignment = alignScriptToBeats(
        agent.beatTexts!.map((b) => b.text),
        agent.dna!.beats,
      );
      plan = buildBeatRenderPlan(beatAlignment, agent.dna!, {
        aspectRatio,
        resolution,
        seed: ctx.seedBase,
      });
      rendererMeta = "beat-anchored-v1";
    } else {
      const alignment = synthesizeAlignment(ctx.prompt, durationSec);
      plan = buildRenderPlan(alignment, { aspectRatio, resolution, seed: ctx.seedBase });
      rendererMeta = "word-anchored-v1";
    }
    ctx.reportProgress(
      6,
      `plan: ${plan.words.length} words, ${plan.beats ? `${plan.beats.length} beats` : `${plan.scenes.length} scenes`}, ${plan.totalFrames} frames`,
    );

    const out: ProducedArtifact[] = [];
    for (let i = 0; i < ctx.params.count; i++) {
      await ctx.throwIfCancelled();
      const mp4 = await renderVideo(
        plan,
        (percent, note) => ctx.reportProgress(percent, note),
        rendererMeta === "beat-anchored-v1" ? (p, frame) => composeBeatFrame(p, frame, images) : undefined,
        () => ctx.throwIfCancelled(),
      );
      const artifactMeta = {
        renderer: rendererMeta,
        words: String(plan.words.length),
        beats: String(plan.beats?.length ?? 0),
        frames: String(plan.totalFrames),
      };
      await ctx.storeArtifact(mp4, "video/mp4", artifactMeta);
      out.push({
        mime: "video/mp4",
        meta: artifactMeta,
      });
    }
    return out;
  }
}

function resolutionBase(resolution: string): number {
  const map: Record<string, number> = { "540p": 540, "720p": 720, "1080p": 1080 };
  return map[resolution] ?? 720;
}
