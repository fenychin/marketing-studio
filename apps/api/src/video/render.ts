import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { RenderPlan } from "./timeline.js";
import { renderFrameSvg } from "./frame.js";

/**
 * Rasterize each planned frame with resvg, then encode with ffmpeg
 * (libx264, yuv420p). Both steps are swappable: the frame composer is a
 * parameter (legacy single-look composer or the beat-driven template packs),
 * and a headless-Chromium HTML renderer can replace resvg behind the same
 * interface later.
 */
export type FrameComposer = (plan: RenderPlan, frame: number) => string;

// loadSystemFonts scans the whole system font database on EVERY Resvg
// construction (~400ms/frame on macOS). A fixed file list keeps text
// rendering at ~20ms/frame; if none of the known fonts exist we fall back.
const FONT_FILES = [
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
].filter((file) => existsSync(file));

const RESVG_FONT = FONT_FILES.length > 0 ? { loadSystemFonts: false, fontFiles: FONT_FILES } : { loadSystemFonts: true };

export async function renderVideo(
  plan: RenderPlan,
  reportProgress: (percent: number, note?: string) => void,
  compose: FrameComposer = renderFrameSvg,
  shouldAbort?: () => Promise<void>,
): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "studio-render-"));
  try {
    const frames = plan.totalFrames;
    for (let i = 0; i < frames; i++) {
      if (shouldAbort) await shouldAbort(); // cooperative cancellation
      const svg = compose(plan, i);
      const png = new Resvg(svg, { fitTo: { mode: "original" }, font: RESVG_FONT }).render().asPng();
      writeFileSync(join(dir, `f${String(i).padStart(5, "0")}.png`), png);
      if (i % Math.max(1, Math.floor(frames / 12)) === 0) {
        reportProgress(10 + Math.round((i / frames) * 70), `frame ${i + 1}/${frames}`);
      }
    }

    reportProgress(84, "encoding");
    const outPath = join(dir, "out.mp4");
    await encode(dir, frames, plan.fps, outPath);
    reportProgress(96, "finalizing");
    return readFileSync(outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function encode(dir: string, frames: number, fps: number, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-loglevel", "error",
      "-framerate", String(fps),
      "-i", join(dir, "f%05d.png"),
      "-frames:v", String(frames),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outPath,
    ];
    const child = spawn("ffmpeg", args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 400)}`))));
  });
}
