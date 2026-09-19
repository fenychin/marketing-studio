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
    for (let i = 0; i < ctx.params.count; i++) {
      const response = await fetch(`${this.baseUrl}/images/generations`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: ctx.prompt, size, n: 1 }),
      });
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
