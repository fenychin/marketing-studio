#!/usr/bin/env node
/**
 * Syncs skills/maker-studio into the agent discovery entries (.claude/.codex).
 * Plain-file copies (symlinks break on Windows checkouts); CI/dev re-run keeps
 * them from drifting.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "skills", "maker-studio");
if (!existsSync(source)) {
  console.error(`[sync-skills] source missing: ${source}`);
  process.exit(1);
}

for (const entry of [".claude", ".codex"]) {
  const target = join(root, entry, "skills", "maker-studio");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  console.log(`[sync-skills] ${entry}/skills/maker-studio updated`);
}
