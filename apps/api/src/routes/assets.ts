import type { FastifyInstance } from "fastify";
import { audit, db } from "../db/index.js";
import { assetToDto, findAssetBySha, readArtifact, storeArtifact } from "../storage.js";
import { placeholderSvg, svgBuffer } from "../placeholder.js";

export function registerAssetRoutes(app: FastifyInstance): void {
  app.post("/v1/assets", async (request, reply) => {
    const tenantId = request.tenant!.id;
    const data = await request.file({ limits: { fileSize: 64 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: { code: "no_file", message: "Send multipart file field." } });
    const buffer = await data.toBuffer();
    const mime = data.mimetype || "application/octet-stream";
    const asset = await storeArtifact(tenantId, buffer, mime, "upload");
    await audit(tenantId, "asset.upload", asset.id, { mime, bytes: asset.bytes });
    return reply.code(201).send({ asset });
  });

  app.get("/v1/assets/file/:name", async (request, reply) => {
    const { name } = request.params as { name: string };
    const query = request.query as { t?: string };
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return reply.code(404).send();
    const sha = name.slice(0, dot);
    const ext = name.slice(dot + 1);
    const row = await findAssetBySha(sha, ext);
    if (!row || row.access_token !== query.t) return reply.code(404).send();
    return reply.type(row.mime).send(await readArtifact(row));
  });

  // Public: generates art from a numeric seed only; no tenant data involved.
  app.get("/v1/assets/placeholder", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const seed = Number(query.seed ?? "1") || 1;
    const width = Math.min(2048, Number(query.w ?? "768") || 768);
    const height = Math.min(2048, Number(query.h ?? "1024") || 1024);
    const svg = placeholderSvg({
      seed,
      width,
      height,
      label: query.label,
      kind: query.kind === "video" ? "video" : "image",
      animate: query.kind === "video",
    });
    return reply
      .type("image/svg+xml")
      .header("cache-control", "public, max-age=86400, immutable")
      .send(svgBuffer(svg));
  });

  app.get("/v1/assets/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await db().get("SELECT * FROM assets WHERE id=? AND tenant_id=?", [id, request.tenant!.id]) as
      | Parameters<typeof assetToDto>[0]
      | undefined;
    if (!row) return reply.code(404).send({ error: { code: "not_found", message: "素材不存在。" } });
    return { asset: assetToDto(row) };
  });
}
