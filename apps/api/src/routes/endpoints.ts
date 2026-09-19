import type { FastifyInstance } from "fastify";
import { audit } from "../db/index.js";
import { createTenantEndpoint, disableTenantEndpoint, listTenantEndpoints } from "../tenant-models.js";

/** BYOK channels: tenant-owned model endpoints backed by the credential vault. */
export function registerEndpointRoutes(app: FastifyInstance): void {
  app.get("/v1/endpoints", async (request) => {
    return { endpoints: await listTenantEndpoints(request.tenant!.id) };
  });

  app.post("/v1/endpoints", async (request, reply) => {
    const body = (request.body ?? {}) as {
      name?: string;
      kind?: string;
      provider?: string;
      model?: string;
      baseUrl?: string;
      credentialRef?: string;
      creditsPerUnit?: number;
    };
    const result = await createTenantEndpoint(request.tenant!.id, {
      name: body.name ?? "",
      kind: (body.kind ?? "image") as "image" | "video",
      provider: body.provider ?? "",
      model: body.model ?? "",
      baseUrl: body.baseUrl ?? "",
      credentialRef: body.credentialRef ?? "",
      creditsPerUnit: body.creditsPerUnit,
    });
    if (!result.ok) {
      return reply.code(400).send({ error: { code: result.code, message: result.message } });
    }
    await audit(request.tenant!.id, "endpoint.create", result.id, { name: body.name, kind: body.kind, provider: body.provider });
    return reply.code(201).send({ id: result.id, name: body.name });
  });

  app.delete("/v1/endpoints/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const removed = await disableTenantEndpoint(request.tenant!.id, id);
    if (!removed) return reply.code(404).send({ error: { code: "not_found", message: "Unknown endpoint." } });
    await audit(request.tenant!.id, "endpoint.delete", id, {});
    return { id, deleted: true };
  });
}
