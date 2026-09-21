/**
 * 移除全部 HF 测试模板(schema.ts 种子的正式模板不受影响)。
 * 验证完成后执行:node scripts/remove-test-templates.mjs
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { initDb, db } = await import("../apps/api/src/db/index.js");

await initDb(join(root, "apps", ".data"));
const result = await db().run("DELETE FROM templates WHERE source='higgsfield-test'");
console.log(`removed ${result.changes} test templates`);
