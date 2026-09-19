import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { db, audit } from "../db/index.js";
import { nowIso, uuid } from "../config.js";
import { hashApiKey, hashPassword, signJwt, verifyPassword } from "../auth-crypto.js";
import { charge } from "../credits.js";
import type { JwtClaims } from "../auth-types.js";

/**
 * Human auth: register (creates tenant + owner user + starter key), login
 * (JWT), session profile, and API-key issuing for machine access. Keys are
 * stored hashed — plaintext is returned exactly once, at creation.
 */
export function registerAuthRoutes(app: FastifyInstance): void {
  app.post("/v1/auth/register", async (request, reply) => {
    const body = (request.body ?? {}) as { email?: string; password?: string; orgName?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const orgName = (body.orgName ?? "").trim() || `${email.split("@")[0]}'s workspace`;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.code(400).send({ error: { code: "invalid_email", message: "请输入有效的邮箱地址。" } });
    }
    if (password.length < 8) {
      return reply.code(400).send({ error: { code: "weak_password", message: "密码至少需要 8 个字符。" } });
    }
    const existing = await db().get("SELECT id FROM users WHERE email=?", [email]);
    if (existing) {
      return reply.code(409).send({ error: { code: "email_taken", message: "该邮箱已注册。" } });
    }

    const tenantId = uuid();
    const userId = uuid();
    const apiKey = `sk_${randomToken(32)}`;
    await db().run("INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)", [tenantId, orgName, nowIso()]);
    await db().run("INSERT INTO users(id,tenant_id,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)", [
      userId, tenantId, email, hashPassword(password), "owner", nowIso(),
    ]);
    await db().run("INSERT INTO api_keys(key,key_hash,prefix,tenant_id,label) VALUES(?,?,?,?,?)", [
      `hashed:${hashApiKey(apiKey)}`, hashApiKey(apiKey), apiKey.slice(0, 10), tenantId, "default",
    ]);
    await charge(tenantId, 500, "grant:signup");
    await audit(tenantId, "auth.register", userId, { email });

    const claims: Omit<JwtClaims, "exp"> = { sub: userId, tid: tenantId, email, org: orgName };
    return reply.code(201).send({ token: signJwt(claims), user: { id: userId, email, org: orgName }, apiKey, balance: 500 });
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const body = (request.body ?? {}) as { email?: string; password?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const row = await db().get<{
      id: string; tenant_id: string; password_hash: string; email: string; org: string;
    }>(
      "SELECT u.id, u.tenant_id, u.password_hash, u.email, t.name AS org FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.email=?",
      [email],
    );
    if (!row || !verifyPassword(body.password ?? "", row.password_hash)) {
      return reply.code(401).send({ error: { code: "invalid_credentials", message: "邮箱或密码不正确。" } });
    }
    const claims: Omit<JwtClaims, "exp"> = { sub: row.id, tid: row.tenant_id, email: row.email, org: row.org };
    return { token: signJwt(claims), user: { id: row.id, email: row.email, org: row.org } };
  });

  app.get("/v1/auth/me", async (request) => {
    const balance = await import("../credits.js").then((m) => m.balance(request.tenant!.id));
    return { tenant: request.tenant, user: request.user, balance };
  });

  app.get("/v1/auth/api-keys", async (request) => {
    // Hashed storage: only the display prefix survives, never the plaintext.
    const rows = await db().all<{ prefix: string | null; label: string; disabled_at: string | null }>(
      "SELECT prefix,label,disabled_at FROM api_keys WHERE tenant_id=? ORDER BY rowid",
      [request.tenant!.id],
    );
    return {
      apiKeys: rows
        .filter((r) => r.disabled_at === null)
        .map((r) => ({ key: `${r.prefix ?? "sk_"}…`, label: r.label })),
    };
  });

  app.post("/v1/auth/api-keys", async (request, reply) => {
    const body = (request.body ?? {}) as { label?: string };
    const key = `sk_${randomToken(32)}`;
    await db().run("INSERT INTO api_keys(key,key_hash,prefix,tenant_id,label) VALUES(?,?,?,?,?)", [
      `hashed:${hashApiKey(key)}`, hashApiKey(key), key.slice(0, 10), request.tenant!.id,
      (body.label ?? "").trim() || "issued",
    ]);
    await audit(request.tenant!.id, "apikey.issue", key.slice(0, 10), {});
    return reply.code(201).send({ apiKey: key });
  });
}

/** Cryptographically secure key material (was Math.random — never again). */
function randomToken(len: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}
