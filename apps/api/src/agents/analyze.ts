import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Reference analysis: extracts the *rhythm* of a reference ad — speech
 * segments (via ffmpeg silencedetect), duration — so a clone can keep the
 * same hook structure. Word-level transcription plugs in at `transcribe()`
 * (faster-whisper HTTP service) when configured; a pasted transcript wins.
 */

export interface PacingModel {
  durationSec: number;
  segmentCount: number; // speech bursts ≈ beats
  meanSegmentSec: number;
  segments: Array<{ startSec: number; endSec: number }>;
  hasAudio: boolean;
}

export async function analyzeReference(videoBuffer: Buffer): Promise<PacingModel> {
  const dir = mkdtempSync(join(tmpdir(), "studio-analyze-"));
  try {
    const videoPath = join(dir, "reference.mp4");
    writeFileSync(videoPath, videoBuffer);
    const { durationSec, hasAudio, silences } = await probe(videoPath);

    // speech = timeline minus silences
    const segments: Array<{ startSec: number; endSec: number }> = [];
    let cursor = 0;
    for (const s of silences) {
      if (s.start - cursor >= 0.3) segments.push({ startSec: cursor, endSec: s.start });
      cursor = Math.max(cursor, s.end);
    }
    if (durationSec - cursor >= 0.3) segments.push({ startSec: cursor, endSec: durationSec });
    if (!hasAudio || segments.length === 0) {
      const fallback = Math.max(2, Math.round(durationSec / 3));
      for (let i = 0; i < fallback; i++) {
        segments.push({ startSec: (durationSec / fallback) * i, endSec: (durationSec / fallback) * (i + 1) });
      }
    }
    const mean = segments.reduce((sum, s) => sum + (s.endSec - s.startSec), 0) / segments.length;
    return { durationSec, segmentCount: segments.length, meanSegmentSec: mean, segments, hasAudio };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function probe(videoPath: string): Promise<{ durationSec: number; hasAudio: boolean; silences: Array<{ start: number; end: number }> }> {
  const stderr = await ffmpegStderr([
    "-hide_banner", "-i", videoPath,
    "-af", "silencedetect=noise=-30dB:d=0.35",
    "-f", "null", "-",
  ]);
  const durationMatch = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(stderr);
  const durationSec = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : 8;
  const hasAudio = /Audio:/.test(stderr);
  const silences: Array<{ start: number; end: number }> = [];
  let open: number | null = null;
  for (const line of stderr.split("\n")) {
    const start = /silence_start: ([\d.]+)/.exec(line);
    if (start) open = Number(start[1]);
    const end = /silence_end: ([\d.]+)/.exec(line);
    if (end && open !== null) {
      silences.push({ start: open, end: Number(end[1]) });
      open = null;
    }
  }
  return { durationSec, hasAudio, silences };
}

function ffmpegStderr(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", () => resolve(stderr)); // silencedetect results arrive on stderr; exit code irrelevant
  });
}

/**
 * Optional ASR port: POST the audio to a whisper-compatible service
 * (STUDIO_ASR_URL) expecting { segments: [{ text, start, end }] }.
 */
export async function transcribeWithAsr(videoBuffer: Buffer): Promise<string | null> {
  const base = process.env.STUDIO_ASR_URL?.trim();
  if (!base) return null;
  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(videoBuffer)]), "reference.mp4");
    const response = await fetch(`${base.replace(/\/$/, "")}/v1/asr`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { segments?: Array<{ text: string }> };
    return body.segments?.map((s) => s.text.trim()).join(" ") ?? null;
  } catch {
    return null; // ASR is best-effort; rule composer still runs
  }
}
