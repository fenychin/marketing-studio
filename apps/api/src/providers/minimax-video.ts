import type { GenerateContext, ModelProvider, ProducedArtifact } from "./types.js";
import { aspectSize } from "../placeholder.js";

/**
 * MiniMax 视频渠道适配器(H3/Hailuo 系列):
 *   POST {baseUrl}/video_generation     {model, prompt, first_frame_image?, duration} → {task_id}
 *   GET  {baseUrl}/query?task_id=...    → {status: Queueing|Processing|Success|Failed, file: {file_id?}, file_id?}
 *   GET  {baseUrl}/files/retrieve?file_id=... → {file: {download_url}}
 *   GET  {download_url}                 → mp4
 * 首帧/参考图以 base64 data URI 提交(官方协议支持)。
 */

interface MiniMaxFileResponse {
  file?: { file_id?: string; download_url?: string };
  file_id?: string;
}

export class MiniMaxVideoProvider implements ModelProvider {
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
      const body: Record<string, unknown> = {
        model: this.model,
        prompt: ctx.prompt,
        duration: Math.min(10, ctx.params.durationSec ?? 6),
        size: `${width}x${height}`,
      };
      const firstImage = ctx.references.find((r) => r.mime.startsWith("image/"));
      if (firstImage) {
        body.first_frame_image = `data:${firstImage.mime};base64,${firstImage.buffer.toString("base64")}`;
      }

      const submit = await fetch(`${this.baseUrl}/video_generation`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!submit.ok) throw new Error(`minimax submit ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
      const { task_id: taskId } = (await submit.json()) as { task_id?: string };
      if (!taskId) throw new Error("minimax submit returned no task_id");

      const downloadUrl = await this.poll(taskId, ctx);
      const media = await fetch(downloadUrl);
      if (!media.ok) throw new Error(`minimax download failed ${media.status}`);
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
      if (Date.now() - started > timeoutMs) throw new Error(`minimax task ${taskId} timed out`);
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(8000, Math.round(delayMs * 1.3));

      const query = await fetch(`${this.baseUrl}/query?task_id=${encodeURIComponent(taskId)}`, {
        headers: { authorization: `Bearer ${this.apiKey}` },
      });
      if (!query.ok) throw new Error(`minimax query failed ${query.status}`);
      const body = (await query.json()) as {
        status?: string;
        file_id?: string;
        file?: MiniMaxFileResponse["file"];
      };
      const status = body.status ?? "";
      ctx.reportProgress(status === "Processing" ? 60 : 25, `minimax: ${status}`);

      if (status === "Fail" || status === "Failed") throw new Error("minimax task failed");

      if (status === "Success") {
        const fileId = body.file?.file_id ?? body.file_id;
        if (body.file?.download_url)
          return body.file.download_url.startsWith("http") ? body.file.download_url : `${this.baseUrl}${body.file.download_url}`;
        if (!fileId) throw new Error("minimax task succeeded without file");
        const fileResp = await fetch(`${this.baseUrl}/files/retrieve?file_id=${encodeURIComponent(fileId)}`, {
          headers: { authorization: `Bearer ${this.apiKey}` },
        });
        if (!fileResp.ok) throw new Error(`minimax files/retrieve failed ${fileResp.status}`);
        const fileBody = (await fileResp.json()) as MiniMaxFileResponse;
        const downloadUrl = fileBody.file?.download_url;
        if (!downloadUrl) throw new Error("minimax file has no download_url");
        return downloadUrl.startsWith("http") ? downloadUrl : `${this.baseUrl}${downloadUrl}`;
      }
    }
  }
}
