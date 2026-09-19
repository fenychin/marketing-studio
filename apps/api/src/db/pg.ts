import { mkdirSync } from "node:fs";
import type { DbClient } from "./index.js";
import { numbered } from "./index.js";

/**
 * PGlite (embedded Postgres) driver. For a hosted Postgres the same queries
 * run through node-postgres; placeholder translation lives in numbered().
 */
export async function createPostgres(dataDir?: string): Promise<DbClient> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(dataDir);

  return {
    async exec(sql: string) {
      await pg.exec(sql);
    },
    async run(sql: string, params: unknown[] = []) {
      const result = await pg.query(numbered(sql), params);
      return { changes: (result as { affectedRows?: number }).affectedRows ?? 0 };
    },
    async get<T>(sql: string, params: unknown[] = []) {
      const result = await pg.query(numbered(sql), params);
      return result.rows[0] as T | undefined;
    },
    async all<T>(sql: string, params: unknown[] = []) {
      const result = await pg.query(numbered(sql), params);
      return result.rows as T[];
    },
  };
}
