import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "./db/index.js";
import { nowIso, uuid } from "./config.js";
import type { AssetDto } from "@studio/shared";

/**
 * Pluggable artifact store: content-addressed by sha256, namespaced per
 * tenant. Drivers: fs (default) and s3 (SigV4, works with AWS S3 and any
 * compatible object store such as MinIO/R2).
 */

export interface StorageDriver {
  put(key: string, buffer: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

let driver: StorageDriver | null = null;

function storageDriver(): StorageDriver {
  if (driver) return driver;
  const kind = process.env.STUDIO_STORAGE_DRIVER ?? "fs";
  driver = kind === "s3"
    ? s3Driver(process.env.STUDIO_S3_BUCKET!, process.env.STUDIO_S3_REGION ?? "us-east-1",
        process.env.STUDIO_S3_ACCESS_KEY_ID!, process.env.STUDIO_S3_SECRET_ACCESS_KEY!,
        process.env.STUDIO_S3_ENDPOINT)
    : fsDriver();
  return driver;
}

function fsRoot(): string {
  return join(process.env.STUDIO_DATA_DIR ?? new URL("../../.data/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "files");
}

function fsDriver(): StorageDriver {
  const root = fsRoot();
  return {
    async put(key, buffer) {
      const file = join(root, key);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, buffer);
    },
    async get(key) {
      return readFileSync(join(root, key));
    },
  };
}

/** Minimal AWS SigV4 for single-object PUT/GET — no SDK dependency. */
function s3Driver(bucket: string, region: string, accessKey: string, secretKey: string, endpoint?: string): StorageDriver {
  const host = endpoint
    ? endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : `s3.${region}.amazonaws.com`;
  const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

  async function request(method: "PUT" | "GET", key: string, body?: Buffer): Promise<Buffer> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash("sha256").update(body ?? "").digest("hex");
    const canonicalUri = `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), "s3"), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await fetch(`https://${host}${canonicalUri}`, {
      method,
      headers: {
        authorization,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        ...(body ? { "content-length": String(body.byteLength) } : {}),
      },
      body: body ? new Uint8Array(body) : undefined,
    });
    if (!response.ok) throw new Error(`s3 ${method} failed ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  return {
    async put(key, buffer) {
      await request("PUT", key, buffer);
    },
    async get(key) {
      return request("GET", key);
    },
  };
}

function extFor(mime: string): string {
  if (mime.includes("svg")) return "svg";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  return "bin";
}

export interface AssetRow {
  id: string;
  tenant_id: string;
  kind: string;
  mime: string;
  bytes: number;
  sha: string;
  ext: string;
  access_token: string;
  created_at: string;
}

export function assetToDto(row: AssetRow): AssetDto {
  return {
    id: row.id,
    kind: row.kind as AssetDto["kind"],
    mime: row.mime,
    bytes: row.bytes,
    url: `/v1/assets/file/${row.sha}.${row.ext}?t=${row.access_token}`,
    createdAt: row.created_at,
  };
}

export async function storeArtifact(tenantId: string, buffer: Buffer, mime: string, kind: string): Promise<AssetDto> {
  const sha = createHash("sha256").update(buffer).digest("hex");
  const ext = extFor(mime);
  await storageDriver().put(`${tenantId}/${sha.slice(0, 2)}/${sha}.${ext}`, buffer);

  const id = uuid();
  const token = randomBytes(16).toString("base64url");
  await db().run(
    "INSERT INTO assets(id,tenant_id,kind,mime,bytes,sha,ext,access_token,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    [id, tenantId, kind, mime, buffer.byteLength, sha, ext, token, nowIso()],
  );
  const row = await db().get<AssetRow>("SELECT * FROM assets WHERE id=?", [id]);
  return assetToDto(row as AssetRow);
}

export async function findAssetBySha(sha: string, ext: string): Promise<AssetRow | undefined> {
  return db().get<AssetRow>("SELECT * FROM assets WHERE sha=? AND ext=?", [sha, ext]);
}

export async function readArtifact(row: AssetRow): Promise<Buffer> {
  return storageDriver().get(`${row.tenant_id}/${row.sha.slice(0, 2)}/${row.sha}.${row.ext}`);
}

export async function getAsset(tenantId: string, assetId: string): Promise<AssetRow | undefined> {
  return db().get<AssetRow>("SELECT * FROM assets WHERE id=? AND tenant_id=?", [assetId, tenantId]);
}
