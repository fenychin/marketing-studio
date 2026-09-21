import type { GenerateContext, ModelProvider, ProducedArtifact } from "./types.js";
import { aspectSize } from "../placeholder.js";

/**
 * Adapter for any channel speaking the OpenAI images protocol
 * (POST {baseUrl}/images/generations). Covers OpenAI itself and most
 * aggregator gateways; point STUDIO_OPENAI_BASE_URL at your channel.
 */
export class OpenAiImagesProvider implements ModelProvider {
  constructor(
    readonly id: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async run(ctx: GenerateContext): Promise<ProducedArtifact[]> {
    const { width, height } = aspectSize(ctx.params.aspectRatio);
    const size = `${width}x${height}`;
    const out: ProducedArtifact[] = [];
    const imageRefs = ctx.references.filter((r) => r.mime.startsWith("image/"));
    for (let i = 0; i < ctx.params.count; i++) {
      // GPT Image 参考编辑:带参考图走 /images/edits(复刻工作流),
      // 无参考图走 /images/generations(纯文生图)。
      let response: Response;
      if (imageRefs.length > 0) {
        const form = new FormData();
        form.append("model", this.model);
        form.append("prompt", ctx.prompt);
        form.append("size", size === "1024x1024" ? "1024x1024" : "auto");
        for (const ref of imageRefs.slice(0, 4)) {
          form.append("image[]", new Blob([new Uint8Array(ref.buffer)], { type: ref.mime }), `reference.${ref.mime.split("/")[1] ?? "png"}`);
        }
        response = await fetch(`${this.baseUrl}/images/edits`, {
          method: "POST",
          headers: { authorization: `Bearer ${this.apiKey}` },
          body: form,
        });
      } else {
        response = await fetch(`${this.baseUrl}/images/generations`, {
          method: "POST",
          headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: this.model, prompt: ctx.prompt, size, n: 1 }),
        });
      }
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`channel ${response.status}: ${body.slice(0, 300)}`);
      }
      const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
      const item = payload.data?.[0];
      if (item?.b64_json) {
        await ctx.storeArtifact(Buffer.from(item.b64_json, "base64"), "image/png");
      } else if (item?.url) {
        const image = await fetch(item.url);
        await ctx.storeArtifact(Buffer.from(await image.arrayBuffer()), image.headers.get("content-type") ?? "image/png");
      } else {
        throw new Error("channel returned no image data");
      }
      out.push({ mime: "image/png", meta: { channel: this.model } });
      ctx.reportProgress(Math.round(((i + 1) / ctx.params.count) * 92) + 6);
    }
    return out;
  }
}
