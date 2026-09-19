import type { BeatRole } from "@studio/shared";
import type { AlignedWord } from "./aligner.js";
import type { BeatPlan, Cue, RenderPlan } from "./timeline.js";
import { activeWordIndex, beatAt, frameCue } from "./timeline.js";
import type { EmbeddableImage } from "./image-ops.js";
import { karaokeUwPack } from "./packs/karaoke-uw.js";
import { bigtypeHookPack } from "./packs/bigtype-hook.js";
import { mulberry32 } from "./frame.js";

/**
 * Render template packs: each pack owns one visual grammar (layout, motion,
 * typography) and describes its own UI so new packs need zero frontend work
 * (self-describing parameter panels). The frame composer picks the pack per
 * beat from `beat.template` — one video can mix packs across beats.
 */

export interface FrameContext {
  plan: RenderPlan;
  beat: BeatPlan;
  timeSec: number;
  /** 0-1 within the beat window. */
  progress: number;
  cue?: Cue;
  activeWord?: AlignedWord;
  images: EmbeddableImage[];
  rng: () => number;
}

export interface PanelSpecField {
  key: string;
  label: string;
  type: "enum" | "number" | "text";
  options?: string[];
  def: string | number;
}

export interface PanelSpec {
  fields: PanelSpecField[];
}

export interface RenderTemplatePack {
  id: string;
  name: string;
  description: string;
  roles: BeatRole[];
  /** Full inner SVG for one frame (background through overlays). */
  frame(ctx: FrameContext): string;
  /** Self-describing parameter panel for the frontend. */
  ui: PanelSpec;
}

const PACKS: Record<string, RenderTemplatePack> = {
  [karaokeUwPack.id]: karaokeUwPack,
  [bigtypeHookPack.id]: bigtypeHookPack,
};

export function getTemplatePack(id: string): RenderTemplatePack {
  return PACKS[id] ?? karaokeUwPack;
}

export function listTemplatePacks(): Array<{ id: string; name: string; description: string; roles: BeatRole[]; ui: PanelSpec }> {
  return Object.values(PACKS).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    roles: p.roles,
    ui: p.ui,
  }));
}

/** Compose one frame of a beat-anchored plan: beat → pack → inner SVG. */
export function composeBeatFrame(plan: RenderPlan, frame: number, images: EmbeddableImage[]): string {
  const t = frame / plan.fps;
  const beat = beatAt(plan, t);
  const pack = getTemplatePack(beat.template);
  const cue = frameCue(plan, t);
  const activeWord = cue ? cue.words[activeWordIndex(cue, t)] : undefined;
  const ctx: FrameContext = {
    plan,
    beat,
    timeSec: t,
    progress: beat.endSec > beat.startSec ? (t - beat.startSec) / (beat.endSec - beat.startSec) : 0,
    cue,
    activeWord,
    images,
    rng: mulberry32((plan.seed * 7919 + frame) >>> 0),
  };
  const inner = pack.frame(ctx);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${plan.width}" height="${plan.height}" viewBox="0 0 ${plan.width} ${plan.height}">${inner}</svg>`;
}
