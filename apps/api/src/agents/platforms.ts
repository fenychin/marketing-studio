import type { AdDNA, BeatRole } from "@studio/shared";
import type { ProductInfo } from "./compose.js";
import { visualCueFor } from "./dna.js";
import { isCjkText } from "./dna.js";

/**
 * Platform presets: each platform is an AdDNA skeleton — beat grammar,
 * duration window and 9:16 canvas — so "product link → TikTok/Reels/Shorts"
 * shares the exact same replica contract as reference-ad cloning. The preset
 * is the time authority; the per-beat rewriter fills the words.
 */

export interface PlatformPreset {
  id: string;
  label: string;
  aspectRatio: "9:16";
  /** Duration window the platform favors, seconds. */
  durationSec: [number, number];
  beats: BeatRole[];
}

export const PLATFORM_PRESETS: Record<string, PlatformPreset> = {
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    aspectRatio: "9:16",
    durationSec: [21, 34],
    beats: ["hook", "context", "value", "offer", "cta"],
  },
  reels: {
    id: "reels",
    label: "Instagram Reels",
    aspectRatio: "9:16",
    durationSec: [15, 30],
    beats: ["hook", "value", "value", "cta"],
  },
  shorts: {
    id: "shorts",
    label: "YouTube Shorts",
    aspectRatio: "9:16",
    durationSec: [20, 40],
    beats: ["hook", "value", "proof", "cta"],
  },
};

export function listPlatformIds(): string[] {
  return Object.keys(PLATFORM_PRESETS);
}

/** Share of the total duration each beat role claims. */
const ROLE_WEIGHT: Record<BeatRole, number> = {
  hook: 0.16,
  context: 0.2,
  value: 0.24,
  proof: 0.2,
  offer: 0.12,
  cta: 0.08,
};

function round3(nv: number): number {
  return Math.round(nv * 1000) / 1000;
}

/** Build the AdDNA skeleton for one platform: deterministic, preset-driven. */
export function buildPlatformDNA(preset: PlatformPreset, product: ProductInfo): AdDNA {
  const mid = Math.round((preset.durationSec[0] + preset.durationSec[1]) / 2);
  const durationSec = Math.min(30, Math.max(3, mid)); // local engine span
  const productText = `${product.name} ${product.description ?? ""}`;
  const rate = isCjkText(productText) ? 4.2 : 2.6;

  const totalWeight = preset.beats.reduce((sum, role) => sum + ROLE_WEIGHT[role]!, 0);
  let cursor = 0;
  const beats = preset.beats.map((role, index) => {
    const dur = durationSec * (ROLE_WEIGHT[role]! / totalWeight);
    const startSec = round3(cursor);
    cursor += dur;
    const endSec = index === preset.beats.length - 1 ? durationSec : round3(cursor);
    const speechSec = Math.max(0.5, (endSec - startSec) * 0.85); // pauses included in the window
    const units = Math.max(2, Math.round(rate * speechSec));
    return {
      index,
      role,
      startSec,
      endSec,
      targetWords: [Math.floor(units * 0.8), Math.ceil(units * 1.25)] as [number, number],
      visual: visualCueFor(role, index === 0),
    };
  });

  return {
    version: 1,
    durationSec,
    canvas: { aspectRatio: preset.aspectRatio, resolution: 720 },
    beats,
    style: { paletteDominant: [], captionStyle: "karaoke", cutsPerSec: 0 },
    energy: { wordsPerSec: beats.map(() => rate), cutsPerSec: beats.map(() => 0) },
    provenance: {
      transcriptSource: "none",
      beatSource: "preset",
      roleSource: "rule",
      confidence: 0,
    },
  };
}
