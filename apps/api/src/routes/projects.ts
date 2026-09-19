import type { FastifyInstance } from "fastify";
import { db, audit } from "../db/index.js";
import { nowIso, uuid } from "../config.js";
import { balance, ledger } from "../credits.js";

export function registerProjectAndCreditRoutes(app: FastifyInstance): void {
  app.get("/v1/projects", async (request) => {
    const rows = await db().all<{ id: string; name: string; created_at: string }>(
      "SELECT id,name,created_at FROM projects WHERE tenant_id=? ORDER BY created_at DESC",
      [request.tenant!.id],
    );
    return { projects: rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at })) };
  });

  app.post("/v1/projects", async (request, reply) => {
    const body = (request.body ?? {}) as { name?: string };
    const name = (body.name ?? "").trim();
    if (name.length === 0) return reply.code(400).send({ error: { code: "invalid_name", message: "name is required." } });
    const id = uuid();
    await db().run("INSERT INTO projects(id,tenant_id,name,created_at) VALUES(?,?,?,?)", [id, request.tenant!.id, name, nowIso()]);
    await audit(request.tenant!.id, "project.create", id, { name });
    return reply.code(201).send({ project: { id, name, createdAt: nowIso() } });
  });

  app.get("/v1/credits", async (request) => {
    const tenantId = request.tenant!.id;
    return { balance: await balance(tenantId), ledger: await ledger(tenantId) };
  });
}
