import type { FastifyInstance } from "fastify";
import { audit } from "../db/index.js";
import { deleteSecret, listRefs, storeSecret, validRef } from "../credentials-store.js";

/** Credential vault surface: secrets in, never out. */
export function registerCredentialRoutes(app: FastifyInstance): void {
  app.get("/v1/credentials", async (request) => {
    return { credentials: await listRefs(request.tenant!.id) };
  });

  app.put("/v1/credentials/:ref", async (request, reply) => {
    const { ref } = request.params as { ref: string };
    const body = (request.body ?? {}) as { secret?: string; kind?: string };
    if (!validRef(ref)) {
      return reply.code(400).send({ error: { code: "invalid_ref", message: "ref must be 3-40 chars: a-z 0-9 dash, starting alphanumeric." } });
    }
    const secret = body.secret ?? "";
    if (secret.length < 4) {
      return reply.code(400).send({ error: { code: "weak_secret", message: "请输入密钥内容（至少 4 个字符）。" } });
    }
    await storeSecret(request.tenant!.id, ref, body.kind ?? "api_key", secret);
    await audit(request.tenant!.id, "credential.upsert", ref, {});
    return { ref, stored: true };
  });

  app.delete("/v1/credentials/:ref", async (request, reply) => {
    const { ref } = request.params as { ref: string };
    const removed = await deleteSecret(request.tenant!.id, ref);
    if (!removed) return reply.code(404).send({ error: { code: "not_found", message: "Unknown credential ref." } });
    await audit(request.tenant!.id, "credential.delete", ref, {});
    return { ref, deleted: true };
  });
}
