import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Automatic QC — the machine half of "done means watched". Every rendered
 * video artifact gets verified (readable, planned duration, no long black
 * stretches, sane size) before it is offered for human review.
 */

export interface QcCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface QcResult {
  status: "passed" | "flagged";
  checks: QcCheck[];
  hardFail: boolean; // unreadable / wrong duration → worth a re-render
}

const HARD_CHECKS = new Set(["readable", "duration"]);

export async function qcVideoArtifact(
  buffer: Buffer,
  planned: { durationSec?: number },
): Promise<QcResult> {
  const checks: QcCheck[] = [];

  checks.push({
    name: "min_size",
    ok: buffer.byteLength > 8192,
    detail: `${(buffer.byteLength / 1024).toFixed(1)} KB`,
  });

  const dir = mkdtempSync(join(tmpdir(), "studio-qc-"));
  try {
    const file = join(dir, "artifact.mp4");
    writeFileSync(file, buffer);

    const probe = await ffprobe(file);
    const durationOk = planned.durationSec
      ? Math.abs(probe.duration - planned.durationSec) <= 0.6
      : true;
    checks.push({
      name: "readable",
      ok: probe.readable,
      detail: probe.readable ? `${probe.duration.toFixed(2)}s` : "ffprobe failed",
    });
    checks.push({
      name: "duration",
      ok: durationOk,
      detail: planned.durationSec ? `planned ${planned.durationSec}s, got ${probe.duration.toFixed(2)}s` : "no plan duration",
    });

    const ratio = await measureBlackRatio(file, probe.duration);
    checks.push({
      name: "black_frames",
      ok: ratio < 0.5,
      detail: `${(ratio * 100).toFixed(1)}% black`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const hardFail = checks.some((c) => HARD_CHECKS.has(c.name) && !c.ok);
  return { status: checks.every((c) => c.ok) ? "passed" : "flagged", checks, hardFail };
}

function ffprobe(file: string): Promise<{ readable: boolean; duration: number }> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.on("error", () => resolve({ readable: false, duration: 0 }));
    child.on("close", (code) => {
      const duration = Number(out.trim());
      resolve(code === 0 && Number.isFinite(duration) && duration > 0 ? { readable: true, duration } : { readable: false, duration: 0 });
    });
  });
}

async function measureBlackRatio(file: string, duration: number): Promise<number> {
  if (duration <= 0) return 1;
  const stderr = await ffmpegStderr([
    "-i", file,
    "-vf", "blackdetect=d=0.4:pix_th=0.05",
    "-an", "-f", "null", "-",
  ]);
  let black = 0;
  for (const line of stderr.split("\n")) {
    const m = /black_start: ([\d.]+) black_end: ([\d.]+)/.exec(line);
    if (m) black += Number(m[2]) - Number(m[1]);
  }
  return black / duration;
}

function ffmpegStderr(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", () => resolve(stderr));
    child.on("close", () => resolve(stderr));
  });
}
