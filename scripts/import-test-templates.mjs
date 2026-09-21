/**
 * 将 .hf-test-manifest.json(公开页抓取的测试模板)导入本地模板数据库。
 *
 * 用途:仅测试验证。验证完成后运行 scripts/remove-test-templates.mjs 全部移除,
 * 换回正式自研模板。素材存入内容寻址库,清单与 .data 不进 git。
 *
 * Usage: npx tsx scripts/import-test-templates.mjs
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(root, "scripts", ".hf-test-manifest.json");

const { initDb, db } = await import("../apps/api/src/db/index.js");
const { storeArtifact } = await import("../apps/api/src/storage.js");
const { migrate } = await import("../apps/api/src/db/schema.js");
const { nowIso, uuid } = await import("../apps/api/src/config.js");

const dataDir = process.env.STUDIO_DATA_DIR ?? join(root, "apps", "api", ".data");
await initDb(dataDir);
const database = db();

// 确保 source 列存在(与 schema.ts 的增量迁移一致)
try {
  await database.exec("ALTER TABLE templates ADD COLUMN source TEXT DEFAULT 'builtin'");
} catch {
  /* 已存在 */
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const tenantId = (
  await database.get<{ id: string }>("SELECT id FROM tenants ORDER BY created_at LIMIT 1")
)!.id;

let imported = 0;
let skipped = 0;

for (const t of manifest.templates) {
  const slug = `hf-test-${t.slug}`;
  const existing = await database.get("SELECT id FROM templates WHERE slug=?", [slug]);
  if (existing) {
    skipped += 1;
    continue;
  }

  // 封面下载并入库
  const coverResp = await fetch(t.coverUrl, { signal: AbortSignal.timeout(60000) });
  if (!coverResp.ok) {
    console.log(`  skip (cover ${coverResp.status}): ${t.title}`);
    skipped += 1;
    continue;
  }
  const coverBuffer = Buffer.from(await coverResp.arrayBuffer());
  const coverMime = coverResp.headers.get("content-type")?.split(";")[0] ?? "image/webp";
  const coverAsset = await storeArtifact(tenantId, coverBuffer, coverMime, "upload");

  // 视频模板:预览 mp4 也入库,把 mp4 地址写到 thumbUrl(前端 <video> 分支可播)
  let thumbUrl = `/v1/assets/file/${coverAsset.sha}.${coverAsset.ext}?t=${coverAsset.access_token}`;
  if (t.kind === "video" && t.videoUrl) {
    try {
      const videoResp = await fetch(t.videoUrl, { signal: AbortSignal.timeout(120000) });
      if (videoResp.ok) {
        const videoBuffer = Buffer.from(await videoResp.arrayBuffer());
        if (videoBuffer.length > 10000) {
          const videoAsset = await storeArtifact(tenantId, videoBuffer, "video/mp4", "upload");
          thumbUrl = `/v1/assets/file/${videoAsset.sha}.${videoAsset.ext}?t=${videoAsset.access_token}`;
        }
      }
    } catch {
      /* 视频预览可选 */
    }
  }

  await database.run(
    "INSERT INTO templates(id,slug,title,category,kind,credits,aspect_ratio,prompt_template,seed,source) VALUES(?,?,?,?,?,?,?,?,?,?)",
    [
      uuid(), slug, t.title, t.category, t.kind, 1,
      t.kind === "video" ? "9:16" : "3:4",
      `Test template (replica of a public reference): {PRODUCT} — ${t.title}. {EDIT}`,
      1, "higgsfield-test",
    ],
  );
  imported += 1;
}

const total = await database.get<{ n: number }>("SELECT COUNT(*) AS n FROM templates WHERE source='higgsfield-test'");
console.log(`imported ${imported}, skipped ${skipped}, test templates in db: ${total?.n}`);
