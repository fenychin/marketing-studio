import type { GenerateContext, ModelProvider, ProducedArtifact } from "./types.js";
import { aspectSize } from "../placeholder.js";

/**
 * Adapter for channels speaking the common async-task video protocol:
 *   POST {baseUrl}/tasks            {model, prompt, aspect_ratio, duration} → {id}
 *   GET  {baseUrl}/tasks/{id}       → {status: queued|running|succeeded|failed, video_url?, error?}
 *   GET  {video_url}                → mp4 bytes
 * Seedance-class gateways (and our apps/mock-channel) follow this shape.
 */
export class AsyncVideoProvider implements ModelProvider {
  constructor(
    readonly id: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async run(ctx: GenerateContext): Promise<ProducedArtifact[]> {
    const { width, height } = aspectSize(ctx.params.aspectRatio, 720);
    const out: ProducedArtifact[] = [];

    for (let i = 0; i < ctx.params.count; i++) {
      const firstImage = ctx.references.find((r) => r.mime.startsWith("image/"));
      const submit = await fetch(`${this.baseUrl}/tasks`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt: ctx.prompt,
          aspect_ratio: ctx.params.aspectRatio,
          duration: ctx.params.durationSec ?? 5,
          index: i,
          ...(firstImage
            ? { first_frame_image: `data:${firstImage.mime};base64,${firstImage.buffer.toString("base64")}` }
            : {}),
        }),
      });
      if (!submit.ok) throw new Error(`submit failed ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
      const { id } = (await submit.json()) as { id: string };

      const videoUrl = await this.poll(id, ctx);
      const media = await fetch(videoUrl);
      if (!media.ok) throw new Error(`download failed ${media.status}`);
      await ctx.storeArtifact(Buffer.from(await media.arrayBuffer()), media.headers.get("content-type") ?? "video/mp4");
      out.push({ mime: "video/mp4", meta: { channel: this.model, taskId: id } });
      ctx.reportProgress(92, `task ${id} downloaded`);
    }
    return out;
  }

  private async poll(taskId: string, ctx: GenerateContext): Promise<string> {
    const started = Date.now();
    const timeoutMs = 10 * 60 * 1000;
    let delayMs = 1500;
    for (;;) {
      if (Date.now() - started > timeoutMs) throw new Error(`task ${taskId} timed out`);
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(5000, Math.round(delayMs * 1.3));
      const response = await fetch(`${this.baseUrl}/tasks/${taskId}`, {
        headers: { authorization: `Bearer ${this.apiKey}` },
      });
      if (!response.ok) throw new Error(`poll failed ${response.status}`);
      const body = (await response.json()) as { status: string; video_url?: string; error?: string; progress?: number };
      ctx.reportProgress(Math.max(12, Math.min(90, body.progress ?? 12)), `channel: ${body.status}`);
      if (body.status === "succeeded" && body.video_url) {
        return body.video_url.startsWith("http") ? body.video_url : `${this.baseUrl}${body.video_url}`;
      }
      if (body.status === "failed") throw new Error(body.error ?? "channel task failed");
    }
  }
}
