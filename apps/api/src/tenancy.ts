import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "./db/index.js";
import { hashApiKey, verifyJwt } from "./auth-crypto.js";
import type { TenantCtx } from "./auth-types.js";

declare module "fastify" {
  interface FastifyRequest {
    tenant?: TenantCtx;
    user?: { id: string; email: string };
  }
}

export { type TenantCtx } from "./auth-types.js";

/** Routes reachable without credentials. */
const PUBLIC_PREFIXES = ["/v1/assets/file/", "/v1/assets/placeholder", "/v1/auth/login", "/v1/auth/register", "/health"];

export async function resolveTenant(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const url = request.raw.url ?? "";
  if (PUBLIC_PREFIXES.some((p) => url.startsWith(p))) return;

  // 1) machine credentials: x-api-key (stored hashed)
  const apiKey = request.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.length > 0) {
    const row = await db().get<{ id: string; name: string; disabled_at: string | null }>(
      "SELECT t.id, t.name, k.disabled_at FROM api_keys k JOIN tenants t ON t.id = k.tenant_id WHERE k.key_hash = ?",
      [hashApiKey(apiKey)],
    );
    if (!row || row.disabled_at !== null) {
      return reply.code(401).send({ error: { code: "invalid_api_key", message: "Unknown or disabled API key." } });
    }
    request.tenant = { id: row.id, name: row.name };
    return;
  }

  // 2) human credentials: Authorization: Bearer <jwt>
  const bearer = request.headers.authorization;
  if (typeof bearer === "string" && bearer.startsWith("Bearer ")) {
    const claims = verifyJwt(bearer.slice(7));
    if (!claims) {
      return reply.code(401).send({ error: { code: "invalid_token", message: "Session expired — sign in again." } });
    }
    request.tenant = { id: claims.tid, name: claims.org };
    request.user = { id: claims.sub, email: claims.email };
    return;
  }

  // 3) EventSource cannot send headers — SSE streams accept a token query param.
  const searchIndex = url.indexOf("?");
  if (searchIndex >= 0 && url.includes("/events")) {
    const params = new URLSearchParams(url.slice(searchIndex + 1));
    const token = params.get("access_token");
    if (token) {
      if (token.startsWith("sk_")) {
        const row = await db().get<{ id: string; name: string; disabled_at: string | null }>(
          "SELECT t.id, t.name, k.disabled_at FROM api_keys k JOIN tenants t ON t.id = k.tenant_id WHERE k.key_hash = ?",
          [hashApiKey(token)],
        );
        if (row && row.disabled_at === null) {
          request.tenant = { id: row.id, name: row.name };
          return;
        }
      } else {
        const claims = verifyJwt(token);
        if (claims) {
          request.tenant = { id: claims.tid, name: claims.org };
          request.user = { id: claims.sub, email: claims.email };
          return;
        }
      }
    }
  }

  return reply.code(401).send({ error: { code: "missing_credentials", message: "Send x-api-key or Authorization: Bearer." } });
}
