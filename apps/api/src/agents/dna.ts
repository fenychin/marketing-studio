import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AdDNA,
  AdDNABeat,
  AdDNABeatSource,
  AdDNATranscriptSource,
  AdDNAVisualCue,
  AsrSegment,
  AsrWord,
  BeatRole,
} from "@studio/shared";
import { ffmpegStderr, probe, speechSegmentsFromSilences } from "./analyze.js";

/**
 * Reference-ad parser: turns an ad video into its AdDNA — the structural
 * replica contract (docs/DESIGN-AD-DNA.md). Speech bursts × shot changes
 * fuse into beat boundaries; the transcript (pasted > ASR > rate assumption)
 * supplies per-beat word targets; frame sampling extracts style tokens.
 *
 * Everything is deterministic. What was measured and what was assumed is
 * recorded in `provenance` — never hidden: confidence is the share of beat
 * boundaries backed by a real signal, so a clone without ASR honestly
 * reports its lower fidelity instead of pretending precision.
 */

export interface AdDNAOptions {
  /** Pasted transcript wins over the ASR port (tier 1 of 3). */
  transcript?: string;
  aspectRatio?: string;
  resolution?: number;
}

const CLUSTER_TOL_SEC = 0.45; // speech onset & shot change within this = one beat edge
const MIN_BEAT_SEC = 0.6; // beats shorter than this get merged away
const EDGE_MARGIN_SEC = 0.4; // ignore signals this close to either end
const SPEECH_RATE = { wordsPerSec: 2.6, cjkCharsPerSec: 4.2 };
const PALETTE_SAMPLES = 5;
const DEFAULT_PALETTE = ["#f6d8a8", "#9db8d9", "#b48ac9"];

export interface FusedTimeline {
  segments: Array<{ startSec: number; endSec: number }>;
  measuredBoundaries: number;
  totalBoundaries: number;
  /** Which physical signals were available (boundaries may still all be assumed). */
  source: AdDNABeatSource;
}

export interface BeatTarget {
  startSec: number;
  endSec: number;
  /** Measured unit count (transcript-backed) or null when assumed from speech rate. */
  units: number | null;
  transcript?: string;
}

// ---------------------------------------------------------------------------
// Pure core — beat fusion, roles, language rates, color clustering, word math
// ---------------------------------------------------------------------------

/**
 * Fuse speech onsets (silencedetect) with shot changes (scene detection) into
 * beat boundaries. Signals within CLUSTER_TOL collapse into one boundary (the
 * earliest time wins — a cut leads the phrase it starts). Boundaries that
 * would create beats shorter than MIN_BEAT_SEC are pruned, unmeasured ones
 * first; with no usable signals at all the clip falls back to an even preset
 * split and provenance reports it.
 */
export function fuseBeats(input: {
  durationSec: number;
  speechSegments: Array<{ startSec: number; endSec: number }>;
  sceneCuts: number[];
  hasAudio: boolean;
}): FusedTimeline {
  const interior = (t: number) => t > EDGE_MARGIN_SEC && t < input.durationSec - EDGE_MARGIN_SEC;
  type Candidate = { t: number; speech: boolean; scene: boolean };
  const candidates: Candidate[] = [];
  for (const s of input.speechSegments) {
    if (interior(s.startSec)) candidates.push({ t: s.startSec, speech: true, scene: false });
  }
  for (const t of input.sceneCuts) {
    if (interior(t)) candidates.push({ t, speech: false, scene: true });
  }
  candidates.sort((a, b) => a.t - b.t);

  const boundaries: Array<{ t: number; measured: boolean }> = [];
  for (const c of candidates) {
    const last = boundaries[boundaries.length - 1];
    if (last && c.t - last.t <= CLUSTER_TOL_SEC) {
      last.measured = last.measured || c.speech || c.scene;
    } else {
      boundaries.push({ t: c.t, measured: true });
    }
  }

  const available: AdDNABeatSource =
    input.hasAudio && input.sceneCuts.length > 0
      ? "audio+scene"
      : input.hasAudio
        ? "audio"
        : input.sceneCuts.length > 0
          ? "scene"
          : "preset";

  if (boundaries.length === 0 || input.durationSec < MIN_BEAT_SEC * 2) {
    return presetSplit(input.durationSec, available);
  }

  for (;;) {
    const pts = [0, ...boundaries.map((b) => b.t), input.durationSec];
    let shortest = Infinity;
    for (let i = 0; i < pts.length - 1; i++) shortest = Math.min(shortest, pts[i + 1]! - pts[i]!);
    if (shortest >= MIN_BEAT_SEC) break;
    let removeIdx = -1;
    for (let i = 0; i < boundaries.length; i++) {
      const before = pts[i + 1]! - pts[i]!;
      const after = pts[i + 2]! - pts[i + 1]!;
      if (before < MIN_BEAT_SEC || after < MIN_BEAT_SEC) {
        if (removeIdx < 0) removeIdx = i;
        if (!boundaries[i]!.measured) {
          removeIdx = i;
          break;
        }
      }
    }
    if (removeIdx < 0) break;
    boundaries.splice(removeIdx, 1);
    if (boundaries.length === 0) return presetSplit(input.durationSec, available);
  }

  const pts = [0, ...boundaries.map((b) => b.t), input.durationSec];
  const segments: Array<{ startSec: number; endSec: number }> = [];
  for (let i = 0; i < pts.length - 1; i++) {
    segments.push({ startSec: round3(pts[i]!), endSec: round3(pts[i + 1]!) });
  }
  return {
    segments,
    measuredBoundaries: boundaries.filter((b) => b.measured).length,
    totalBoundaries: boundaries.length,
    source: available,
  };
}

function presetSplit(durationSec: number, source: AdDNABeatSource): FusedTimeline {
  const n = Math.min(6, Math.max(2, Math.round(durationSec / 3)));
  const segments = Array.from({ length: n }, (_, i) => ({
    startSec: round3((durationSec / n) * i),
    endSec: round3((durationSec / n) * (i + 1)),
  }));
  return { segments, measuredBoundaries: 0, totalBoundaries: Math.max(0, n - 1), source };
}

/** Rule-path role assignment: hook opens, CTA closes, the middle fills by depth. */
export function assignRoles(count: number): BeatRole[] {
  if (count <= 0) return [];
  if (count === 1) return ["hook"];
  if (count === 2) return ["hook", "cta"];
  const middle = (k: number): BeatRole[] => {
    if (k <= 0) return [];
    if (k === 1) return ["value"];
    if (k === 2) return ["context", "value"];
    if (k === 3) return ["context", "value", "proof"];
    return ["context", "value", "proof", ...Array<BeatRole>(k - 3).fill("value")];
  };
  return ["hook", ...middle(count - 2), "cta"];
}

const HAN_RE = /\p{Script=Han}/gu;
const LETTER_RE = /\p{L}/gu;

export function isCjkText(text: string): boolean {
  const han = (text.match(HAN_RE) ?? []).length;
  const letters = (text.match(LETTER_RE) ?? []).length;
  return letters > 0 && han / letters > 0.3;
}

/** Speech rate for the assumed tier: CJK counts characters, latin counts words. */
export function speechRateFor(text: string): number {
  return isCjkText(text) ? SPEECH_RATE.cjkCharsPerSec : SPEECH_RATE.wordsPerSec;
}

function countUnits(text: string, cjk: boolean): number {
  if (cjk) {
    return (text.match(HAN_RE) ?? []).length + (text.match(/[A-Za-z0-9]+/g) ?? []).length;
  }
  // punctuation-only tokens (dashes, ellipses) consume no speech time
  return text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

/** Unit count by language: CJK counts Han characters (+ latin runs), latin counts words. */
export function countTextUnits(text: string, language: "zh" | "en"): number {
  return countUnits(text, language === "zh");
}

/** Word-count window the script rewriter must land in: measured count ±20/25%. */
export function windowFor(units: number): [number, number] {
  const lo = Math.max(2, Math.floor(units * 0.8));
  const hi = Math.ceil(units * 1.25);
  return [lo, Math.max(lo, hi)];
}

/** Spread transcript sentences across beats evenly — reference slices only. */
export function sliceTranscriptEven(text: string, beatCount: number): Array<string | undefined> {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from({ length: beatCount }, (_, i) => {
    const from = Math.floor((i * sentences.length) / beatCount);
    const to = Math.max(from + 1, Math.floor(((i + 1) * sentences.length) / beatCount));
    return sentences.slice(from, to).join(" ") || undefined;
  });
}

/** Flat ASR segments → word list; missing word timings are distributed evenly. */
export function evidenceWords(segments: AsrSegment[]): AsrWord[] {
  const words: AsrWord[] = [];
  for (const seg of segments) {
    const start = seg.startSec ?? 0;
    const end = seg.endSec ?? start;
    if (seg.words && seg.words.length > 0) {
      for (const w of seg.words) words.push({ text: w.text, startSec: w.startSec, endSec: w.endSec });
      continue;
    }
    const tokens = seg.text.split(/\s+/).filter(Boolean);
    const span = Math.max(0.1, end - start);
    tokens.forEach((token, i) => {
      words.push({
        text: token,
        startSec: round3(start + (span * i) / tokens.length),
        endSec: round3(start + (span * (i + 1)) / tokens.length),
      });
    });
  }
  return words;
}

/** Assign evidence words to beats by midpoint; falls back to the nearest beat. */
export function assignEvidenceToBeats(
  words: AsrWord[],
  segments: Array<{ startSec: number; endSec: number }>,
): Array<AsrWord[]> {
  const buckets: Array<AsrWord[]> = segments.map(() => []);
  for (const w of words) {
    const mid = (w.startSec + w.endSec) / 2;
    let idx = segments.findIndex((s) => mid >= s.startSec && mid < s.endSec);
    if (idx < 0) {
      let bestDist = Infinity;
      idx = 0;
      segments.forEach((s, i) => {
        const d = mid < s.startSec ? s.startSec - mid : mid > s.endSec ? mid - s.endSec : 0;
        if (d < bestDist) {
          bestDist = d;
          idx = i;
        }
      });
    }
    buckets[idx]!.push(w);
  }
  return buckets;
}

/** Deterministic k-means over raw RGB pixels; clusters sorted by size, then index. */
export function dominantColors(rgb: Uint8Array, k = 3, iterations = 12): string[] {
  const count = Math.floor(rgb.length / 3);
  const kk = Math.min(k, count);
  if (count === 0 || kk <= 0) return [];
  const at = (i: number): [number, number, number] => [rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!];
  let centroids: Array<[number, number, number]> = [];
  for (let c = 0; c < kk; c++) centroids.push(at(Math.floor(((c + 0.5) / kk) * count)));
  const assign = new Array<number>(count).fill(0);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < count; i++) {
      const p = at(i);
      let best = 0;
      let bestDist = Infinity;
      centroids.forEach((c, ci) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = ci;
        }
      });
      assign[i] = best;
    }
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < count; i++) {
      const s = sums[assign[i]]!;
      const p = at(i);
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3] += 1;
    }
    centroids = centroids.map((c, ci) => {
      const s = sums[ci]!;
      return s[3] > 0 ? ([s[0] / s[3], s[1] / s[3], s[2] / s[3]] as [number, number, number]) : c;
    });
  }
  const counts = new Array<number>(kk).fill(0);
  for (let i = 0; i < count; i++) counts[assign[i]]! += 1;
  return centroids
    .map((_, ci) => ci)
    .sort((a, b) => counts[b]! - counts[a]! || a - b)
    .map((ci) => hexOf(centroids[ci]!));
}

function hexOf(c: [number, number, number]): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

/** Role → visual intent; shared by the parser and the platform preset builder. */
export function visualCueFor(role: BeatRole, isFirst: boolean): AdDNAVisualCue {
  const typeBeat = role === "hook" || role === "cta" || role === "offer";
  return {
    template: typeBeat ? "bigtype-hook" : "karaoke-uw",
    emphasis: typeBeat ? "type" : "mixed",
    transition: isFirst ? "fade" : "cut",
  };
}

function visualFor(role: BeatRole, isFirst: boolean): AdDNAVisualCue {
  return visualCueFor(role, isFirst);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// IO — ffmpeg signals, ASR port
// ---------------------------------------------------------------------------

/** Shot-change timestamps via scene detection (stderr showinfo lines). */
export async function detectScenes(videoPath: string): Promise<number[]> {
  const stderr = await ffmpegStderr([
    "-hide_banner",
    "-i",
    videoPath,
    "-vf",
    "select='gt(scene,0.3)',showinfo",
    "-an",
    "-f",
    "null",
    "-",
  ]);
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
}

function ffmpegRaw(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (d) => chunks.push(d as Buffer));
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg ${code}: ${stderr.slice(-400)}`)),
    );
  });
}

async function sampleFrame(videoPath: string, t: number): Promise<Buffer> {
  return ffmpegRaw([
    "-hide_banner",
    "-ss",
    t.toFixed(3),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=16:16",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-",
  ]);
}

/**
 * Word-level ASR port (tier 2): POST the clip to a whisper-compatible
 * service (STUDIO_ASR_URL) expecting
 * `{ segments: [{ text, start, end, words?: [{ text, start, end }] }] }`.
 * Best-effort: any failure returns null and the parser falls to tier 3.
 */
export async function fetchAsrEvidence(videoBuffer: Buffer): Promise<AsrSegment[] | null> {
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
    const body = (await response.json()) as {
      segments?: Array<{ text?: string; start?: number; end?: number; words?: Array<{ text?: string; start?: number; end?: number }> }>;
    };
    const segments = (body.segments ?? [])
      .map((s) => ({
        text: (s.text ?? "").trim(),
        startSec: s.start ?? 0,
        endSec: s.end ?? s.start ?? 0,
        words: (s.words ?? []).map((w) => ({
          text: (w.text ?? "").trim(),
          startSec: w.start ?? 0,
          endSec: w.end ?? w.start ?? 0,
        })),
      }))
      .filter((s) => s.text.length > 0 || s.words.length > 0);
    return segments.length > 0 ? segments : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function buildAdDNA(videoBuffer: Buffer, opts: AdDNAOptions = {}): Promise<AdDNA> {
  const dir = mkdtempSync(join(tmpdir(), "studio-dna-"));
  try {
    const videoPath = join(dir, "reference.mp4");
    writeFileSync(videoPath, videoBuffer);

    const { durationSec, hasAudio, silences } = await probe(videoPath);
    const speech = hasAudio ? speechSegmentsFromSilences(durationSec, silences, true) : [];
    const sceneCuts = await detectScenes(videoPath);
    const fused = fuseBeats({ durationSec, speechSegments: speech, sceneCuts, hasAudio });
    const roles = assignRoles(fused.segments.length);

    // Transcript tiers: pasted > ASR > speech-rate assumption.
    const pasted = opts.transcript?.trim() ?? "";
    let transcriptSource: AdDNATranscriptSource = "none";
    let evidence: AsrWord[] = [];
    if (pasted) {
      transcriptSource = "pasted";
    } else {
      const asrSegments = await fetchAsrEvidence(videoBuffer);
      if (asrSegments) {
        transcriptSource = "asr";
        evidence = evidenceWords(asrSegments);
      }
    }
    const evidenceBuckets = assignEvidenceToBeats(evidence, fused.segments);
    const pastedSlices = pasted ? sliceTranscriptEven(pasted, fused.segments.length) : [];

    const transcriptSample = pasted || evidence.map((w) => w.text).join(" ");
    const cjk = isCjkText(transcriptSample);
    const rate = cjk ? SPEECH_RATE.cjkCharsPerSec : SPEECH_RATE.wordsPerSec;

    const beats: AdDNABeat[] = fused.segments.map((seg, i) => {
      const dur = Math.max(0.1, seg.endSec - seg.startSec);
      const measured = evidenceBuckets[i]!.length > 0 ? evidenceBuckets[i]!.length : null;
      const sliceUnits =
        measured == null && pastedSlices[i] ? countUnits(pastedSlices[i]!, cjk) || null : null;
      const units = measured ?? sliceUnits ?? Math.round(rate * dur);
      const transcript = evidenceBuckets[i]!.map((w) => w.text).join(" ") || pastedSlices[i];
      return {
        index: i,
        role: roles[i]!,
        startSec: seg.startSec,
        endSec: seg.endSec,
        targetWords: windowFor(units),
        ...(transcript ? { transcript } : {}),
        visual: visualFor(roles[i]!, i === 0),
      };
    });

    // Style tokens: sample frames at spread beat midpoints, cluster the pixels.
    const midpoints = fused.segments.map((s) => (s.startSec + s.endSec) / 2);
    const step = Math.max(1, Math.floor(midpoints.length / PALETTE_SAMPLES));
    const sampleTimes: number[] = [];
    for (let i = 0; i < midpoints.length && sampleTimes.length < PALETTE_SAMPLES; i += step) {
      sampleTimes.push(midpoints[i]!);
    }
    const frames: Buffer[] = [];
    for (const t of sampleTimes) {
      try {
        const raw = await sampleFrame(videoPath, t);
        if (raw.length >= 3) frames.push(raw);
      } catch {
        // palette is best-effort
      }
    }
    const palette = frames.length > 0 ? dominantColors(Buffer.concat(frames), 3) : [];

    const cutsInBeat = (start: number, end: number) =>
      sceneCuts.filter((t) => t >= start && t < end).length;
    const energy = {
      wordsPerSec: beats.map((b) =>
        round3(
          evidenceBuckets[b.index]!.length > 0
            ? evidenceBuckets[b.index]!.length / Math.max(0.1, b.endSec - b.startSec)
            : rate,
        ),
      ),
      cutsPerSec: beats.map((b) => round3(cutsInBeat(b.startSec, b.endSec) / Math.max(0.1, b.endSec - b.startSec))),
    };

    return {
      version: 1,
      durationSec: round3(durationSec),
      canvas: { aspectRatio: opts.aspectRatio ?? "9:16", resolution: opts.resolution ?? 720 },
      beats,
      style: {
        paletteDominant: palette.length > 0 ? palette : DEFAULT_PALETTE,
        captionStyle: "karaoke",
        cutsPerSec: round3(sceneCuts.length / Math.max(0.1, durationSec)),
      },
      energy,
      provenance: {
        transcriptSource,
        beatSource: fused.measuredBoundaries > 0 ? fused.source : "preset",
        roleSource: "rule",
        confidence:
          fused.totalBoundaries > 0 ? round3(fused.measuredBoundaries / fused.totalBoundaries) : 0,
      },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
