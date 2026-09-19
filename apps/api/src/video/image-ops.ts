import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dominantColors } from "../agents/dna.js";

/**
 * Image narrow-waist for the render packs: a tiny set of placement semantics
 * (cover, rounded mask, opacity, blur) implemented with native SVG
 * primitives, so any reference image — product shot, og:image, avatar — can
 * appear inside composed frames. Decoding/pixels stay with ffmpeg (already a
 * hard dependency) and resvg rasterizes the embed; no new native deps.
 */

export interface EmbeddableImage {
  mime: string;
  /** `data:<mime>;base64,...` — embeddable straight into an <image> href. */
  dataUri: string;
  /** Same frame pre-blurred with ffmpeg, so per-frame SVG blur never runs. */
  blurredDataUri: string;
  width: number;
  height: number;
  /** Dominant hex color, sampled through a 16×16 k-means pass. */
  dominantColor: string;
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export async function prepareImage(buffer: Buffer, mime: string): Promise<EmbeddableImage> {
  const dir = mkdtempSync(join(tmpdir(), "studio-img-"));
  try {
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const path = join(dir, `img.${ext}`);
    writeFileSync(path, buffer);
    const { width, height } = await probeSize(path);
    const dominant = await dominantColor(path);
    const blurredPath = join(dir, "blurred.png");
    await execOk("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", path,
      "-vf", "boxblur=luma_radius=18:luma_power=2", "-frames:v", "1", blurredPath,
    ]);
    return {
      mime,
      dataUri: `data:${mime};base64,${buffer.toString("base64")}`,
      blurredDataUri: `data:image/png;base64,${readFileSync(blurredPath).toString("base64")}`,
      width,
      height,
      dominantColor: dominant,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function execOk(cmd: string, args: string[]): Promise<void> {
  await execCapture(cmd, args);
}

async function probeSize(path: string): Promise<{ width: number; height: number }> {
  const stdout = await execCapture(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", path],
  );
  const [w, h] = stdout.toString().trim().split("x").map(Number);
  return { width: w || 1, height: h || 1 };
}

async function dominantColor(path: string): Promise<string> {
  const rgb = await execCapture("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", path,
    "-vf", "scale=16:16", "-frames:v", "1",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
  const palette = dominantColors(rgb, 3);
  return palette[0] ?? "#808080";
}

function execCapture(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (d) => chunks.push(d as Buffer));
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 300)}`)),
    );
  });
}

export interface ImagePlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rounded-corner radius; 0 = square. */
  radius?: number;
  opacity?: number;
  /** Gaussian blur stdDeviation in px (background usage). */
  blur?: number;
}

/**
 * Cover-cropped, optionally rounded/blurred image embed. `key` namespaces the
 * clip/filter ids so several images can coexist in one frame deterministically.
 */
export function embedImage(img: EmbeddableImage, placement: ImagePlacement, key: string): string {
  const { x, y, w, h } = placement;
  const radius = placement.radius ?? 0;
  const opacity = placement.opacity ?? 1;
  const blurred = Boolean(placement.blur && placement.blur > 0);
  const defs: string[] = [
    `<clipPath id="clip-${key}"><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${radius.toFixed(1)}"/></clipPath>`,
  ];
  const href = blurred ? img.blurredDataUri : img.dataUri;
  return `<defs>${defs.join("")}</defs><g clip-path="url(#clip-${key})" opacity="${opacity.toFixed(2)}"><image x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" preserveAspectRatio="xMidYMid slice" href="${href}" xlink:href="${href}"/></g>`;
}
