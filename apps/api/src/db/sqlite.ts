import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { DbClient } from "./index.js";

export async function createSqlite(dataDir: string): Promise<DbClient> {
  mkdirSync(dataDir, { recursive: true });
  const sqlite = new DatabaseSync(join(dataDir, "studio.db"));
  sqlite.exec("PRAGMA journal_mode = WAL");
  const cache = new Map<string, ReturnType<DatabaseSync["prepare"]>>();

  return {
    async exec(sql: string) {
      sqlite.exec(sql);
    },
    async run(sql: string, params: unknown[] = []) {
      const result = cacheGet(sqlite, cache, sql).run(...(params as SQLInputValue[]));
      return { changes: Number(result.changes) };
    },
    async get<T>(sql: string, params: unknown[] = []) {
      return cacheGet(sqlite, cache, sql).get(...(params as SQLInputValue[])) as T | undefined;
    },
    async all<T>(sql: string, params: unknown[] = []) {
      return cacheGet(sqlite, cache, sql).all(...(params as SQLInputValue[])) as unknown as T[];
    },
  };
}

function cacheGet(sqlite: DatabaseSync, cache: Map<string, ReturnType<DatabaseSync["prepare"]>>, sql: string) {
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = sqlite.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}
