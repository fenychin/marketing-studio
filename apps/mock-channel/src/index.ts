import http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Local simulator of two channel protocols:
 *  1. async-task video (Seedance-class): POST /tasks → GET /tasks/:id → GET /files/ad.mp4
 *  2. OpenAI images: POST /v1/images/generations → { data: [{ b64_json }] }
 * Used to verify both provider adapters end-to-end without external accounts.
 */

const PORT = Number(process.env.MOCK_CHANNEL_PORT ?? "8790");
const fileDir = join(process.cwd(), ".data");
const mp4Path = join(fileDir, "ad.mp4");

if (!existsSync(mp4Path)) {
  mkdirSync(fileDir, { recursive: true });
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=3",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4Path,
  ]);
  console.log("[mock-channel] generated sample mp4 via ffmpeg");
}

interface Task { id: string; createdAt: number; prompt: string }
const tasks = new Map<string, Task>();
const app = http.createServer((req, res) => {
  const url = req.url ?? "";

  if (req.method === "POST" && (url === "/tasks" || url === "/v1/tasks")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const id = `task_${Math.random().toString(36).slice(2, 10)}`;
      tasks.set(id, { id, createdAt: Date.now(), prompt: safeParse(body).prompt ?? "" });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ id }));
    });
    return;
  }

  const taskMatch = /\/(v1\/)?tasks\/([\w-]+)/.exec(url);
  if (req.method === "GET" && taskMatch) {
    const task = tasks.get(taskMatch[2]!);
    if (!task) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unknown task" }));
      return;
    }
    const elapsed = (Date.now() - task.createdAt) / 1000;
    if (elapsed < 2) return json(res, { status: "queued", progress: 10 });
    if (elapsed < 7) return json(res, { status: "running", progress: Math.round(15 + ((elapsed - 2) / 5) * 70) });
    if (elapsed < 9) return json(res, { status: "running", progress: 90 });
    return json(res, { status: "succeeded", progress: 100, video_url: "/files/ad.mp4" });
  }

  if (req.method === "GET" && url === "/files/ad.mp4") {
    res.writeHead(200, { "content-type": "video/mp4" });
    res.end(readFileSync(mp4Path));
    return;
  }

  // OpenAI images protocol: 1024x1024-ish PNG via ffmpeg, prompt-seeded color.
  if (req.method === "POST" && (url === "/images/generations" || url === "/v1/images/generations")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = safeParse(body);
      const png = generateSamplePng(String(parsed.prompt ?? "product"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
    });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

function json(res: http.ServerResponse, payload: unknown): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const FALLBACK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const SAMPLE_COLORS = ["0x2E8B57", "0xC75B4A", "0x4A7FC7", "0xB08BC9", "0xC78F4A", "0x4AC7A7"];

function generateSamplePng(prompt: string): Buffer {
  const seed = [...prompt].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const out = join(fileDir, `sample-${seed % SAMPLE_COLORS.length}.png`);
  if (existsSync(out)) return readFileSync(out);
  try {
    mkdirSync(fileDir, { recursive: true });
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=c=${SAMPLE_COLORS[seed % SAMPLE_COLORS.length]}:s=512x512:d=1`,
      "-frames:v", "1", out,
    ]);
    return readFileSync(out);
  } catch {
    return FALLBACK_PNG; // a channel simulation must never crash on artwork
  }
}

app.listen(PORT, "127.0.0.1", () => console.log(`[mock-channel] listening on http://127.0.0.1:${PORT}`));
