import { nowIso, uuid } from "../config.js";
import type { DbClient } from "./index.js";

const DDL = `
CREATE TABLE IF NOT EXISTS tenants(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'owner', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys(
  key TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
  disabled_at TEXT
);
CREATE TABLE IF NOT EXISTS projects(
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets(
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL,
  bytes INTEGER NOT NULL, sha TEXT NOT NULL, ext TEXT NOT NULL, access_token TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs(
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, kind TEXT NOT NULL, model TEXT NOT NULL,
  prompt TEXT NOT NULL, params TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
  cost_credits INTEGER NOT NULL DEFAULT 0, error TEXT, template_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS generations(
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, job_id TEXT NOT NULL, asset_id TEXT NOT NULL,
  kind TEXT NOT NULL, model TEXT NOT NULL, idx INTEGER NOT NULL, favorite INTEGER NOT NULL DEFAULT 0,
  meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS templates(
  id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL,
  kind TEXT NOT NULL, credits INTEGER NOT NULL, aspect_ratio TEXT NOT NULL,
  prompt_template TEXT NOT NULL, seed INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_ledger(
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL,
  job_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments(
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL,
  credits INTEGER NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'usd',
  session_id TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS audit(
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credentials(
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, ref TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'api_key',
  ciphertext TEXT NOT NULL, iv TEXT NOT NULL, auth_tag TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(tenant_id, ref)
);
CREATE TABLE IF NOT EXISTS endpoints(
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}',
  credits_per_unit INTEGER NOT NULL DEFAULT 0, disabled_at TEXT, created_at TEXT NOT NULL,
  UNIQUE(tenant_id, name)
);
`;

const TEMPLATES: Array<[string, string, string, "image" | "video", number, string, string, number]> = [
  ["studio-hero", "旗舰主图", "product-shot", "image", 4, "3:4", "Studio hero shot of {PRODUCT}, soft warm key light, cream seamless backdrop, shallow depth of field {EDIT}", 101],
  ["closeup-glow", "特写光感", "product-shot", "image", 4, "3:4", "Extreme closeup of {PRODUCT} held toward camera, dewy skin glow, beauty lighting {EDIT}", 202],
  ["minimal-pedestal", "极简基座", "product-shot", "image", 4, "1:1", "{PRODUCT} centered on a stone pedestal, minimal pastel set, soft shadows {EDIT}", 303],
  ["sunlight-table", "阳光桌拍", "product-shot", "image", 4, "4:3", "{PRODUCT} on a linen table by a sunny window, hard sunlight, long shadows {EDIT}", 404],
  ["orbit-motion", "环绕运镜", "motion", "video", 135, "1:1", "{PRODUCT} floating in a glossy sphere, slow orbit, studio reflections {EDIT}", 505],
  ["liquid-pour", "液体倾倒", "motion", "video", 120, "9:16", "Macro slow-motion liquid pouring over {PRODUCT}, droplets frozen mid air {EDIT}", 606],
  ["selfie-review", "自拍实测", "ugc", "image", 6, "9:16", "Front-facing selfie of a creator holding {PRODUCT}, casual bedroom lighting, authentic vibe {EDIT}", 707],
  ["desk-unboxing", "桌面开箱", "ugc", "image", 6, "9:16", "{PRODUCT} mid-unboxing on a cluttered desk, phone-camera angle, honest textures {EDIT}", 808],
  ["launch-announcement", "发布官宣", "ads", "image", 8, "3:4", "Bold launch poster for {PRODUCT}, high contrast color blocking, punchy type space {EDIT}", 909],
  ["fizzy-promo", "气泡促销", "ads", "video", 100, "9:16", "Explosive fizzy promo: {PRODUCT} bursting with citrus splashes, comic energy {EDIT}", 1010],
  ["bold-type-poster", "大字报海报", "posters", "image", 8, "3:4", "Swiss type poster featuring {PRODUCT}, oversized typography, two-color risograph print {EDIT}", 1111],
  ["retro-print", "复古印刷", "posters", "image", 8, "3:4", "Retro travel-poster style ad for {PRODUCT}, grainy gradients, 70s palette {EDIT}", 1212],
  ["clean-listing", "电商白底图", "marketplace", "image", 3, "1:1", "Clean e-commerce listing photo of {PRODUCT}, pure white background, even studio light {EDIT}", 1313],
  ["lifestyle-context", "生活场景", "marketplace", "image", 3, "4:3", "{PRODUCT} in a cozy lifestyle scene, morning kitchen, natural window light {EDIT}", 1414],
];

export async function migrate(db: DbClient): Promise<void> {
  await db.exec(DDL);
  // Lightweight migrations: additive columns, best-effort (already-exists errors ignored).
  const additions = [
    "ALTER TABLE generations ADD COLUMN qc_status TEXT",
    "ALTER TABLE generations ADD COLUMN qc_report TEXT",
    "ALTER TABLE generations ADD COLUMN review_status TEXT",
    "ALTER TABLE generations ADD COLUMN review_note TEXT",
    "ALTER TABLE jobs ADD COLUMN free_resample_of TEXT",
    "ALTER TABLE api_keys ADD COLUMN key_hash TEXT",
    "ALTER TABLE api_keys ADD COLUMN prefix TEXT",
    "ALTER TABLE templates ADD COLUMN source TEXT DEFAULT 'builtin'",
    "ALTER TABLE templates ADD COLUMN thumb_url TEXT",
    "ALTER TABLE templates ADD COLUMN reference_asset_id TEXT",
  ];
  for (const sql of additions) {
    try {
      await db.exec(sql);
    } catch {
      /* column already exists */
    }
  }
  await backfillApiKeyHashes(db);
}

/**
 * API keys are stored hashed (sha256) — plaintext is shown once at issue
 * time and never persisted. Legacy rows (plaintext `key`, NULL key_hash) are
 * backfilled in place and their plaintext destroyed by overwriting the key
 * column; the random key prefix is kept for display.
 */
async function backfillApiKeyHashes(db: DbClient): Promise<void> {
  const { hashApiKey } = await import("../auth-crypto.js");
  const rows = await db.all<{ rowid: number; key: string }>(
    "SELECT rowid AS rowid, key FROM api_keys WHERE key_hash IS NULL AND key NOT LIKE 'hashed:%'",
  );
  for (const row of rows) {
    const hash = hashApiKey(row.key);
    await db.run(
      "UPDATE api_keys SET key_hash=?, prefix=substr(key,1,10), key=? WHERE rowid=?",
      [hash, `hashed:${hash}`, row.rowid],
    );
  }
}

export async function seed(): Promise<void> {
  const db = (await import("./index.js")).db();
  const count = await db.get<{ n: number }>("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM tenants");
  if ((count?.n ?? 0) > 0) return;

  const insertTenant = "INSERT INTO tenants(id,name,created_at) VALUES(?,?,?)";
  const insertKey = "INSERT INTO api_keys(key,key_hash,prefix,tenant_id,label) VALUES(?,?,?,?,?)";
  const { hashApiKey } = await import("../auth-crypto.js");
  let alphaId = "";
  for (const [name, key] of [
    ["Alpha Studio (demo)", "sk_demo_alpha"],
    ["Beta Studio (demo)", "sk_demo_beta"],
  ] as const) {
    const id = uuid();
    if (!alphaId) alphaId = id;
    const hash = hashApiKey(key);
    await db.run(insertTenant, [id, name, nowIso()]);
    await db.run(insertKey, [`hashed:${hash}`, hash, key.slice(0, 10), id, "demo key"]);
    await db.run("INSERT INTO credit_ledger(id,tenant_id,delta,reason,created_at) VALUES(?,?,?,?,?)", [
      uuid(), id, 1000, "grant:demo", nowIso(),
    ]);
  }

  // Demo login account (web sign-in): demo@studio.dev / demo12345
  const { hashPassword } = await import("../auth-crypto.js");
  const userId = uuid();
  await db.run("INSERT INTO users(id,tenant_id,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)", [
    userId, alphaId, "demo@studio.dev", hashPassword("demo12345"), "owner", nowIso(),
  ]);

  const insertTemplate = "INSERT INTO templates(id,slug,title,category,kind,credits,aspect_ratio,prompt_template,seed) VALUES(?,?,?,?,?,?,?,?,?)";
  for (const [slug, title, category, kind, credits, aspect, prompt, seedN] of TEMPLATES) {
    await db.run(insertTemplate, [uuid(), slug, title, category, kind, credits, aspect, prompt, seedN]);
  }
}
