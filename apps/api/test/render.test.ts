import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Resvg } from "@resvg/resvg-js";
import type { AdDNA } from "@studio/shared";
import { alignScriptToBeats, buildBeatRenderPlan } from "../src/video/timeline.js";
import { composeBeatFrame, getTemplatePack, listTemplatePacks } from "../src/video/template-pack.js";
import { embedImage, prepareImage } from "../src/video/image-ops.js";
import { LocalRenderProvider } from "../src/providers/local-render.js";
import { makeVoicedFixture } from "./fixtures.js";

/**
 * R3 acceptance: template packs compose beat-anchored frames (deterministic,
 * mixed packs across beats), reference images are embedded for real, and the
 * full provider path — dna + beatTexts + product image → ffprobe-readable
 * MP4 — renders end to end.
 */

let workDir: string;
let productPng: string;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "studio-render-test-"));
  productPng = await makeProductImage(workDir);
}, 60000);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

async function makeProductImage(dir: string): Promise<string> {
  const path = join(dir, "product.png");
  await new Promise<void>((resolve, reject) => {
    // testsrc carries real texture (gradients + noise) so PNG-size comparisons work
    const child = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=400x300:rate=1",
      "-frames:v", "1", path,
    ], { windowsHide: true });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
  return path;
}

function beatDna(): AdDNA {
  return {
    version: 1,
    durationSec: 8,
    canvas: { aspectRatio: "9:16", resolution: 720 },
    beats: [
      { index: 0, role: "hook", startSec: 0, endSec: 2.6, targetWords: [2, 12], visual: { template: "bigtype-hook", emphasis: "type", transition: "fade" } },
      { index: 1, role: "value", startSec: 2.6, endSec: 5.2, targetWords: [2, 20], visual: { template: "karaoke-uw", emphasis: "mixed", transition: "cut" } },
      { index: 2, role: "cta", startSec: 5.2, endSec: 8, targetWords: [2, 12], visual: { template: "bigtype-hook", emphasis: "type", transition: "cut" } },
    ],
    style: { paletteDominant: ["#808080"], captionStyle: "karaoke", cutsPerSec: 0.25 },
    energy: { wordsPerSec: [], cutsPerSec: [] },
    provenance: { transcriptSource: "pasted", beatSource: "audio+scene", roleSource: "rule", confidence: 1 },
  };
}

const BEAT_TEXTS = ["Stop scrolling — GlowBottle.", "It simply works every single day.", "Get GlowBottle now."];

describe("image-ops", () => {
  it("probes dimensions and extracts a deterministic dominant color", async () => {
    const img = await prepareImage(readFileSync(productPng), "image/png");
    expect(img.width).toBe(400);
    expect(img.height).toBe(300);
    expect(img.dataUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(img.blurredDataUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(img.blurredDataUri.length).toBeGreaterThan(1000); // blur bakes real pixels
    expect(img.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
    const again = await prepareImage(readFileSync(productPng), "image/png");
    expect(again.dominantColor).toBe(img.dominantColor); // deterministic sampling
  });

  it("emits a cover-cropped clip-path embed with the data uri", async () => {
    const img = await prepareImage(readFileSync(productPng), "image/png");
    const svg = embedImage(img, { x: 10, y: 20, w: 300, h: 500, radius: 24, opacity: 0.9 }, "k1");
    expect(svg).toContain('clipPath id="clip-k1"');
    expect(svg).toContain('rx="24.0"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(svg).toContain('xlink:href="data:image/png;base64,');
    expect(svg).not.toContain("blur-k1"); // no blur unless asked
  });
});

describe("beat-anchored timeline", () => {
  it("aligns each beat text inside its own window, words monotonic", () => {
    const dna = beatDna();
    const alignment = alignScriptToBeats(BEAT_TEXTS, dna.beats);
    expect(alignment.segments).toHaveLength(3);
    alignment.segments.forEach((seg, i) => {
      expect(seg.startSec).toBe(dna.beats[i]!.startSec);
      expect(seg.endSec).toBe(dna.beats[i]!.endSec);
      for (const w of seg.words) {
        expect(w.startSec).toBeGreaterThanOrEqual(seg.startSec - 0.001);
        expect(w.endSec).toBeLessThanOrEqual(seg.endSec + 0.001);
      }
    });
    expect(alignment.durationSec).toBeCloseTo(8, 3);
  });

  it("projects the AdDNA into a render plan whose scenes are the beats", () => {
    const dna = beatDna();
    const alignment = alignScriptToBeats(BEAT_TEXTS, dna.beats);
    const plan = buildBeatRenderPlan(alignment, dna, { aspectRatio: "9:16", resolution: 720, seed: 42 });
    expect(plan.beats).toHaveLength(3);
    expect(plan.beats!.map((b) => b.template)).toEqual(["bigtype-hook", "karaoke-uw", "bigtype-hook"]);
    expect(plan.scenes).toHaveLength(3);
    expect(plan.width).toBe(406); // 9:16 @ 720p base, even-dimmed
    expect(plan.height).toBe(720);
    expect(plan.totalFrames).toBe(Math.round(8 * 30));
    expect(plan.cues.length).toBeGreaterThan(0);
  });
});

describe("template packs", () => {
  it("ships a self-describing catalog", () => {
    const packs = listTemplatePacks();
    expect(packs.map((p) => p.id).sort()).toEqual(["bigtype-hook", "karaoke-uw"]);
    for (const p of packs) {
      expect(p.ui.fields.length).toBeGreaterThan(0);
      expect(p.roles.length).toBeGreaterThan(0);
    }
    expect(getTemplatePack("unknown-pack").id).toBe("karaoke-uw"); // safe fallback
  });

  it("composes deterministic frames; the bigtype beat reveals words, the karaoke beat captions them", () => {
    const dna = beatDna();
    const plan = buildBeatRenderPlan(alignScriptToBeats(BEAT_TEXTS, dna.beats), dna, {
      aspectRatio: "9:16",
      resolution: 720,
      seed: 42,
    });
    const hookFrame = composeBeatFrame(plan, 30, []); // t=1.0s inside the hook beat
    expect(hookFrame).toContain("STOP");
    const karaokeFrame = composeBeatFrame(plan, 120, []); // t=4.0s inside the karaoke beat
    expect(karaokeFrame).toContain("works"); // caption words come from the beat text

    expect(composeBeatFrame(plan, 30, [])).toBe(hookFrame); // deterministic: same inputs → same frame
  });

  it("embeds a reference image into the frame and rasterizes it with resvg", async () => {
    const dna = beatDna();
    const plan = buildBeatRenderPlan(alignScriptToBeats(BEAT_TEXTS, dna.beats), dna, {
      aspectRatio: "9:16",
      resolution: 720,
      seed: 42,
    });
    const img = await prepareImage(readFileSync(productPng), "image/png");
    const withImage = composeBeatFrame(plan, 30, [img]);
    expect(withImage).toContain("data:image/png;base64,");

    // Direct rasterization proof: a frame containing ONLY the image embed
    // produces a photo-heavy PNG (textured), orders of magnitude above a
    // flat-color rect — resvg really decoded and painted the pixels.
    const imgOnly =
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="406" height="720">${embedImage(img, { x: 0, y: 0, w: 406, h: 720 }, "proof")}</svg>`;
    const flat =
      `<svg xmlns="http://www.w3.org/2000/svg" width="406" height="720"><rect width="406" height="720" fill="#123456"/></svg>`;
    const fontOpt = { loadSystemFonts: false, fontFiles: ["/System/Library/Fonts/Supplemental/Arial.ttf"] };
    const imgPng = new Resvg(imgOnly, { fitTo: { mode: "original" }, font: fontOpt }).render().asPng();
    const flatPng = new Resvg(flat, { fitTo: { mode: "original" }, font: fontOpt }).render().asPng();
    expect(imgPng.byteLength).toBeGreaterThan(flatPng.byteLength * 5);

    // And the composed frame with the image renders without error.
    new Resvg(withImage, { fitTo: { mode: "original" }, font: fontOpt }).render().asPng();
  });
});

describe("LocalRenderProvider — full beat-anchored render", () => {
  it("renders a ffprobe-readable MP4 with the reference image composited", async () => {
    // sanity: the voiced fixture's dna (parsing → rewriting → render input)
    const voiced = await makeVoicedFixture(workDir);
    expect(readFileSync(voiced).byteLength).toBeGreaterThan(10000);

    const dna = beatDna();
    const stored: Array<{ buffer: Buffer; mime: string }> = [];
    const provider = new LocalRenderProvider();
    const artifacts = await provider.run({
      prompt: BEAT_TEXTS.join(" "),
      params: {
        aspectRatio: "9:16",
        resolution: "720p",
        durationSec: 8,
        count: 1,
        agent: { dna, beatTexts: BEAT_TEXTS.map((text, index) => ({ index, text })) },
      },
      references: [{ role: "product", buffer: readFileSync(productPng), mime: "image/png" }],
      seedBase: 42,
      reportProgress: () => {},
      throwIfCancelled: async () => {},
      storeArtifact: async (buffer, mime) => {
        stored.push({ buffer, mime });
      },
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.meta.renderer).toBe("beat-anchored-v1");
    expect(artifacts[0]!.meta.beats).toBe("3");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.mime).toBe("video/mp4");

    const duration = await probeDuration(stored[0]!.buffer);
    expect(duration).toBeGreaterThan(7.4);
    expect(duration).toBeLessThan(8.6);
    expect(stored[0]!.buffer.byteLength).toBeGreaterThan(8 * 1024);
  }, 120000);

  it("still renders direct generations through the legacy composer", async () => {
    const stored: Array<{ buffer: Buffer; mime: string }> = [];
    const provider = new LocalRenderProvider();
    const artifacts = await provider.run({
      prompt: "Quick direct generation without any agent metadata.",
      params: { aspectRatio: "9:16", resolution: "540p", durationSec: 3, count: 1 },
      references: [],
      seedBase: 7,
      reportProgress: () => {},
      throwIfCancelled: async () => {},
      storeArtifact: async (buffer, mime) => {
        stored.push({ buffer, mime });
      },
    });
    expect(artifacts[0]!.meta.renderer).toBe("word-anchored-v1");
    const duration = await probeDuration(stored[0]!.buffer);
    expect(duration).toBeGreaterThan(2.4);
    expect(duration).toBeLessThan(3.6);
  }, 120000);
});

function probeDuration(mp4: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), "studio-probe-"));
    const path = join(dir, "out.mp4");
    writeFileSync(path, mp4);
    const child = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path,
    ], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.on("error", reject);
    child.on("close", (code) => {
      rmSync(dir, { recursive: true, force: true });
      if (code === 0) resolve(Number(out.trim()));
      else reject(new Error(`ffprobe exited ${code}`));
    });
  });
}
