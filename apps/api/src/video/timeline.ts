import { allWords, distributeWords, type AlignedWord, type Alignment } from "./aligner.js";
import type { AdDNA, BeatRole } from "@studio/shared";

/**
 * Semantic timeline: turns an aligned narration into a frame-exact render
 * plan. Scenes carry the narration; caption cues are word groups; every
 * visual decision below resolves from word times, never from fixed seconds.
 */

export interface Cue {
  text: string;
  words: AlignedWord[];
  startSec: number;
  endSec: number;
}

export interface Scene {
  index: number;
  kind: "intro" | "segment" | "outro";
  startSec: number;
  endSec: number;
  segment?: Alignment["segments"][number];
}

/**
 * A beat-projected scene (R3): beat edges are the semantic time anchors —
 * scene switches, transitions and template selection all resolve from them.
 */
export interface BeatPlan {
  index: number;
  role: BeatRole;
  startSec: number;
  endSec: number;
  transition: "cut" | "fade" | "whip";
  emphasis: "product" | "type" | "mixed";
  template: string;
  /** The beat's aligned narration (words are timed inside the beat window). */
  segment?: Alignment["segments"][number];
}

export interface RenderPlan {
  fps: 30;
  width: number;
  height: number;
  totalFrames: number;
  durationSec: number;
  seed: number;
  scenes: Scene[];
  cues: Cue[];
  words: AlignedWord[];
  /** Present when the plan is beat-anchored (AdDNA path). */
  beats?: BeatPlan[];
}

const CUE_WORDS = 4;

export function buildCues(alignment: Alignment): Cue[] {
  const cues: Cue[] = [];
  for (const segment of alignment.segments) {
    for (let i = 0; i < segment.words.length; i += CUE_WORDS) {
      const words = segment.words.slice(i, i + CUE_WORDS);
      cues.push({
        text: words.map((w) => w.word).join(" "),
        words,
        startSec: words[0]!.startSec,
        endSec: words[words.length - 1]!.endSec,
      });
    }
  }
  return cues;
}

export function evenDim(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r + 1;
}

export function buildRenderPlan(
  alignment: Alignment,
  opts: { aspectRatio: string; resolution: number; seed: number },
): RenderPlan {
  const ratio = opts.aspectRatio.split(":").map(Number);
  const r = ratio.length === 2 && ratio[0]! > 0 ? ratio[0]! / ratio[1]! : 9 / 16;
  const width = r >= 1 ? evenDim(opts.resolution) : evenDim(opts.resolution * r);
  const height = r >= 1 ? evenDim(opts.resolution / r) : evenDim(opts.resolution);

  const durationSec = alignment.durationSec;
  const words = allWords(alignment);
  const narrationEnd = words.length > 0 ? words[words.length - 1]!.endSec : durationSec * 0.8;
  const outroStart = Math.min(durationSec - 1.2, narrationEnd + 0.15);

  const scenes: Scene[] = [];
  const introEnd = alignment.segments.length > 0 ? alignment.segments[0]!.startSec : durationSec * 0.15;
  if (introEnd > 0.05) {
    scenes.push({ index: 0, kind: "intro", startSec: 0, endSec: introEnd });
  }
  alignment.segments.forEach((segment, i) => {
    const isLast = i === alignment.segments.length - 1;
    const rawEnd = isLast ? outroStart : alignment.segments[i + 1]!.startSec;
    const end = Math.max(segment.startSec + 0.05, rawEnd);
    scenes.push({ index: i + 1, kind: "segment", startSec: segment.startSec, endSec: end, segment });
  });
  scenes.push({ index: scenes.length, kind: "outro", startSec: Math.max(outroStart, 0), endSec: durationSec });

  return {
    fps: 30,
    width,
    height,
    totalFrames: Math.max(2, Math.round(durationSec * 30)),
    durationSec,
    seed: opts.seed,
    scenes,
    cues: buildCues(alignment),
    words,
  };
}

export function frameScene(plan: RenderPlan, timeSec: number): Scene {
  return (
    plan.scenes.find((s) => timeSec >= s.startSec && timeSec < s.endSec) ??
    plan.scenes[plan.scenes.length - 1]!
  );
}

export function frameCue(plan: RenderPlan, timeSec: number): Cue | undefined {
  return (
    plan.cues.find((c) => timeSec >= c.startSec && timeSec < c.endSec + 0.12) ??
    (timeSec >= (plan.cues[plan.cues.length - 1]?.endSec ?? 0) ? plan.cues[plan.cues.length - 1] : undefined)
  );
}

export function activeWordIndex(cue: Cue, timeSec: number): number {
  let index = 0;
  for (let i = 0; i < cue.words.length; i++) {
    if (timeSec >= cue.words[i]!.startSec) index = i;
  }
  return index;
}

// ---------------------------------------------------------------------------
// Beat-anchored plans (R3): the AdDNA is the time authority
// ---------------------------------------------------------------------------

/**
 * Align each beat's rewritten text inside its own AdDNA window — word times
 * are projections of the beat anchor, so a rewritten beat never drifts
 * outside its slot regardless of word count.
 */
export function alignScriptToBeats(
  beatTexts: string[],
  beats: Array<{ startSec: number; endSec: number }>,
): Alignment {
  if (beatTexts.length !== beats.length) {
    throw new Error(`beat texts (${beatTexts.length}) do not match dna beats (${beats.length})`);
  }
  const segments = beatTexts.map((text, i) => {
    const start = beats[i]!.startSec;
    const end = beats[i]!.endSec;
    return {
      text,
      startSec: start,
      endSec: end,
      words: distributeWords(text, start, end),
    };
  });
  const durationSec = segments.length > 0 ? segments[segments.length - 1]!.endSec : 0;
  return { segments, durationSec, source: "synthetic" };
}

/** Project the AdDNA beats into a render plan; scenes ARE the beats. */
export function buildBeatRenderPlan(
  beatAlignment: Alignment,
  dna: AdDNA,
  opts: { aspectRatio: string; resolution: number; seed: number },
): RenderPlan {
  if (beatAlignment.segments.length !== dna.beats.length) {
    throw new Error("beat alignment does not match the AdDNA beat count");
  }
  const ratio = opts.aspectRatio.split(":").map(Number);
  const r = ratio.length === 2 && ratio[0]! > 0 ? ratio[0]! / ratio[1]! : 9 / 16;
  const width = r >= 1 ? evenDim(opts.resolution) : evenDim(opts.resolution * r);
  const height = r >= 1 ? evenDim(opts.resolution / r) : evenDim(opts.resolution);

  const beats: BeatPlan[] = dna.beats.map((b, i) => ({
    index: i,
    role: b.role,
    startSec: b.startSec,
    endSec: b.endSec,
    transition: b.visual.transition,
    emphasis: b.visual.emphasis,
    template: b.visual.template,
    segment: beatAlignment.segments[i],
  }));

  // Legacy scene view mirrors the beats so frameScene stays correct for shared queries.
  const scenes: Scene[] = beats.map((b) => ({
    index: b.index,
    kind: "segment" as const,
    startSec: b.startSec,
    endSec: b.endSec,
    segment: b.segment,
  }));

  return {
    fps: 30,
    width,
    height,
    totalFrames: Math.max(2, Math.round(beatAlignment.durationSec * 30)),
    durationSec: beatAlignment.durationSec,
    seed: opts.seed,
    scenes,
    cues: buildCues(beatAlignment),
    words: allWords(beatAlignment),
    beats,
  };
}

export function beatAt(plan: RenderPlan, timeSec: number): BeatPlan {
  const beats = plan.beats ?? [];
  return (
    beats.find((b) => timeSec >= b.startSec && timeSec < b.endSec) ??
    beats[beats.length - 1] ?? {
      index: 0,
      role: "hook",
      startSec: 0,
      endSec: plan.durationSec,
      transition: "fade",
      emphasis: "mixed",
      template: "karaoke-uw",
    }
  );
}
