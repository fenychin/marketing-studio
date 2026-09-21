/**
 * Scrape Higgsfield Marketing Studio PUBLIC template gallery (TanStack Start
 * Flight payload) into a local manifest for TESTING only.
 *
 * 边界:仅解析公开落地页 HTML 内联的结构化数据;完整模板库在登录墙后,不抓取。
 * 产物:.data/hf-test-templates/(媒体 + manifest.json,.gitignore 已排除,不进 git)
 * 用完即弃:验证完成后运行 scripts/remove-test-templates.mjs 清库并删除清单。
 *
 * 解码方式:在 node:vm 沙箱中按浏览器语义执行站点自身的流式脚本(提供
 * ReadableStream 等全局桩),重建 $R["tsr"] 分块对象图,遍历出分类树。
 *
 * Usage: node scripts/scrape-higgsfield-templates.mjs [--download] [--use-cache]
 */

import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { ReadableStream, WritableStream, TransformStream } from "node:stream/web";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, ".data", "hf-test-templates");
const manifestPath = join(outDir, "manifest.json");
const PAGE = "https://higgsfield.ai/marketing-studio?rp=%2Fmarketing-studio";

const CATEGORY_MAP = { ugc: "ugc", "product-shot": "product-shot", motion: "motion", ads: "ads", posters: "posters", marketplace: "marketplace" };
const CATEGORY_LABEL = { ugc: "UGC", "product-shot": "商品摄影", motion: "动效", ads: "广告", posters: "海报", marketplace: "电商" };

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

async function fetchPage() {
  if (process.argv.includes("--use-cache")) {
    const cached = join(outDir, "page.html");
    if (existsSync(cached)) {
      console.log("using cached page");
      return readFileSync(cached, "utf8");
    }
  }
  // 站点在壳页/全量页间交替:重试直到拿到含 motion 预览的全量页,失败回退缓存
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(PAGE, {
        headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
        signal: AbortSignal.timeout(30000),
      });
      if (response.ok) {
        const html = await response.text();
        if (html.includes("marketing-studio-motion-preview")) {
          console.log(`page ok (${Math.round(html.length / 1024)}KB, attempt ${attempt + 1})`);
          return html;
        }
        console.log(`attempt ${attempt + 1}: partial page, retrying…`);
      } else {
        console.log(`attempt ${attempt + 1}: HTTP ${response.status}`);
      }
    } catch (e) {
      console.log(`attempt ${attempt + 1}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  const cached = join(outDir, "page.html");
  if (existsSync(cached)) {
    console.log("falling back to cached page");
    return readFileSync(cached, "utf8");
  }
  throw new Error("page fetch failed");
}

/** 在 vm 沙箱按浏览器语义执行站点流式脚本,重建 $R 分块对象图 */
function decodePayload(html) {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((t) => t.includes("$R[") || t.includes("$_TSR"));
  const sandbox = {
    console,
    document: { currentScript: { remove() {} } },
    ReadableStream, WritableStream, TransformStream,
    TextEncoder, TextDecoder, fetch, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto,
  };
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const [i, s] of scripts.entries()) {
    try {
      vm.runInContext(s, sandbox);
    } catch (e) {
      console.log(`  script ${i}: skipped (${e.message.slice(0, 60)})`);
    }
  }
  return sandbox.$R ?? {};
}

function extractTemplates($R) {
  const tsr = $R.tsr ?? [];
  const chunkCats = tsr.filter((o) => o && typeof o === "object" && CATEGORY_MAP[o.slug] !== undefined && Array.isArray(o.formats));

  const templates = [];
  const seenCover = new Set();
  for (const c of chunkCats) {
    const category = CATEGORY_MAP[c.slug];
    for (const f of c.formats ?? []) {
      const kind = /video/.test((f.generation && f.generation.job_set_type) || "") ? "video" : "image";
      const fmtName = f.name || "General";
      for (const s of [...(f.default_style ? [f.default_style] : []), ...(f.styles ?? [])]) {
        if (!s?.cover_image?.url) continue;
        const coverUrl = s.cover_image.url.replace("/cdn-cgi/image/width=1080,quality=80,format=auto", "");
        if (seenCover.has(coverUrl)) continue;
        seenCover.add(coverUrl);
        const styleName = s.name || fmtName;
        templates.push({
          slug: `hf-${category}-${`${fmtName}-${styleName}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`,
          title: `[HF测试] ${CATEGORY_LABEL[category]} · ${fmtName} · ${styleName}`,
          category,
          kind,
          aspect: (s.metadata && s.metadata.aspect_ratio) || null,
          coverUrl,
          videoUrl: null,
        });
      }
    }
  }

  // 视频预览:深遍历分块找 .mp4 对象,按序循环配给视频模板
  const mp4s = [];
  const seenObj = new Set();
  const findMp4 = (o, depth) => {
    if (!o || typeof o !== "object" || depth > 6 || seenObj.has(o)) return;
    seenObj.add(o);
    if (typeof o.url === "string" && o.url.endsWith(".mp4") && o.url.includes("higgsfield")) mp4s.push(o.url);
    for (const v of Object.values(o)) findMp4(v, depth + 1);
  };
  for (const chunk of tsr) findMp4(chunk, 0);
  const uniqMp4 = [...new Set(mp4s)];
  const videoTemplates = templates.filter((t) => t.kind === "video");
  uniqMp4.forEach((url, i) => {
    const target = videoTemplates[i % Math.max(1, videoTemplates.length)];
    if (target) target.videoUrl = url;
  });

  return { templates, videoCount: uniqMp4.length };
}

async function main() {
  const html = await fetchPage();
  const $R = decodePayload(html);
  const { templates, videoCount } = extractTemplates($R);

  const summary = {};
  for (const t of templates) summary[t.category] = (summary[t.category] ?? 0) + 1;

  mkdirSync(outDir, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({ scrapedAt: new Date().toISOString(), page: PAGE, summary, templates }, null, 2));
  console.log(`parsed ${templates.length} templates (video previews ${videoCount})`);
  for (const [cat, n] of Object.entries(summary)) {
    const vids = templates.filter((t) => t.category === cat && t.kind === "video").length;
    console.log(`  ${cat}: ${n} (video ${vids})`);
  }

  if (!process.argv.includes("--download")) {
    console.log("dry-run(加 --download 下载媒体)");
    return;
  }

  let ok = 0;
  const failures = [];
  for (const t of templates) {
    mkdirSync(join(outDir, t.category), { recursive: true });
    const coverDest = join(outDir, t.category, `${t.slug}.webp`);
    if (!existsSync(coverDest) || statSync(coverDest).size < 10000) {
      const res = await fetch(t.coverUrl, { signal: AbortSignal.timeout(60000) });
      if (res.ok) writeFileSync(coverDest, Buffer.from(await res.arrayBuffer()));
      else failures.push(`${t.slug} cover ${res.status}`);
    }
    if (t.videoUrl) {
      const videoDest = join(outDir, t.category, `${t.slug}.mp4`);
      if (!existsSync(videoDest) || statSync(videoDest).size < 10000) {
        const res = await fetch(t.videoUrl, { signal: AbortSignal.timeout(120000) });
        if (res.ok) writeFileSync(videoDest, Buffer.from(await res.arrayBuffer()));
        else failures.push(`${t.slug} video ${res.status}`);
      }
    }
    ok += 1;
  }
  console.log(`processed ${ok}/${templates.length}${failures.length ? `, failures: ${failures.slice(0, 5).join("; ")}` : ""}`);

  for (const t of templates.filter((x) => x.kind === "video")) {
    const src = join(outDir, t.category, `${t.slug}.mp4`);
    const poster = join(outDir, t.category, `${t.slug}-frame.jpg`);
    if (existsSync(src) && !existsSync(poster)) {
      spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-frames:v", "1", "-q:v", "3", poster]);
    }
  }
  console.log("video frames extracted");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
