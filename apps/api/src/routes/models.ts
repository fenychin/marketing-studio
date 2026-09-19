import type { FastifyInstance } from "fastify";
import { listModels } from "../providers/registry.js";
import { listTenantModels } from "../tenant-models.js";
import { kindOf } from "../jobs.js";

/** Tenant-aware model catalog: global registry + the tenant's BYOK channels. */
export function registerModelRoutes(app: FastifyInstance): void {
  app.get("/v1/models", async (request) => {
    const query = request.query as { kind?: string };
    const kind = kindOf(query.kind ?? "");
    const models = [...listModels(kind), ...(await listTenantModels(request.tenant!.id, kind))];
    return { models };
  });
}
