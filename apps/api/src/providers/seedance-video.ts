import type { GenerateContext, ModelProvider, ProducedArtifact } from "./types.js";

/**
 * Seedance 渠道适配器(火山方舟 Ark contents/generations 协议,Seedance 2.5):
 *   POST {baseUrl}/contents/generations/tasks      {model, content:[{type:text},{type:image_url}]} → {id}
 *   GET  {baseUrl}/contents/generations/tasks/{id} → {status: queued|running|succeeded|failed, content: {video_url}}
 *   GET  {video_url}                               → mp4
 * 参考图(商品图/模板封面)以 image_url data URI 进入 content 序列。
 */

interface ArkTaskResponse {
  id?: string;
  status?: string;
  error?: { message?: string } | string;
  content?: { video_url?: string };
}

export class SeedanceProvider implements ModelProvider {
  constructor(
    readonly id: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async run(ctx: GenerateContext): Promise<ProducedArtifact[]> {
    const out: ProducedArtifact[] = [];

    for (let i = 0; i < ctx.params.count; i++) {
      const content: Array<{ type: string; text?: string; image_url?: { url: string }; role?: string }> = [
        { type: "text", text: ctx.prompt + (ctx.params.durationSec ? ` —— 时长 ${ctx.params.durationSec} 秒。` : "") },
      ];
      for (const ref of ctx.references.slice(0, 4)) {
        if (ref.mime.startsWith("image/")) {
          content.push({ type: "image_url", image_url: { url: `data:${ref.mime};base64,${ref.buffer.toString("base64")}` }, role: "first_frame" });
          break; // 首帧参考一张即可,余图进提示词语义
        }
      }

      const submit = await fetch(`${this.baseUrl}/contents/generations/tasks`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, content }),
      });
      if (!submit.ok) throw new Error(`seedance submit ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
      const { id: taskId } = (await submit.json()) as { id?: string };
      if (!taskId) throw new Error("seedance submit returned no task id");

      const videoUrl = await this.poll(taskId, ctx);
      const media = await fetch(videoUrl);
      if (!media.ok) throw new Error(`seedance download failed ${media.status}`);
      await ctx.storeArtifact(Buffer.from(await media.arrayBuffer()), media.headers.get("content-type") ?? "video/mp4");
      out.push({ mime: "video/mp4", meta: { channel: this.model, taskId } });
      ctx.reportProgress(92, `task ${taskId} downloaded`);
    }
    return out;
  }

  private async poll(taskId: string, ctx: GenerateContext): Promise<string> {
    const started = Date.now();
    const timeoutMs = 15 * 60 * 1000;
    let delayMs = 3000;
    for (;;) {
      if (Date.now() - started > timeoutMs) throw new Error(`seedance task ${taskId} timed out`);
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(8000, Math.round(delayMs * 1.3));

      const query = await fetch(`${this.baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
        headers: { authorization: `Bearer ${this.apiKey}` },
      });
      if (!query.ok && query.status !== 404) throw new Error(`seedance poll failed ${query.status}`);
      const body = (await query.json()) as ArkTaskResponse;
      const status = body.status ?? "running";
      ctx.reportProgress(status === "running" ? 55 : 20, `seedance: ${status}`);

      if (status === "failed") {
        const message = typeof body.error === "string" ? body.error : body.error?.message ?? "seedance task failed";
        throw new Error(message);
      }
      if (status === "succeeded") {
        const videoUrl = body.content?.video_url;
        if (!videoUrl) throw new Error("seedance task succeeded without video_url");
        return videoUrl.startsWith("http") ? videoUrl : `${this.baseUrl}${videoUrl}`;
      }
    }
  }
}
