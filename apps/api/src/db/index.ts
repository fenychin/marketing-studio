/**
 * Dual-driver async DB facade. All call sites use `db.run/get/all/exec`.
 * Drivers: sqlite (node:sqlite, default, dev) and postgres (PGlite — real
 * Postgres in WASM; a server deployment swaps to node-postgres with the same
 * SQL, since nothing beyond portable dialect is used).
 */
import { nowIso, uuid } from "../config.js";

export interface DbClient {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

let client: DbClient | null = null;

export function db(): DbClient {
  if (!client) throw new Error("db not initialised — call initDb() first");
  return client;
}

export async function initDb(dataDir: string): Promise<DbClient> {
  if (client) return client;
  const driver = process.env.STUDIO_DB_DRIVER ?? "sqlite";
  if (driver === "postgres") {
    const { createPostgres } = await import("./pg.js");
    client = await createPostgres(process.env.STUDIO_PG_DATA ?? undefined);
  } else {
    const { createSqlite } = await import("./sqlite.js");
    client = await createSqlite(dataDir);
  }
  const { migrate, seed } = await import("./schema.js");
  await migrate(client);
  await seed();
  return client;
}

/** `?` placeholders → `$1..$n` for the Postgres wire. */
export function numbered(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export async function audit(tenantId: string, action: string, subject: string, meta: Record<string, unknown> = {}): Promise<void> {
  await db().run("INSERT INTO audit(id,tenant_id,action,subject,meta,created_at) VALUES(?,?,?,?,?,?)", [
    uuid(), tenantId, action, subject, JSON.stringify(meta), nowIso(),
  ]);
}
